$ErrorActionPreference = 'Stop'
# 2기 체크히어 연결 프로그램: 포트 8766, 이 폴더의 data(새 SQLite·새 전용 크롬). 1기 연결 프로그램(8765)은 건드리지 않습니다.
$bridgeRoot = $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$portableNode = Join-Path $bridgeRoot 'runtime/node.exe'
$bridgeNode = if (Test-Path -LiteralPath $portableNode) { $portableNode } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$bridgePort = 8766
$bridgeUrl = 'http://127.0.0.1:' + $bridgePort
# build는 server.mjs의 BUILD 한 줄에서 UTF-8로 읽습니다('2기-…', 이 파일에 따로 적지 않음).
$serverText = [IO.File]::ReadAllText((Join-Path $bridgeRoot 'server.mjs'), [Text.Encoding]::UTF8)
$expectedBuild = [regex]::Match($serverText, "export const BUILD='([^']+)'").Groups[1].Value
if (-not $expectedBuild) { throw 'server.mjs에서 build를 읽지 못했습니다. 연결 프로그램 폴더를 확인해 주세요.' }
$bridgeRunning = $false
# 첫 화면(/)은 처음 설치 모드에서 /setup으로 넘어가므로, 연결 프로그램인지는 /checkhere.html로 봅니다.
try { $page = Invoke-WebRequest -Uri ($bridgeUrl + '/checkhere.html') -TimeoutSec 2 -UseBasicParsing; $bridgeRunning = $page.Content.Contains('checkhereApp') } catch {}
if ($bridgeRunning) {
    $health = Invoke-RestMethod -Uri ($bridgeUrl + '/api/session') -TimeoutSec 2
    if ($health.build -ne $expectedBuild) {
        $bridgeState = Invoke-RestMethod -Uri ($bridgeUrl + '/api/state?delta=1') -Headers @{'x-hint-key'=$health.key} -TimeoutSec 90
        if ($bridgeState.busy) { throw '수집 또는 반영 작업이 진행 중입니다. 작업이 끝난 후 다시 실행해 주세요.' }
        # 이 포트(8766)에서 듣는 node만 끕니다. 1기(8765)는 그대로입니다.
        $listener = netstat.exe -ano | Select-String ('127.0.0.1:' + $bridgePort + '\s+0.0.0.0:0\s+LISTENING\s+(\d+)')
        if ($listener -and $listener.Matches.Count -eq 1) {
            $oldBridgeId = [int]$listener.Matches[0].Groups[1].Value
            $oldBridgeProcess = Get-Process -Id $oldBridgeId -ErrorAction Stop
            if ($oldBridgeProcess.ProcessName -eq 'node') { Stop-Process -Id $oldBridgeId -ErrorAction Stop; Start-Sleep -Seconds 2; $bridgeRunning = $false }
        }
    }
}
if (-not $bridgeRunning) {
    $startArgs = '"' + (Join-Path $bridgeRoot 'server.mjs') + '"'
    $errorLog = Join-Path $bridgeRoot 'bridge-error.log'
    Start-Process -FilePath $bridgeNode -ArgumentList $startArgs -WorkingDirectory $bridgeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgeRoot 'bridge.log') -RedirectStandardError $errorLog
    # 켜질 때까지 기다립니다. 켜지지 않으면(예: 1기 data 폴더에서 띄움 — OLD_DATA) 오류 기록 끝부분을 보여 주고 멈춥니다.
    $ready = $false
    for ($i = 0; $i -lt 20 -and -not $ready; $i++) { Start-Sleep -Milliseconds 700; try { $null = Invoke-RestMethod -Uri ($bridgeUrl + '/api/session') -TimeoutSec 2; $ready = $true } catch {} }
    if (-not $ready) {
        if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Encoding UTF8 -Tail 20 | Write-Host }
        throw '2기 연결 프로그램이 시작되지 않았습니다. 위 내용을 확인해 주세요.'
    }
}
$chromePath = Join-Path ${env:ProgramFiles} 'Google/Chrome/Application/chrome.exe'
if (Test-Path -LiteralPath $chromePath) { Start-Process -FilePath $chromePath -ArgumentList $bridgeUrl } else { Start-Process $bridgeUrl }
