# Builds dist\voyager_tribute.scr: a single self-contained screen saver (assets + WebView2 DLLs embedded).
# Needs Windows with the .NET Framework 4 compiler (present on every Windows 10/11 install).
$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$cache = Join-Path $root "tools\cache"; New-Item -ItemType Directory -Force $cache | Out-Null
$wv = Join-Path $cache "wv2"
if (-not (Test-Path "$wv\lib\net462\Microsoft.Web.WebView2.Core.dll")) {
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg" -OutFile "$cache\wv2.zip"
    Expand-Archive "$cache\wv2.zip" $wv -Force
}
$stage = Join-Path $cache "stage"; $zip = Join-Path $cache "payload.zip"
if (Test-Path $stage) { [System.IO.Directory]::Delete($stage, $true) }
if (Test-Path $zip) { [System.IO.File]::Delete($zip) }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$wv\lib\net462\Microsoft.Web.WebView2.Core.dll", "$wv\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$wv\runtimes\win-x64\native\WebView2Loader.dll" $stage
robocopy "$root\web" "$stage\web" /E /NFL /NDL /NJH /NJS /NP | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
New-Item -ItemType Directory -Force "$root\dist" | Out-Null
$out = "$root\dist\voyager_tribute.scr"
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$out" "/resource:$zip,payload.zip" `
  "/r:$stage\Microsoft.Web.WebView2.Core.dll" "/r:$stage\Microsoft.Web.WebView2.WinForms.dll" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "$root\host\Tribute.cs"
if ($LASTEXITCODE -ne 0) { throw "compile failed" }
Get-Item $out | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } }