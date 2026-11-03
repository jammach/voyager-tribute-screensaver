# Removes the Voyager screen saver and restores the previously selected one (if any).
$ErrorActionPreference = 'Stop'
$desk = 'HKCU:\Control Panel\Desktop'
$key = 'HKCU:\Software\VoyagerSaver'
$dst = Join-Path $env:LOCALAPPDATA 'VoyagerSaver'
$cur = (Get-ItemProperty $desk -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'
if ($cur -like '*\VoyagerSaver\Voyager.scr') {
    $prev = (Get-ItemProperty $key -Name PreviousScreenSaver -ErrorAction SilentlyContinue).PreviousScreenSaver
    if ($prev) { Set-ItemProperty $desk -Name 'SCRNSAVE.EXE' -Value $prev }
    else { Remove-ItemProperty $desk -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue; Set-ItemProperty $desk -Name 'ScreenSaveActive' -Value '0' }
    rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True
}
if (Test-Path $key) { Remove-Item -LiteralPath $key -Recurse -Force }
$self = $MyInvocation.MyCommand.Path
if (Test-Path $dst) {
    # remove everything except this running script, which cannot delete itself while executing
    Get-ChildItem $dst -Force | Where-Object { $_.FullName -ne $self } | Remove-Item -Recurse -Force
    Write-Host "Removed files from $dst (you can delete $self and the folder manually)"
}
Write-Host "Uninstalled."
