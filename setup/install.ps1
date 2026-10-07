param(
    [Parameter(Mandatory = $true)][string]$FrameworkDir,
    [Parameter(Mandatory = $true)][string]$DeploymentDir,
    [string]$ConsoleUrl = 'http://127.0.0.1:7788',
    [switch]$RestartCortico
)
$ErrorActionPreference = 'Stop'
$extensionDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$FrameworkDir = [IO.Path]::GetFullPath($FrameworkDir)
$DeploymentDir = [IO.Path]::GetFullPath($DeploymentDir)
$dataDir = Join-Path $DeploymentDir 'data'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $expectedDeployment = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataDir))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
function Read-Lifecycle { Invoke-RestMethod -Uri "$ConsoleUrl/api/run/lifecycle" -TimeoutSec 5 }
function Post-Console($path, $body) { Invoke-RestMethod -Uri "$ConsoleUrl$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 90 }
try { $lifecycle = Read-Lifecycle } catch { throw ('无法连接 Cortico 控制台，请先启动 Cortico 并检查地址：' + $ConsoleUrl) }
if ($lifecycle.deployment -ne $expectedDeployment) { throw '当前控制台不是指定部署，未修改其他 bot。' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw '请安装 Node.js 22.15 或以上，再重新打开入口。' }
$nodeVersion = & node.exe -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.15.0') { throw '启动入口需要 Node.js 22.15 或以上，请更新后重新打开终端。' }
& node.exe -e "try { for (const name of ['playwright-core', 'protobufjs', '@kobalab/majiang-core']) require.resolve(name, { paths: [process.argv[1]] }) } catch { process.exit(1) }" $extensionDir
if ($LASTEXITCODE -ne 0) {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '缺少npm，请安装包含npm的Node.js。' }
    Write-Host '正在安装扩展运行依赖……'
    Push-Location -LiteralPath $extensionDir
    try {
        & npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw '扩展依赖安装失败，未启用自动操作。' }
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $extensionDir 'assets\liqi.json'))) {
    Write-Host '正在从雀魂官方准备协议并校验 SHA256……'
    & node.exe (Join-Path $PSScriptRoot 'fetch-protocol.mjs')
    if ($LASTEXITCODE -ne 0) { throw '雀魂协议准备失败，未启用自动操作。请检查网络及上方错误信息。' }
}
$manifest = Invoke-RestMethod -Uri "$ConsoleUrl/api/console/manifest" -TimeoutSec 10
$world = $manifest.providers | Where-Object id -eq 'world:majsoul'
$extensions = Invoke-RestMethod -Uri "$ConsoleUrl/api/extensions" -TimeoutSec 10
$existing = $extensions.extensions | Where-Object name -eq 'cortico-world-majsoul'
$packageVersion = (Get-Content -LiteralPath (Join-Path $extensionDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$installedDir = Join-Path $extensions.dir 'node_modules\cortico-world-majsoul'
if ($existing.spec -like 'link:*') { $installedDir = $existing.spec.Substring(5) }
$registered = $existing -and $existing.state -ne 'removed' -and $existing.installedVersion -eq $packageVersion -and [IO.Path]::GetFullPath($installedDir) -eq $extensionDir
if (-not $world -or -not $registered -or $existing.state -eq 'pending-restart') {
    if (-not $registered) {
        $backupDir = Join-Path $dataDir ('majsoul\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        foreach ($name in @('package.json', 'pnpm-lock.yaml')) {
            $file = Join-Path $extensions.dir $name
            if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $backupDir $name) }
        }
        $check = Post-Console '/api/extensions/check' @{ target = @{ path = $extensionDir }; kind = 'world' }
        if ($check.name -ne 'cortico-world-majsoul') { throw '扩展检查返回不匹配的包。' }
        $installed = Post-Console '/api/extensions/install' @{ path = $extensionDir }
        if (-not $installed.ok) { throw '雀魂扩展安装失败。' }
        Write-Host '雀魂扩展已登记。'
    }
    if (-not $RestartCortico) { Write-Host '运行进程尚未加载扩展。首次打开“start-majsoul.cmd”入口会重启 Cortico 一次。'; return }
    if (-not $manifest.framework.capabilities.supervised) { throw '请通过原有入口重启 Cortico，再打开“start-majsoul.cmd”。' }
    $bootId = $lifecycle.bootId
    Post-Console '/api/run/restart' @{} | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 500
        try { $lifecycle = Read-Lifecycle } catch { $lifecycle = $null }
        if ($lifecycle -and $lifecycle.deployment -ne $expectedDeployment) { throw '重启后的部署不匹配。' }
        if ($lifecycle -and $lifecycle.ready -and $lifecycle.bootId -ne $bootId) { break }
    } while ((Get-Date) -lt $deadline)
    if (-not $lifecycle -or -not $lifecycle.ready -or $lifecycle.bootId -eq $bootId) { throw 'Cortico 尚未完成重启，请查看控制台。' }
    $manifest = Invoke-RestMethod -Uri "$ConsoleUrl/api/console/manifest" -TimeoutSec 10
    if (-not ($manifest.providers | Where-Object id -eq 'world:majsoul')) { throw '重启完成，但雀魂扩展未加载。' }
}
Write-Host '雀魂扩展已加载。'
