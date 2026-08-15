// Diagnostic: attach to a running Electron app via the Chrome DevTools
// Protocol and dump the main window's DOM state + a composited screenshot.
// Usage: launch the app with --remote-debugging-port=9223, then
//   node scripts/diag-cdp.mjs
// (Node >= 22 for the global WebSocket client.)
import { writeFileSync } from 'node:fs';

const PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  return res.json();
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send: (method, params = {}) =>
        new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        }),
      close: () => ws.close(),
    });
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}

async function main() {
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try {
      targets = await getTargets();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await sleep(500);
  }
  console.log('targets:');
  for (const t of targets) {
    console.log(' -', t.type, JSON.stringify(t.url.slice(0, 90)), t.title);
  }

  const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1/.test(t.url));
  if (!page) {
    console.log('NO main-window http target found (maybe welcome/file target only).');
    process.exit(0);
  }

  const c = await cdp(page.webSocketDebuggerUrl);
  const evalJs = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.value;
  };

  const dom = await evalJs(`JSON.stringify({
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    bodyLen: document.body.innerHTML.length,
    title: document.title,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlColorScheme: document.documentElement.style.colorScheme,
    hasDarkAttr: document.body.hasAttribute('data-ds-dark-theme'),
  })`);
  console.log('[dom]', dom);

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  writeFileSync('cdp-shot.png', buf);
  console.log('[screenshot]', buf.length, 'bytes -> cdp-shot.png');

  c.close();
}

main().catch((e) => {
  console.error('diag-cdp error:', e.message);
  process.exit(1);
});
