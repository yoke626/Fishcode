$h = @{ "User-Agent" = "fishcode-publish" }
$runId = $args[0]
for ($i = 1; $i -le 50; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/yoke626/Fishcode/actions/runs/$runId" -Proxy "http://127.0.0.1:10090" -Headers $h -TimeoutSec 20
    Write-Output ("[poll {0}] {1}/{2}" -f $i, $r.status, $r.conclusion)
    if ($r.status -eq "completed") { break }
  } catch { Write-Output ("[poll {0}] ERR {1}" -f $i, $_.Exception.Message) }
  Start-Sleep -Seconds 30
}
try {
  $jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/yoke626/Fishcode/actions/runs/$runId/jobs" -Proxy "http://127.0.0.1:10090" -Headers $h -TimeoutSec 20
  foreach ($j in $jobs.jobs) { Write-Output ("JOB {0} [{1}/{2}]" -f $j.name, $j.status, $j.conclusion) }
} catch { Write-Output ("JOBS ERR " + $_.Exception.Message) }
Remove-Item $MyInvocation.MyCommand.Path -Force
