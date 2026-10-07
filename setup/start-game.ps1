param(
    [string]$FrameworkDir,
    [string]$DeploymentDir,
    [string]$ConsoleUrl = 'http://127.0.0.1:7788',
    [switch]$ObserveOnly
)
$ErrorActionPreference = 'Stop'
if (-not $FrameworkDir) { $FrameworkDir = Read-Host 'Cortico框架根目录（包含框架package.json）' }
if (-not $DeploymentDir) { $DeploymentDir = Read-Host '当前Bot部署目录（不要填deployments父目录）' }
if (-not $FrameworkDir -or -not $DeploymentDir) { throw '框架目录和部署目录不能为空。' }
$FrameworkDir = $FrameworkDir.Trim().Trim('"')
$DeploymentDir = $DeploymentDir.Trim().Trim('"')
& (Join-Path $PSScriptRoot 'install.ps1') -FrameworkDir $FrameworkDir -DeploymentDir $DeploymentDir -ConsoleUrl $ConsoleUrl -RestartCortico
function Post-Console($path, $body) { Invoke-RestMethod -Uri "$ConsoleUrl$path" -Method Post -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 90 }
$manifest = Invoke-RestMethod -Uri "$ConsoleUrl/api/console/manifest" -TimeoutSec 10
$world = $manifest.providers | Where-Object id -eq 'world:majsoul'
if ($world.availability -ne 'active') { Post-Console '/api/worlds/activation' @{ id = 'majsoul'; enabled = $true } | Out-Null }
Post-Console '/api/config' @{ group = 'world:majsoul'; values = @{ 'worlds.majsoul.allowActions' = -not $ObserveOnly } } | Out-Null
Post-Console '/api/worlds/visibility' @{ id = 'majsoul'; visible = $true } | Out-Null
$worldStates = Invoke-RestMethod -Uri "$ConsoleUrl/api/worlds" -TimeoutSec 10
if (($worldStates.worlds | Where-Object id -eq 'majsoul').prefixDrifted) { Post-Console '/api/session/reload-prefix' @{} | Out-Null }
$stateUrl = "$ConsoleUrl/api/console/providers/world%3Amajsoul/panels/game/state"
$state = Invoke-RestMethod -Uri $stateUrl -TimeoutSec 10
if ($state.connected) {
    if (-not $ObserveOnly) { Post-Console '/api/run/resume' @{} | Out-Null }
    Write-Host '已复用连接中的雀魂牌局。'
    return
}
$groups = (Invoke-RestMethod -Uri "$ConsoleUrl/api/config" -TimeoutSec 10).groups
$gameConfig = ($groups | Where-Object { $_.group.id -eq 'world:majsoul' }).values
$browserPort = [int]$gameConfig.'worlds.majsoul.browserPort'
if ($browserPort -lt 1024 -or $browserPort -gt 65535) { throw '专用浏览器端口配置无效。' }
$gameProfileDir = [IO.Path]::GetFullPath((Join-Path $DeploymentDir 'data\majsoul\edge-profile'))
New-Item -ItemType Directory -Force -Path $gameProfileDir | Out-Null
$edgePaths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")
$edgeExe = $edgePaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $edgeExe) { throw '没有找到 Microsoft Edge，请安装后再打开入口。' }
$owner = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir="' + $gameProfileDir + '"') -and $_.CommandLine -match ('--remote-debugging-port=' + $browserPort + '(\s|$)') }
$debugUrl = "http://127.0.0.1:$browserPort/json/version"
$debugReady = $false
try { $debugReady = [bool](Invoke-RestMethod -Uri $debugUrl -TimeoutSec 2).webSocketDebuggerUrl } catch {}
if ($debugReady -and -not $owner) { throw '调试端口属于其他浏览器，未接管它。请更换雀魂 World 的 browserPort。' }
if (-not $owner) {
    $arguments = '--user-data-dir="' + $gameProfileDir + '" --remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $browserPort + ' --no-first-run --no-default-browser-check --new-window about:blank'
    Start-Process -FilePath $edgeExe -ArgumentList $arguments -WindowStyle Normal
}
$deadline = (Get-Date).AddSeconds(20)
do {
    try { $debugReady = [bool](Invoke-RestMethod -Uri $debugUrl -TimeoutSec 2).webSocketDebuggerUrl } catch { $debugReady = $false }
    if ($debugReady) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if (-not $debugReady) { throw '专用 Edge 调试接口没有就绪，不会重复启动。' }
Post-Console '/api/console/providers/world%3Amajsoul/panels/game/connect' @{} | Out-Null
if (-not $ObserveOnly) { Post-Console '/api/run/resume' @{} | Out-Null }
if ($ObserveOnly) { Write-Host '观察模式已连接，你可以手动游玩。' }
else { Write-Host '请在专用 Edge 手动登录，先开友人房加 CPU。开局后bot接手出牌；局间确认由你点击。' }
Write-Host ('动作耗时：' + (Join-Path $DeploymentDir 'data\majsoul\actions.jsonl'))
