param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:PROCESSOR_ARCHITECTURE -notin @('AMD64','x86')){throw 'UNSUPPORTED_ARCH'}
$cache=Join-Path $env:LOCALAPPDATA 'nookrew/0.2.0-beta.1/win32-x64'
$binary=Join-Path $cache 'nookrew/runtime/bin/node.exe'
if(-not(Test-Path -LiteralPath $binary)){
 New-Item -ItemType Directory -Force -Path $cache | Out-Null
 $archive=Join-Path $cache 'Nookrew-0.2.0-beta.1-win32-x64.tar.gz'
 $nativeCurl=Join-Path $env:SystemRoot 'System32/curl.exe'
 & $nativeCurl --fail --location --silent --show-error --proto '=https' --tlsv1.2 'https://github.com/hw01931/nookrew/releases/download/v0.2.0-beta.1/Nookrew-0.2.0-beta.1-win32-x64.tar.gz' --output $archive
 if($LASTEXITCODE -ne 0){throw 'ARCHIVE_DOWNLOAD_FAILED'}
 $hash=[System.Security.Cryptography.SHA256]::Create()
 $stream=[System.IO.File]::OpenRead($archive)
 try{$actual=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}
 if($actual -ne '3b1cd2abbc7372ecb3930eb5827b3ac213e61d6e91ddea786c12ff0a705e5c5b'){throw 'ARCHIVE_CHECKSUM_MISMATCH'}
 $nativeTar=Join-Path $env:SystemRoot 'System32/tar.exe'
 & $nativeTar -xzf $archive -C $cache
 if($LASTEXITCODE -ne 0){throw 'ARCHIVE_EXTRACTION_FAILED'}
}
& $binary (Join-Path $cache 'nookrew/scripts/open-office.cjs') $Project
if($LASTEXITCODE -ne 0){throw 'OFFICE_START_FAILED'}
