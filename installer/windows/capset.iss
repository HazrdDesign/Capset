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

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

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

; --- bundled ffmpeg (LGPL; attribution in LICENSE.txt) --------------------
Source: "{#PayloadDir}\vendor\*"; \
    DestDir: "{app}\vendor"; \
    Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

[Icons]
Name: "{group}\Capset Backend"; Filename: "{app}\backend\capset-backend.exe"
Name: "{group}\Uninstall Capset"; Filename: "{uninstallexe}"

[Registry]
; CEP refuses unsigned extensions unless debug mode is on. The extension
; folder installed above is unsigned in a v0.1 build, so without these keys
; the panel silently never appears -- the single most common "it installed
; but I don't see it" report.
;
; The CSXS version differs per host release, so every version in the
; supported range gets a key. Harmless when a version is not installed.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\backend\capset-backend.exe"; \
    Description: "Start the Capset transcription service"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{commoncf32}\Adobe\CEP\extensions\{#ExtensionId}"

[Messages]
FinishedLabel=Capset is installed.%n%nRestart After Effects, then open Window > Extensions > Capset.
