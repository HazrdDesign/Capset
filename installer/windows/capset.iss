; Inno Setup script for Capset.
;
; Mirrors the shape Captioneer ships (see docs/research/05-captioneer-teardown.md):
; one installer per OS, covering the host app, with the extension, the ASR
; runtime and the model all bundled. No separate ZXP step, no first-run
; download.
;
; Build:  iscc capset.iss /DAppVersion=0.1.0 /DPayloadDir=..\..\build\payload

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\..\build\payload"
#endif

#define AppName       "Capset"
#define AppPublisher  "HAZRD"
#define ExtensionId   "design.hazrd.capset"

[Setup]
AppId={{8B1F2C4E-9A3D-4E5B-B7C1-CAP5E70001}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE.txt
OutputDir=..\..\dist
OutputBaseFilename=Capset-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Writing to Common Files needs elevation.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName} {#AppVersion}
; Let Setup try to shut down anything holding our files. The backend runs
; windowless, so Restart Manager does not always spot it — [Code] below
; terminates it explicitly as well.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Optional so a user on a metered or offline connection can skip it. The
; backend downloads on demand anyway; this just moves the wait somewhere
; visible instead of stalling the first transcription with no explanation.
Name: "fetchmodel"; Description: "Download the speech model now (about 600 MB, one time)"; GroupDescription: "Setup:"

[Files]
; --- CEP extension -------------------------------------------------------
; {commoncf32} is "Program Files (x86)\Common Files", which is where Adobe
; keeps CEP extensions on 64-bit Windows regardless of host bitness.
Source: "{#PayloadDir}\panel\*"; \
    DestDir: "{commoncf32}\Adobe\CEP\extensions\{#ExtensionId}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; --- backend service + model ---------------------------------------------
Source: "{#PayloadDir}\backend\*"; \
    DestDir: "{app}\backend"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; No bundled media tools. After Effects renders the audio and Capset reads
; the resulting uncompressed WAV/AIFF directly, so there is no ffmpeg to
; ship — roughly 100 MB and an LGPL obligation avoided.

[Icons]
Name: "{group}\Capset Backend"; Filename: "{app}\backend\capset-backend.exe"
Name: "{group}\Uninstall Capset"; Filename: "{uninstallexe}"

; --- PlayerDebugMode ------------------------------------------------------
; NOT a [Registry] section. Setup runs elevated (it writes to Common Files),
; so HKCU there resolves to the ADMINISTRATOR's hive, not the logged-in
; user's. The key would land in the wrong profile, CEP would go on refusing
; to load this unsigned extension, and the panel would simply never appear in
; After Effects -- the classic "it installed but I don't see it" report.
; Inno Setup warns about exactly this:
;   "PrivilegesRequired is set to admin but per-user areas (HKCU) are used"
;
; runasoriginaluser drops back to the invoking user so the key lands in the
; right hive. The CSXS version differs per host release, so write them all;
; keys for versions that are not installed are harmless.
[Run]
Filename: "{sys}\reg.exe"; Parameters: "add ""HKCU\Software\Adobe\CSXS.9"" /v PlayerDebugMode /t REG_SZ /d 1 /f";  Flags: runhidden runasoriginaluser; StatusMsg: "Enabling extension loading..."
Filename: "{sys}\reg.exe"; Parameters: "add ""HKCU\Software\Adobe\CSXS.10"" /v PlayerDebugMode /t REG_SZ /d 1 /f"; Flags: runhidden runasoriginaluser
Filename: "{sys}\reg.exe"; Parameters: "add ""HKCU\Software\Adobe\CSXS.11"" /v PlayerDebugMode /t REG_SZ /d 1 /f"; Flags: runhidden runasoriginaluser
Filename: "{sys}\reg.exe"; Parameters: "add ""HKCU\Software\Adobe\CSXS.12"" /v PlayerDebugMode /t REG_SZ /d 1 /f"; Flags: runhidden runasoriginaluser

; Warm the model cache during install. onnx_asr checks its cache before the
; network, so this is a no-op if the model is already on the machine —
; reinstalling or upgrading will not download it a second time.
Filename: "{app}\backend\capset-backend.exe"; Parameters: "--fetch-model"; \
    StatusMsg: "Downloading the speech model (one time, about 600 MB)..."; \
    Flags: runhidden waituntilterminated; Tasks: fetchmodel

; runhidden as well as a windowed build: belt and braces, so no console
; flashes even if the binary is ever rebuilt with console=True by mistake.
Filename: "{app}\backend\capset-backend.exe"; \
    Description: "Start the Capset transcription service"; \
    Flags: nowait postinstall skipifsilent runhidden

; No [UninstallRun] cleanup of PlayerDebugMode, for two reasons.
;
; 1. `runasoriginaluser` is a [Run]-only flag; Inno Setup rejects it in
;    [UninstallRun] ("Flags includes a flag that is not supported in this
;    section"). Without it the delete would target the administrator's hive,
;    which is not where the key was written — so it would do nothing.
;
; 2. Removing it would be wrong even if it worked. PlayerDebugMode is a
;    machine-wide developer switch shared by every CEP extension. Other
;    unsigned extensions the user has installed may depend on it, so
;    uninstalling Capset must not turn them off.
;
; Leaving the key set is harmless: it only permits unsigned extensions to
; load, which is the state the user was already in.

[UninstallDelete]
Type: filesandordirs; Name: "{commoncf32}\Adobe\CEP\extensions\{#ExtensionId}"

[Messages]
FinishedLabel=Capset is installed.%n%nRestart After Effects, then open Window > Extensions > Capset.

[Code]
// Stop a running backend before touching its files.
//
// Upgrading over a running install fails otherwise: Windows locks the
// executable and its DLLs, and Setup reports "DeleteFile failed; code 32 —
// the process cannot access the file because it is being used by another
// process" (or code 5) for capset-backend.exe, base_library.zip,
// libcrypto-3.dll and every other locked file in turn. Skipping them leaves
// a half-updated install, which is worse than failing outright.
//
// The service is windowless, so Restart Manager (CloseApplications) does not
// reliably detect it. taskkill is unambiguous. /T also takes any child
// processes; /F because the service has no message loop to ask politely.

procedure StopBackend();
var
  ResultCode: Integer;
  Launched: Boolean;
begin
  // Assigned rather than called bare: Exec is a function, and discarding a
  // return value as a statement is not reliably accepted by Pascal Script.
  // The result is intentionally unused — taskkill returning "not found" is
  // the normal case on a first install.
  Launched := Exec(ExpandConstant('{sys}\taskkill.exe'),
                   '/IM capset-backend.exe /F /T',
                   '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Windows releases file handles slightly after the process exits; without
  // this pause the very next file copy can still hit a lock.
  Sleep(1000);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopBackend();
  // Empty string means "carry on". A message here would abort the install,
  // and a missing process is a perfectly normal first-time install.
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopBackend();
  Result := True;
end;

// Tell the panel where the backend ended up.
//
// The panel starts the service on demand -- the installer launches it once,
// and without this the first reboot would leave the user with "the
// transcription service is not running" and a Start Menu shortcut to find.
// It cannot guess the path: DefaultDirName is only a default and the user is
// free to install anywhere, so Setup records the real location inside the
// extension folder, which the panel can always locate for itself.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ExtensionDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    ExtensionDir := ExpandConstant('{commoncf32}\Adobe\CEP\extensions\{#ExtensionId}');
    // Failure is survivable: the panel falls back to the default install
    // location, which is where all but a handful of users will have it.
    SaveStringToFile(ExtensionDir + '\backend-path.txt',
                     ExpandConstant('{app}\backend\capset-backend.exe'), False);
  end;
end;
