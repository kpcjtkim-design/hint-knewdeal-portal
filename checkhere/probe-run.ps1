param([string]$ClassId = '2', [string]$Date = '2026-09-03', [string]$Url = '')
# Runs the read-only CheckHere diagnosis inside the running bridge (same logged-in Chrome).
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Start.ps1')
$base = 'http://127.0.0.1:8765'
$session = $null
for ($i = 0; $i -lt 30 -and -not $session; $i++) { try { $session = Invoke-RestMethod -Uri "$base/api/session" -TimeoutSec 3 } catch { Start-Sleep -Seconds 1 } }
if (-not $session) { throw 'Bridge is not reachable at 127.0.0.1:8765.' }
if ($session.capabilities -notcontains 'probe-v1') { throw 'An older bridge is still running. Close its window and run this again.' }
$headers = @{ 'x-hint-key' = $session.key }
$body = @{ classId = $ClassId; date = $Date; url = $Url; modal = $true } | ConvertTo-Json
$job = Invoke-RestMethod -Method Post -Uri "$base/api/probe" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
Write-Host "probe started: class $ClassId, $Date"
$last = ''
do {
  Start-Sleep -Seconds 3
  $state = Invoke-RestMethod -Uri "$base/api/state?delta=1" -Headers $headers -TimeoutSec 30
  $current = $state.jobs | Where-Object { $_.id -eq $job.id } | Select-Object -First 1
  if ($current.message -ne $last) { Write-Host $current.message; $last = $current.message }
} while ($current.status -eq 'running')
Write-Host ''
Write-Host $current.summary
Write-Host ''
Write-Host ('status: ' + $current.status)
if ($current.report) { Write-Host ('report: ' + $current.report) }
