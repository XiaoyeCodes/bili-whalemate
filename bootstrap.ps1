[CmdletBinding()]
param([string]$Profile = '', [string]$HarnessSource = '', [string]$DshHome = '')
$ErrorActionPreference = 'Stop'
$version = 'v1.0.0'
$asset = "bili-whalemate-$version.zip"
$release = "https://github.com/XiaoyeCodes/bili-whalemate/releases/download/$version"
$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "bili-whalemate/$version"
New-Item -ItemType Directory -Force $installRoot | Out-Null
$archive = Join-Path $installRoot $asset
Invoke-WebRequest -UseBasicParsing "$release/$asset" -OutFile $archive
$sumFile = Join-Path $installRoot 'SHA256SUMS'
Invoke-WebRequest -UseBasicParsing "$release/SHA256SUMS" -OutFile $sumFile
$sums = Get-Content -Raw -LiteralPath $sumFile
$expected = (($sums -split "`n" | Where-Object { $_.TrimEnd().EndsWith("  $asset") }) -split '\s+')[0]
if ($expected -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Release archive checksum did not match. Installation stopped.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $installRoot -Force
& (Join-Path $installRoot 'bili-whalemate/install.ps1') -Profile $Profile -HarnessSource $HarnessSource -DshHome $DshHome
