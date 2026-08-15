// The object graph assembled at startup. Pure types (erased at compile time);
// exists so the wiring in bootstrap.ts stays self-documenting.

import type { BackendManager } from './backend-manager';
import type { CompletionWatcher } from './completion-watcher';
import type { Hotkey } from './hotkey';
import type { NotificationService } from './notification-service';
import type { OpenWithService } from './open-with';
import type { PetController } from './pet/pet-controller';
import type { SettingsStore } from './settings-store';
import type { TrayController } from './tray';
import type { MainWindow } from './windows/main-window';
import type { PetWindow } from './windows/pet-window';
import type { WelcomeWindow } from './windows/welcome-window';
import type { WindowRegistry } from './windows/window-registry';

export interface AppContext {
  registry: WindowRegistry;
  settings: SettingsStore;
  backend: BackendManager;
  notifications: NotificationService;
  hotkey: Hotkey;
  watcher: CompletionWatcher;
  openWith: OpenWithService;
  mainWindow: MainWindow;
  welcomeWindow: WelcomeWindow;
  petWindow: PetWindow;
  pet: PetController;
  tray: TrayController;
}
