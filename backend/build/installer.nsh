!ifndef BUILD_UNINSTALLER
Var /GLOBAL seenaryMachineInstallDir
Var /GLOBAL seenaryCurrentUserInstallDir

!macro customInit
  SetRegView 64
  ReadRegStr $seenaryMachineInstallDir HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $seenaryCurrentUserInstallDir HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
!macroend

!macro retryLegacySeenaryUninstaller
  ${if} ${Errors}
    DetailPrint "Uninstall was not successful. Not able to launch uninstaller!"
    SetErrorLevel 2
    Quit
  ${endif}

  SetRegView 64
  ${if} "$rootKey_uninstallResult" == "HKEY_CURRENT_USER"
    StrCpy $R9 $seenaryCurrentUserInstallDir
  ${else}
    StrCpy $R9 $seenaryMachineInstallDir
  ${endif}
  ${if} $R9 == ""
    StrCpy $R9 $seenaryCurrentUserInstallDir
  ${endif}
  ${if} $R0 == 2
  ${andIf} ${FileExists} "$R9\.seenary-uninstall-core.exe"
    DetailPrint "Retrying the legacy Seenary uninstaller core."
    CopyFiles /SILENT "$R9\.seenary-uninstall-core.exe" "$PLUGINSDIR\legacy-seenary-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\legacy-seenary-uninstaller.exe" /S /KEEP_APP_DATA $0 _?=$R9' $R0
  ${endif}

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint "Uninstall was not successful. Uninstaller error code: $R0."
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstallCheck
  !insertmacro retryLegacySeenaryUninstaller
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro retryLegacySeenaryUninstaller
!macroend
!endif

; Electron originally used its default identifier for Seenary's login item.
; Only remove it when the command belongs to a known Seenary installation:
; another Electron app may still own the same generic registry value name.
!macro removeLegacySeenaryStartup ROOT INSTALL_DIR
  ${if} "${INSTALL_DIR}" != ""
    ReadRegStr $R0 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Electron"
    ${if} $R0 == '$\"${INSTALL_DIR}\${APP_EXECUTABLE_FILENAME}$\"'
    ${orIf} $R0 == '${INSTALL_DIR}\${APP_EXECUTABLE_FILENAME}'
      DeleteRegValue ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Electron"
    ${endif}
  ${endif}
!macroend

!macro cleanupLegacySeenaryStartup
  Push $R0
  !insertmacro removeLegacySeenaryStartup HKCU "$INSTDIR"
  !insertmacro removeLegacySeenaryStartup HKCU "$seenaryCurrentUserInstallDir"
  !insertmacro removeLegacySeenaryStartup HKCU "$seenaryMachineInstallDir"
  ${if} $installMode == "all"
    !insertmacro removeLegacySeenaryStartup HKLM "$INSTDIR"
    !insertmacro removeLegacySeenaryStartup HKLM "$seenaryCurrentUserInstallDir"
    !insertmacro removeLegacySeenaryStartup HKLM "$seenaryMachineInstallDir"
  ${endif}
  Pop $R0
!macroend

!macro customInstall
  !insertmacro cleanupLegacySeenaryStartup
  Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$INSTDIR\.seenary-uninstall-core.exe"
  File /oname=SeenaryUninstaller.exe "${BUILD_RESOURCES_DIR}\SeenaryUninstaller.exe"
  Rename "$INSTDIR\SeenaryUninstaller.exe" "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend
