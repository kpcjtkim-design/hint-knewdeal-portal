param([string]$ClassId = '1', [string[]]$Dates = @('2026-10-28','2026-10-29','2026-10-30'))
# Real-site check of the page-data read: a precise (editor) collection first, then a fast one.
# The fast run should find every student identical ("unchanged") if both methods agree.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Start.ps1')
$base = 'http://127.0.0.1:8766'
$session = $null
for ($i = 0; $i -lt 30 -and -not $session; $i++) { try { $session = Invoke-RestMethod -Uri "$base/api/session" -TimeoutSec 3 } catch { Start-Sleep -Seconds 1 } }
if ($session.capabilities -notcontains 'page-data-v1') { throw 'An older bridge is still running. Close its window and run this again.' }
$headers = @{ 'x-hint-key' = $session.key }
$state = Invoke-RestMethod -Uri "$base/api/state?delta=1" -Headers $headers -TimeoutSec 90
if (-not $state.connected) {
  Invoke-RestMethod -Method Post -Uri "$base/api/connect" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 60 | Out-Null
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 2; $state = Invoke-RestMethod -Uri "$base/api/state?delta=1" -Headers $headers -TimeoutSec 90; if ($state.connected) { break } }
}
$script:cursor = $state.cursor
function Run-Batch($mode) {
  $body = @{ classIds = @($ClassId); dates = $Dates; mode = $mode } | ConvertTo-Json
  $job = Invoke-RestMethod -Method Post -Uri "$base/api/sync-batch" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
  $watch = [Diagnostics.Stopwatch]::StartNew()
  do { Start-Sleep -Seconds 2; $s = Invoke-RestMethod -Uri ("$base/api/state?delta=1&cursor=" + [uri]::EscapeDataString($script:cursor)) -Headers $headers -TimeoutSec 90; $j = $s.jobs | Where-Object { $_.id -eq $job.id } | Select-Object -First 1 } while ($j.status -eq 'running')
  Write-Host ("[{0}] {1}s  {2}" -f $mode, [math]::Round($watch.Elapsed.TotalSeconds), $j.message)
  foreach ($r in $j.results) { Write-Host ("   {0} {1} {2} saved={3} unchanged={4} {5} {6}" -f $r.classId, $r.date, $r.status, $r.count, $r.skipped, $r.method, $r.note) }
}
Run-Batch 'full'
Run-Batch 'incremental'
