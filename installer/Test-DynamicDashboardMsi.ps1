#Requires -Version 5.1
# Run on the disposable Windows build runner.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$msi = Join-Path $root 'Release\Dynamic-Dashboard-Setup.msi'
$installDir = Join-Path $env:ProgramFiles 'Dynamic Dashboard'
$legacyDir = Join-Path $env:ProgramFiles 'Dashboard'
$legacyPresent = Test-Path -LiteralPath $legacyDir
$logs = Join-Path $root 'artifacts'

if (Test-Path -LiteralPath $installDir) {
    throw 'Lifecycle test requires a clean Dynamic Dashboard install directory.'
}

function Invoke-Msi([string]$Mode, [string]$LogName) {
    $log = Join-Path $logs $LogName
    $process = Start-Process msiexec.exe -ArgumentList "$Mode `"$msi`" /qn /norestart /l*v `"$log`"" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "msiexec $Mode failed: $($process.ExitCode). See $log" }
}

Invoke-Msi '/i' 'msi-dynamic-install.log'
try {
    foreach ($file in @('LFPortal.Web.exe', 'Start-Dashboard.ps1', 'coreclr.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installDir $file) -PathType Leaf)) {
            throw "Independent Dynamic Dashboard payload missing: $file"
        }
    }
    if ((Test-Path -LiteralPath $legacyDir) -ne $legacyPresent) {
        throw 'The legacy install directory changed during Dynamic Dashboard install.'
    }
}
finally {
    Invoke-Msi '/x' 'msi-dynamic-uninstall.log'
}
if (Test-Path -LiteralPath (Join-Path $installDir 'LFPortal.Web.exe')) {
    throw 'Dynamic Dashboard payload remains after uninstall.'
}
if ((Test-Path -LiteralPath $legacyDir) -ne $legacyPresent) {
    throw 'The legacy install directory changed during Dynamic Dashboard uninstall.'
}
