# Clean run measurement (docs/tasks/ROUND4_windows_run.md), "Zapusk" steps as in the task. ASCII only: PowerShell 5.1.
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
Set-Location <папка замера>
$c = Measure-Command { git clone --branch backend --single-branch https://github.com/xrnskew/XRONIX.git xronix-r4 }
Set-Location xronix-r4; git rev-parse HEAD > ..\revision.txt
$u = Measure-Command { docker compose up -d --build --wait --wait-timeout 600 *>&1 | Out-File -Encoding utf8 ..\up-log.txt }
"clone $($c.TotalSeconds) c; up $($u.TotalSeconds) c" > ..\timing.txt
docker compose ps > ..\ps.txt
docker stats --no-stream $(docker compose ps -q) > ..\stats-healthy.txt
docker compose images > ..\compose-images.txt; docker system df > ..\df-after.txt
"DONE"
Get-Content ..\timing.txt
Get-Content ..\ps.txt
