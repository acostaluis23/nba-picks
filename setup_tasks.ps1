# setup_tasks.ps1 - schedule the three daily jobs in Windows Task Scheduler (run this once).
#
#   powershell -ExecutionPolicy Bypass -File .\setup_tasks.ps1
#
# Times are your PC's local time. The computer has to be on (or asleep, since the tasks can wake it).
# To remove them later:  Unregister-ScheduledTask -TaskName "NBA Picks - Morning" -Confirm:$false  (and the other two)

$root = $PSScriptRoot
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$jobs = @(
    @{ Name = "NBA Picks - Morning"; Script = "morning.ps1"; At = "11:00AM" },
    @{ Name = "NBA Picks - Pregame"; Script = "pregame.ps1"; At = "4:30PM" },
    @{ Name = "NBA Picks - Night";   Script = "night.ps1";   At = "11:45PM" }
)

foreach ($j in $jobs) {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$root\$($j.Script)`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Daily -At $j.At
    Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "Scheduled: $($j.Name) every day at $($j.At)"
}
Write-Host "`nDone. Open 'Task Scheduler' to see them, or right-click one and choose Run to test it."
