// Runtime asset resolution. Static files live in out/assets (copied from
// assets/ by copy-static.mjs), so dev and packaged builds resolve the same
// path anchored on app.getAppPath().

import * as path from 'node:path';
import { firstExisting } from '../shared/paths';

export function appIconPath(appPath: string): string | undefined {
  return firstExisting([
    path.join(appPath, 'out', 'assets', 'icon.png'),
    path.join(appPath, 'out', 'assets', 'tray.png'),
  ]);
}

export function trayIconPath(appPath: string): string | undefined {
  return firstExisting([
    path.join(appPath, 'out', 'assets', 'tray.png'),
    path.join(appPath, 'out', 'assets', 'icon.png'),
  ]);
}
