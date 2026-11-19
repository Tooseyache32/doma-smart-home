$ErrorActionPreference = 'Stop'
$soff = 'C:\Program Files\LibreOffice\program\soffice.com'
if (!(Test-Path $soff)) { $soff = 'C:\Program Files\LibreOffice\program\soffice.exe' }
$out = 'C:\Users\admin\.zcode\workspace\default\report-work\rendered\template-title'
$prof = 'C:\Users\admin\.zcode\workspace\default\report-work\lo-profile-title2'
$profileUrl = 'file:///' + ($prof -replace '\\','/')
& $soff --headless "-env:UserInstallation=$profileUrl" --convert-to pdf --outdir $out 'C:\Users\admin\.zcode\workspace\default\report-work\sources\title\source.docx'
if ($LASTEXITCODE -ne 0) { throw "LibreOffice exit $LASTEXITCODE" }
Get-ChildItem $out | Select-Object Name,Length | ConvertTo-Json
