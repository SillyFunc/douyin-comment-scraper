param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $project 'src-tauri\target\portable-cache'
$output = Join-Path $project 'src-tauri\target\portable-dist'
$release = Join-Path $project 'src-tauri\target\release'
$version = (Get-Content -LiteralPath (Join-Path $project 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$nodeVersion = '24.21.0'
$webviewVersion = '154.0.4258.62'
$nodeArchive = Join-Path $cache "node-v$nodeVersion-win-x64.zip"
$nodeArchiveHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$nodeDir = Join-Path $cache "node\node-v$nodeVersion-win-x64"
$nodeExe = Join-Path $nodeDir 'node.exe'
$webviewArchive = Join-Path $cache "Microsoft.WebView2.FixedVersionRuntime.$webviewVersion.x64.cab"
$webviewArchiveHash = 'e8f55a4bde27c7f82512402b56a58539b5ec8928be4e500e077b6f66c9ef4668'
$webviewDir = Join-Path $cache "webview2-extracted\Microsoft.WebView2.FixedVersionRuntime.$webviewVersion.x64"
$browserDir = Join-Path $cache 'browsers'

New-Item -ItemType Directory -Path $cache, $output -Force | Out-Null

function Get-Sha256([string]$FilePath) {
    $stream = [System.IO.File]::OpenRead($FilePath)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $hash.Dispose()
        $stream.Dispose()
    }
}

function Get-VerifiedDownload([string]$Url, [string]$Path, [string]$Sha256) {
    if (Test-Path -LiteralPath $Path) {
        $actual = Get-Sha256 $Path
        if ($actual -eq $Sha256) { return }
        throw "缓存文件校验失败，请检查或手动移走：$Path"
    }
    Write-Host "下载 $Url"
    & curl.exe -L -f -sS --retry 3 -o $Path $Url
    if ($LASTEXITCODE -ne 0) { throw "下载失败：$Url" }
    $actual = Get-Sha256 $Path
    if ($actual -ne $Sha256) { throw "下载文件校验失败：$Path" }
}

Get-VerifiedDownload "https://nodejs.org/download/release/v$nodeVersion/node-v$nodeVersion-win-x64.zip" $nodeArchive $nodeArchiveHash
if (-not (Test-Path -LiteralPath $nodeExe)) {
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath (Join-Path $cache 'node') -Force
}
if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Node.js 解压后未找到 node.exe' }

Get-VerifiedDownload 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/b92cd7d9-6976-4f34-9708-47e80937c287/Microsoft.WebView2.FixedVersionRuntime.154.0.4258.62.x64.cab' $webviewArchive $webviewArchiveHash
if (-not (Test-Path -LiteralPath (Join-Path $webviewDir 'msedgewebview2.exe'))) {
    $extractTo = Join-Path $cache 'webview2-extracted'
    New-Item -ItemType Directory -Path $extractTo -Force | Out-Null
    & expand.exe $webviewArchive '-F:*' $extractTo | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 解压失败' }
}
if (-not (Test-Path -LiteralPath (Join-Path $webviewDir 'msedgewebview2.exe'))) { throw 'WebView2 解压后未找到 msedgewebview2.exe' }

$env:PLAYWRIGHT_BROWSERS_PATH = $browserDir
& $nodeExe (Join-Path $project 'node_modules\playwright-core\cli.js') install --no-shell --no-progress chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium 下载失败' }
$browserSpec = (Get-Content -LiteralPath (Join-Path $project 'node_modules\playwright-core\browsers.json') -Raw -Encoding UTF8 | ConvertFrom-Json).browsers | Where-Object { $_.name -eq 'chromium' }
$chromiumExe = Join-Path $browserDir "chromium-$($browserSpec.revision)\chrome-win64\chrome.exe"
if (-not (Test-Path -LiteralPath $chromiumExe)) { throw '未找到与 Playwright 版本匹配的 Chromium' }

if (-not $SkipBuild) {
    Push-Location $project
    try {
        & npm.cmd run tauri -- build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'Tauri 构建失败' }
    } finally {
        Pop-Location
    }
}

$exe = Join-Path $release 'douyin-review-scraper.exe'
$scripts = Join-Path $project 'scripts'
$playwright = Join-Path $project 'node_modules\playwright-core'
foreach ($required in @($exe, $scripts, $playwright)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "缺少构建产物：$required" }
}

$stage = Join-Path $output ("douyin-comment-scraper-$version-x64-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath $exe -Destination $stage
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts'), (Join-Path $stage 'node_modules'), (Join-Path $stage 'runtime\browsers'), (Join-Path $stage 'runtime\webview2') -Force | Out-Null
Get-ChildItem -LiteralPath $scripts -File -Filter '*.mjs' | Where-Object { $_.Name -notlike '*.test.mjs' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage 'scripts')
}
Copy-Item -LiteralPath $playwright -Destination (Join-Path $stage 'node_modules\playwright-core') -Recurse
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $nodeDir 'LICENSE') -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
Get-ChildItem -LiteralPath $browserDir -Directory | Where-Object { $_.Name -ne '.links' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage 'runtime\browsers') -Recurse
}
Get-ChildItem -LiteralPath $webviewDir -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage 'runtime\webview2') -Recurse
}

$readme = @(
    "Douyin Comment Scraper $version portable (Windows x64)",
    '',
    '1. Extract the entire ZIP to a local folder. Do not run from the ZIP preview.',
    '2. Double-click douyin-review-scraper.exe.',
    '3. First startup may take longer while read access is set for bundled WebView2.',
    '',
    'Node.js, Chromium, and WebView2 are included. No separate installation is needed.',
    'Login data and reports stay in the current Windows user profile.',
    'Update this portable package to receive WebView2 security updates.',
    'Run from a local disk, not a network share.'
) -join [Environment]::NewLine
$readme | Set-Content -LiteralPath (Join-Path $stage '使用说明.txt') -Encoding UTF8

$zip = Join-Path $output "评论号码台_${version}_portable_x64.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Get-Item -LiteralPath $zip | Select-Object FullName, Length
Get-Sha256 $zip
