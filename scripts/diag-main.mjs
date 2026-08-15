// Diagnostic: reproduce the production main window as faithfully as possible
// (hardware acceleration ON, real backgroundColor, window shown, same
// navigation guards) and capture a screenshot + console so we can see whether
// the dsh SPA actually paints or stays black. Run via `npx electron`.
import { app, BrowserWindow, shell } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 55993;
const dshBin = join(root, 'dsh-bundle', 'node_modules', '@deepseek-ai/dsh', 'lib', 'bin.js');
const nodeExe = join(root, 'node-runtime', 'node.exe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pollReady() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      http
        .get(`http://127.0.0.1:${PORT}/`, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', () => {
          if (Date.now() - t0 > 25000) reject(new Error('backend timeout'));
          else setTimeout(tick, 400);
        });
    };
    tick();
  });
}

function openExternalIfHttp(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

app.whenReady().then(async () => {
  const child = spawn(
    nodeExe,
    [dshBin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(PORT)],
    { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
  );
  const status = await pollReady();
  console.log('[diag] backend ready, status', status);

  const baseUrl = `http://127.0.0.1:${PORT}`;
  const win = new BrowserWindow({
    title: 'Fishcode',
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.once('ready-to-show', () => {
    console.log('[ready-to-show]');
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfHttp(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (origin !== baseUrl) {
      event.preventDefault();
      openExternalIfHttp(url);
    }
  });
  win.webContents.on('console-message', (_e, ...args) => {
    const d = args[0];
    const msg = typeof d === 'object' ? `${d.message} [${d.sourceId}:${d.lineNumber}]` : JSON.stringify(args);
    console.log('[console]', msg);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    console.log('[did-fail-load]', code, desc, url, 'mainFrame=' + isMainFrame);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details));
  });

  await win.loadURL(baseUrl);

  for (const t of [3, 8]) {
    await sleep(t * 1000);
    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    const out = join(root, `diag-shot-${t}s.png`);
    writeFileSync(out, png);
    console.log(`[shot ${t}s]`, png.length, 'bytes ->', out);
  }

  const dom = await win.webContents.executeJavaScript('document.getElementById("root").childElementCount');
  console.log('[root childElementCount]', dom);

  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
  app.quit();
});
