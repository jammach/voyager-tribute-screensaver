# Installs the Voyager screen saver for the current user and makes it the active screen saver.
param(
    [int]$TimeoutMinutes = 0,        # 0 = leave the current idle timeout alone
    [switch]$NoActivate              # copy files only, don't change the active screen saver
)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = Join-Path $env:LOCALAPPDATA 'VoyagerSaver'
New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /E /XF install.ps1 uninstall.ps1 /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $src 'uninstall.ps1') $dst -Force
$scr = Join-Path $dst 'Voyager.scr'
if (-not (Test-Path $scr)) { throw "Voyager.scr missing after copy" }

New-Item -Force -Path 'HKCU:\Software\VoyagerSaver' | Out-Null
Set-ItemProperty 'HKCU:\Software\VoyagerSaver' -Name Path -Value $dst

if (-not $NoActivate) {
    $desk = 'HKCU:\Control Panel\Desktop'
    $prev = (Get-ItemProperty $desk -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'
    if ($prev -and $prev -ne $scr) { Set-ItemProperty 'HKCU:\Software\VoyagerSaver' -Name PreviousScreenSaver -Value $prev }
    Set-ItemProperty $desk -Name 'SCRNSAVE.EXE' -Value $scr
    Set-ItemProperty $desk -Name 'ScreenSaveActive' -Value '1'
    if ($TimeoutMinutes -gt 0) { Set-ItemProperty $desk -Name 'ScreenSaveTimeOut' -Value ([string]($TimeoutMinutes * 60)) }
    rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True
}
Write-Host "Installed to $dst"
Write-Host "Preview now with:  & '$scr' /s     (move the mouse or press a key to exit)"
