param([string]$ClassId = '', [string]$Date1 = '', [string]$Date2 = '', [string]$Url = '')
# Runs the read-only CheckHere masking diagnosis inside the running bridge (same logged-in Chrome).
# It sends no request of its own to CheckHere: it counts the attendance data the page itself loads.
# The report has shapes, counts and yes/no answers: no names, phones, memos, times or tokens.
$ErrorActionPreference = 'Stop'
# Ask first: Start.ps1 opens a Chrome window that would take the keyboard focus.
if (-not $ClassId) { $ClassId = Read-Host 'Class number 1-17 [Enter = 2]'; if (-not $ClassId) { $ClassId = '2' } }
if (-not $Date1 -and -not $Url) { $Date1 = Read-Host 'First date YYYY-MM-DD [Enter = today]' }
if (-not $Date2) { $Date2 = Read-Host 'Second date YYYY-MM-DD [Enter = previous class day]' }
# Start.ps1 restarts an idle bridge of another build (the connection key changes) and refuses while a job runs.
& (Join-Path $PSScriptRoot 'Start.ps1')
$base = 'http://127.0.0.1:8765'
$session = $null
for ($i = 0; $i -lt 30 -and -not $session; $i++) { try { $session = Invoke-RestMethod -Uri "$base/api/session" -TimeoutSec 3 } catch { Start-Sleep -Seconds 1 } }
if (-not $session) { throw 'Bridge is not reachable at 127.0.0.1:8765.' }
if ($session.capabilities -notcontains 'api-probe-v1') {
  $startCmd = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cmd' | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match '-File "%~dp0Start\.ps1"' } | Select-Object -First 1
  throw ('An older bridge (build ' + $session.build + ') is still running and was not restarted. Run "' + $startCmd.Name + '" when no collection or apply is running, or restart the PC, then run this again.')
}
$headers = @{ 'x-hint-key' = $session.key }
# Only the job list is needed: pass the cursor so the bridge does not resend every stored record on each poll.
$state = Invoke-RestMethod -Uri "$base/api/state?delta=1" -Headers $headers -TimeoutSec 90
$cursor = $state.cursor
$body = @{ classId = "$ClassId".Trim(); date1 = "$Date1".Trim(); date2 = "$Date2".Trim(); url = "$Url".Trim() } | ConvertTo-Json
$job = $null
for ($try = 1; -not $job; $try++) {
  try { $job = Invoke-RestMethod -Method Post -Uri "$base/api/api-probe" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) }
  catch {
    $err = $_; $code = 0; if ($err.Exception.Response) { $code = [int]$err.Exception.Response.StatusCode }
    # PS 5.1 often leaves ErrorDetails empty: read the bridge's JSON message from the response itself.
    $detail = "$($err.ErrorDetails.Message)"
    if (-not $detail -and $err.Exception.Response) { try { $detail = (New-Object IO.StreamReader($err.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd() } catch {} }
    try { $detail = ($detail | ConvertFrom-Json).error } catch {}
    # 409: the relay or another job holds the bridge. Wait for it instead of failing.
    if ($code -eq 409 -and $try -lt 20) { Write-Host "Bridge is busy (relay or another job). Waiting 15 s... ($try/20)"; Start-Sleep -Seconds 15; continue }
    if ($detail) { throw "Bridge refused the diagnosis ($code): $detail" }
    throw $err
  }
}
Write-Host "api probe started: class $ClassId"
$last = ''
do {
  Start-Sleep -Seconds 3
  $state = Invoke-RestMethod -Uri ("$base/api/state?delta=1&cursor=" + [uri]::EscapeDataString($cursor)) -Headers $headers -TimeoutSec 90
  $cursor = $state.cursor
  $current = $state.jobs | Where-Object { $_.id -eq $job.id } | Select-Object -First 1
  if (-not $current) { throw 'The diagnosis job is no longer listed by the bridge (it may have restarted). Check the bridge window and run this again.' }
  if ($current.message -ne $last) { Write-Host $current.message; $last = $current.message }
} while ($current.status -eq 'running')
Write-Host ''
Write-Host $current.summary
Write-Host ''
Write-Host ('status: ' + $current.status)
if ($current.report) { Write-Host ('report: ' + $current.report) }
