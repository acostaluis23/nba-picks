# setup_tasks.ps1 - schedule the daily jobs in Windows Task Scheduler (run this once, or again after changes).
#
#   powershell -ExecutionPolicy Bypass -File .\setup_tasks.ps1
#
# Times are your PC's local time. The computer has to be on (or asleep, since the tasks can wake it).
# To remove them later:  Unregister-ScheduledTask -TaskName "NBA Picks - Morning" -Confirm:$false  (and the others)

$root = $PSScriptRoot
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

$jobs = @(
    @{ Name = "NBA Picks - Morning"; Script = "morning.ps1"; At = "11:00AM"; Note = "daily" },
    @{ Name = "NBA Picks - Pregame"; Script = "pregame.ps1"; At = "3:45PM";  Note = "daily" },
    @{ Name = "NBA Picks - Results"; Script = "results.ps1"; At = "6:00PM";  Note = "every 20 minutes until 1:40AM"; Repeat = $true },
    @{ Name = "NBA Picks - Night";   Script = "night.ps1";   At = "1:50AM";  Note = "daily (backup grading)" }
)

foreach ($j in $jobs) {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$root\$($j.Script)`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Daily -At $j.At
    if ($j.Repeat) {
        $rep = New-ScheduledTaskTrigger -Once -At $j.At -RepetitionInterval (New-TimeSpan -Minutes 20) `
            -RepetitionDuration (New-TimeSpan -Hours 7 -Minutes 40)
        $trigger.Repetition = $rep.Repetition
    }
    Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "Scheduled: $($j.Name) at $($j.At), $($j.Note)"
}
Write-Host "`nDone. Open 'Task Scheduler' to see them, or right-click one and choose Run to test it."
