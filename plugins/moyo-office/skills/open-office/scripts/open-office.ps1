param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$root = (Resolve-Path -LiteralPath $Project).Path.TrimEnd('\')
if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'ROOT_DIRECTORY_DENIED' }
$cursor = $root
while ($cursor) {
  $entry = Get-Item -LiteralPath $cursor
  if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'PROJECT_PATH_DENIED' }
  $parent = [IO.Directory]::GetParent($cursor)
  if ($null -eq $parent) { break }
  $cursor = $parent.FullName
}
$binary = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../runtime/AIOrchestraOffice.exe'))
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'PLUGIN_RUNTIME_MISSING' }
$folder = Join-Path $root '.aiorchestra'
if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPORT_PATH_DENIED' }
$key = [Guid]::NewGuid().ToString()
$report = Join-Path $folder ('.plugin-report-' + $key + '.json')
$outLog = Join-Path $folder ('.plugin-launch-' + $key + '.log')
$errLog = Join-Path $folder ('.plugin-launch-' + $key + '.error.log')
$arguments = @('--project',('"' + $root + '"'),'--report-file',('"' + $report + '"'),'--no-open')
$process = Start-Process -FilePath $binary -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
for ($attempt=0; $attempt -lt 300 -and -not (Test-Path -LiteralPath $report); $attempt++) {
  if ($process.HasExited -and -not (Test-Path -LiteralPath $report)) { throw 'OFFICE_LAUNCH_FAILED' }
  Start-Sleep -Milliseconds 100
}
if (-not (Test-Path -LiteralPath $report)) { throw 'OFFICE_START_TIMEOUT' }
$result = Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
$url = [Uri]$result.url
if ($result.project -ne $root -or $url.Host -notin @('127.0.0.1','[::1]','::1','[0000:0000:0000:0000:0000:0000:0000:0001]') -or $url.Scheme -ne 'http') { throw 'OFFICE_REPORT_INVALID' }
$result | ConvertTo-Json -Compress
