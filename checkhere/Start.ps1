$ErrorActionPreference = 'Stop'
$bridgeRoot = $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$portableNode = Join-Path $bridgeRoot 'runtime/node.exe'
$bridgeNode = if (Test-Path -LiteralPath $portableNode) { $portableNode } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$bridgeUrl = 'http://127.0.0.1:8765'
$bridgeRunning = $false
try { $page = Invoke-WebRequest -Uri $bridgeUrl -TimeoutSec 2 -UseBasicParsing; $bridgeRunning = $page.Content.Contains('checkhereApp') } catch {}
if ($bridgeRunning) {
    $health = Invoke-RestMethod -Uri ($bridgeUrl + '/api/session') -TimeoutSec 2
    if ($health.build -ne '20260910.5') {
        $listener = netstat.exe -ano | Select-String '127.0.0.1:8765\s+0.0.0.0:0\s+LISTENING\s+(\d+)'
        if ($listener -and $listener.Matches.Count -eq 1) {
            $oldBridgeId = [int]$listener.Matches[0].Groups[1].Value
            $oldBridgeProcess = Get-Process -Id $oldBridgeId -ErrorAction Stop
            if ($oldBridgeProcess.ProcessName -eq 'node') { Stop-Process -Id $oldBridgeId -ErrorAction Stop; Start-Sleep -Seconds 2; $bridgeRunning = $false }
        }
    }
}
if (-not $bridgeRunning) {
    $startArgs = '"' + (Join-Path $bridgeRoot 'server.mjs') + '"'
    Start-Process -FilePath $bridgeNode -ArgumentList $startArgs -WorkingDirectory $bridgeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgeRoot 'bridge.log') -RedirectStandardError (Join-Path $bridgeRoot 'bridge-error.log')
    Start-Sleep -Seconds 2
}
$chromePath = Join-Path ${env:ProgramFiles} 'Google/Chrome/Application/chrome.exe'
if (Test-Path -LiteralPath $chromePath) { Start-Process -FilePath $chromePath -ArgumentList $bridgeUrl } else { Start-Process $bridgeUrl }

