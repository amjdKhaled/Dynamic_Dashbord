#Requires -Version 5.1
# Run on the disposable Windows build runner.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $root 'Release\Dynamic-Dashboard-Setup.exe'
$installDir = Join-Path $env:ProgramFiles 'Dynamic Dashboard'
$legacyDir = Join-Path $env:ProgramFiles 'Dashboard'
$legacyPresent = Test-Path -LiteralPath $legacyDir
$logs = Join-Path $root 'artifacts'

if (Test-Path -LiteralPath $installDir) {
    throw 'Lifecycle test requires a clean Dynamic Dashboard install directory.'
}

function Invoke-Setup([string]$Mode, [string]$LogName) {
    $log = Join-Path $logs $LogName
    $process = Start-Process $setup -ArgumentList "$Mode /quiet /norestart /log `"$log`"" -PassThru
    Write-Host "Running Dynamic Dashboard setup $Mode (PID $($process.Id))."
    if (-not $process.WaitForExit(12 * 60 * 1000)) {
        & taskkill.exe /PID $process.Id /T /F | Out-Host
        throw "Dynamic Dashboard setup $Mode exceeded 12 minutes. See $log"
    }
    if ($process.ExitCode -ne 0) { throw "Dynamic Dashboard setup $Mode failed: $($process.ExitCode). See $log" }
}

$connectionKey = 'HKLM:\Software\ISB\DynamicDashboard\Installer'
$unrelated = Join-Path $installDir 'ci-unowned-file.txt'
Invoke-Setup '/install' 'msi-dynamic-install.log'
try {
    if (-not (Test-Path -LiteralPath $connectionKey)) {
        throw 'MSI did not register its connection defaults.'
    }
    Set-Content -LiteralPath $unrelated -Value 'This file is not owned by MSI.'
    foreach ($file in @('LFPortal.Web.exe', 'Start-Dashboard.ps1', 'coreclr.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installDir $file) -PathType Leaf)) {
            throw "Independent Dynamic Dashboard payload missing: $file"
        }
    }
    $shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Dynamic Dashboard\Dynamic Dashboard.lnk'
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) {
        throw 'Dynamic Dashboard Start menu shortcut is missing.'
    }

    # Prove the installed payload starts and serves the real Dashboard sign-in route.
    $previousData = $env:DASHBOARD_STANDALONE_DATA_DIR
    $env:DASHBOARD_STANDALONE_DATA_DIR = Join-Path $logs 'dynamic-smoke-data'
    $url = 'http://127.0.0.1:15989'
    $app = $null
    try {
        $app = Start-Process (Join-Path $installDir 'LFPortal.Web.exe') -WorkingDirectory $installDir `
            -ArgumentList @('--urls', $url) -PassThru
        $ready = $null
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if ($app.HasExited) { throw "Installed Dashboard exited: $($app.ExitCode)." }
            try {
                $ready = Invoke-RestMethod "$url/_standalone/ready" -TimeoutSec 2
                break
            }
            catch { Start-Sleep -Milliseconds 500 }
        }
        if ($null -eq $ready -or $ready.application -ne 'Dynamic_Dashbord' -or
            $ready.mode -ne 'standalone' -or $ready.dashboardPath -ne '/DynamicDashboard') {
            throw 'Installed Dynamic Dashboard did not pass readiness verification.'
        }
        $login = Invoke-WebRequest "$url/Login" -UseBasicParsing -TimeoutSec 5
        if ($login.StatusCode -ne 200) { throw 'Installed Dynamic Dashboard login did not load.' }
    }
    finally {
        if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force }
        $env:DASHBOARD_STANDALONE_DATA_DIR = $previousData
    }

    if ((Test-Path -LiteralPath $legacyDir) -ne $legacyPresent) {
        throw 'The legacy install directory changed during Dynamic Dashboard install.'
    }
}
finally {
    Invoke-Setup '/uninstall' 'msi-dynamic-uninstall.log'
}
if (Test-Path -LiteralPath (Join-Path $installDir 'LFPortal.Web.exe')) {
    throw 'Dynamic Dashboard payload remains after uninstall.'
}
if ((Test-Path -LiteralPath $legacyDir) -ne $legacyPresent) {
    throw 'The legacy install directory changed during Dynamic Dashboard uninstall.'
}

if (-not (Test-Path -LiteralPath $unrelated -PathType Leaf)) {
    throw 'Uninstall removed a file that it did not install.'
}
Remove-Item -LiteralPath $unrelated
foreach ($value in @('ServerUrl', 'ApiBasePath', 'ApiVersion')) {
    if ($null -ne (Get-ItemProperty -LiteralPath $connectionKey -Name $value -ErrorAction SilentlyContinue)) {
        throw "Uninstall left MSI-owned registry value $value."
    }
}
