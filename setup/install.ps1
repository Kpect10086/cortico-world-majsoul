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
if (-not (Test-Path -LiteralPath (Join-Path $extensionDir 'assets\liqi.json'))) { throw '先在扩展目录执行 npm run prepare:protocol，再安装扩展。' }
$dataDir = Join-Path $DeploymentDir 'data'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $expectedDeployment = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataDir))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
function Read-Lifecycle { Invoke-RestMethod -Uri "$ConsoleUrl/api/run/lifecycle" -TimeoutSec 5 }
function Post-Console($path, $body) { Invoke-RestMethod -Uri "$ConsoleUrl$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 90 }
$lifecycle = Read-Lifecycle
if ($lifecycle.deployment -ne $expectedDeployment) { throw '当前控制台不是指定部署，未修改其他 bot。' }
$manifest = Invoke-RestMethod -Uri "$ConsoleUrl/api/console/manifest" -TimeoutSec 10
$world = $manifest.providers | Where-Object id -eq 'world:majsoul'
if (-not $world) {
    $extensionsFile = Join-Path $FrameworkDir 'extensions\package.json'
    $registered = $false
    if (Test-Path -LiteralPath $extensionsFile) { $registered = [bool]((Get-Content -LiteralPath $extensionsFile -Raw | ConvertFrom-Json).dependencies.'cortico-world-majsoul') }
    if (-not $registered) {
        $backupDir = Join-Path $dataDir ('majsoul\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        foreach ($name in @('package.json', 'pnpm-lock.yaml')) {
            $file = Join-Path $FrameworkDir "extensions\$name"
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
