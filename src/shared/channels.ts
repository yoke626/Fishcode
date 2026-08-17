/**
 * IPC channel-name constants. This is the single source of truth for the MAIN
 * process. Sandboxed preloads cannot import it (they may only `require`
 * 'electron'), so they inline the same string literals — keep them in sync.
 */

export const IPC = {
  // Pet window (main <-> renderer/pet)
  petState: 'pet:state', // main -> pet: animation state
  petSay: 'pet:say', // main -> pet: speech bubble text
  petSummon: 'pet:summon', // pet -> main: click summons the main window
  petHover: 'pet:hover', // pet -> main: cursor over the sprite (toggle click-through)
  petDrag: 'pet:drag', // pet -> main: move the window by (dx, dy)
  petDrop: 'pet:drop', // pet -> main: drag ended, persist position
  petMenu: 'pet:menu', // pet -> main: right-click context menu

  // Welcome wizard (main <-> renderer/welcome)
  welcomeGetCopy: 'welcome:get-copy', // welcome -> main (invoke): UI copy
  welcomeOpenApiKey: 'welcome:open-api-key', // welcome -> main: whitelisted external open
  welcomeComplete: 'welcome:complete', // welcome -> main: onboarding done + settings

  // Settings
  settingsGet: 'settings:get', // welcome -> main (invoke): current settings

  // Vision setup (main <-> renderer/vision-setup)
  visionGetCopy: 'vision:get-copy', // vision-setup -> main (invoke): UI copy
  visionGetState: 'vision:get-state', // vision-setup -> main (invoke): current vision state
  visionApply: 'vision:apply', // vision-setup -> main (invoke): save key + config, test, report
  visionOpenConsole: 'vision:open-console', // vision-setup -> main: whitelisted external open
  welcomeOpenVisionSetup: 'welcome:open-vision-setup', // welcome -> main: open the vision setup window

  // Main window forwarding
  openPath: 'app:open-path', // main -> dsh renderer: forwarded `--open` path

  // Loading page (main <-> renderer/loading, via the main-window preload)
  loadingState: 'loading:state', // main -> loading: backend progress
  loadingRetry: 'loading:retry', // loading -> main: retry the backend start

  // Session delete (dsh sidebar three-dot menu, via the main-window preload)
  sessionDeleteById: 'session:delete-by-id', // dsh page -> main (invoke): delete one session by id
} as const
