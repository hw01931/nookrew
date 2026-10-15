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
if($Project.Contains([char]34)){throw 'PROJECT_PATH_DENIED'}
$launch=Join-Path $cache 'launch'
New-Item -ItemType Directory -Force -Path $launch | Out-Null
$key=[Guid]::NewGuid().ToString()
$report=Join-Path $launch ($key+'.json')
$launcher=Join-Path $cache 'nookrew/runtime/office-launcher.cjs'
$arguments='"'+$launcher+'" --project "'+$Project+'" --no-open --report-file "'+$report+'"'
$process=Start-Process -FilePath $binary -ArgumentList $arguments -WindowStyle Hidden -PassThru
for($attempt=0;$attempt -lt 300 -and -not(Test-Path -LiteralPath $report);$attempt++){
 if($process.HasExited -and -not(Test-Path -LiteralPath $report)){throw 'OFFICE_START_FAILED'}
 Start-Sleep -Milliseconds 100
}
if(-not(Test-Path -LiteralPath $report)){throw 'OFFICE_START_TIMEOUT'}
$result=Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
$uri=[Uri]$result.url
if($result.project -ne [IO.Path]::GetFullPath($Project)){throw 'OFFICE_REPORT_PROJECT_MISMATCH'}
$address=[Net.IPAddress]::None
if(-not [Net.IPAddress]::TryParse($uri.Host.Trim([char[]]'[]'),[ref]$address)){throw 'OFFICE_REPORT_INVALID_HOST'}
if($uri.Scheme -ne 'http' -or $address.ToString() -notin @('127.0.0.1','::1')){throw 'OFFICE_REPORT_INVALID_LOOPBACK'}
$result | ConvertTo-Json -Compress
