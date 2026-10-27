; NAJD installer hooks.
; Installation completes only after every bundled component is unpacked and verified:
; the installer runs the app in preparation mode and waits for its exit code.
!macro customInstall
  ; Unpacked components live in %LOCALAPPDATA%\NAJD AGENT\runtime; count them in "Space required".
  ; Sum of components[].bytes in build/bundle/najd-runtime-packed/bundle.json, in KB (checked by tests).
  AddSize 1124884
  DetailPrint "Preparing NAJD components (this can take a few minutes)..."
  najd_prepare:
  ${if} ${Silent}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --najd-prepare-runtime --silent' $0
  ${else}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --najd-prepare-runtime' $0
  ${endIf}
  ${if} $0 != 0
    ${ifNot} ${Silent}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "NAJD could not prepare its components.$\r$\nDetails: $LOCALAPPDATA\NAJD AGENT\install.log$\r$\n$\r$\nRetry now?" IDRETRY najd_prepare
      Abort "NAJD components were not prepared. See $LOCALAPPDATA\NAJD AGENT\install.log"
    ${endIf}
    ; Silent updates continue; the app prepares on its next start and shows the state in chat.
    DetailPrint "Component preparation will finish on the next start."
  ${else}
    DetailPrint "NAJD components are ready."
  ${endIf}
!macroend

; Remove the unpacked runtime components on a real uninstall. Updates keep them so an
; unchanged component is not unpacked again. User chats and settings are never removed here.
; The folder is found the way the app finds it (electron/runtime-root.cjs): the LOCALAPPDATA environment variable, or the
; profile's AppData\Local when it is missing; not through $LOCALAPPDATA, so an uninstall run with another LOCALAPPDATA
; (an isolated test) never touches the user's own components. They are the same folder in a normal session.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadEnvStr $R0 LOCALAPPDATA
    ; Only a drive path (C:\ or C:/) or a UNC path is used, as in runtime-root.cjs; anything else falls back.
    StrCpy $R2 $R0 2 1
    StrCpy $R3 $R0 2
    ${if} $R2 != ":\"
    ${andIf} $R2 != ":/"
    ${andIf} $R3 != "\\"
    ${andIf} $R3 != "//"
      StrCpy $R0 ""
    ${endIf}
    ${if} $R0 == ""
    ${andIf} $PROFILE != ""
      StrCpy $R0 "$PROFILE\AppData\Local"
    ${endIf}
    ${if} $R0 != ""
      ; Some bundled files are deeper than the 260-character Windows path limit (a long user name is enough), which
      ; RMDir cannot remove; rd with the extended form can: \\?\C:\... for a drive, \\?\UNC\server\share\... for a UNC
      ; root. A path written with forward slashes cannot take that form and is left to RMDir, which then removes
      ; whatever is left in every case.
      StrCpy $R2 $R0 2 1
      StrCpy $R3 $R0 2
      StrCpy $R4 ""
      ${if} $R3 == "\\"
        StrCpy $R5 $R0 "" 2
        StrCpy $R4 "\\?\UNC\$R5"
      ${elseIf} $R2 == ":\"
        StrCpy $R4 "\\?\$R0"
      ${endIf}
      ${if} $R4 != ""
        nsExec::Exec '"$SYSDIR\cmd.exe" /d /c rd /s /q "$R4\NAJD AGENT\runtime"'
        Pop $R1
      ${endIf}
      RMDir /r "$R0\NAJD AGENT\runtime"
      Delete "$R0\NAJD AGENT\install.log"
      RMDir "$R0\NAJD AGENT"
    ${endIf}
  ${endIf}
!macroend
