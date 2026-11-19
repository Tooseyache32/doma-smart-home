$ErrorActionPreference='Stop'
$soff='C:\Program Files\LibreOffice\program\soffice.com'
$out='C:\Users\admin\.zcode\workspace\default\report-work\rendered\final'
$prof='C:\Users\admin\.zcode\workspace\default\report-work\lo-profile-final'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$profileUrl='file:///'+($prof -replace '\\','/')
& $soff --headless "-env:UserInstallation=$profileUrl" --convert-to pdf --outdir $out 'C:\Users\admin\Desktop\очтект\Отчёт_DOMA_умный_дом.docx'
if($LASTEXITCODE -ne 0){throw "LibreOffice exit $LASTEXITCODE"}
Get-ChildItem $out | Select-Object Name,Length | ConvertTo-Json
