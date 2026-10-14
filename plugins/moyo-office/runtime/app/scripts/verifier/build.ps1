$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$buildContext = Join-Path $projectRoot '.aiorchestra/verifier-build'
New-Item -ItemType Directory -Path $buildContext -Force | Out-Null
# Send only the locked dependencies and Dockerfile, never the workspace or secrets.
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $buildContext -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $buildContext -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile') -Destination $buildContext -Force
docker build --tag aiorchestra-verifier:1 $buildContext
if ($LASTEXITCODE -ne 0) { throw 'VERIFIER_BUILD_FAILED' }
