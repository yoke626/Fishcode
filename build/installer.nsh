; FISHCODE installer hook: refresh the Windows icon cache after installing.
; The exe itself already carries the new icon (verified programmatically), but
; Windows caches shortcut icons per exe path, so a desktop shortcut created
; over an older install would keep showing the stale icon. Busting the cache
; here makes the freshly created shortcut show the new icon immediately.
!macro customInstall
  ExecWait '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'
!macroend
