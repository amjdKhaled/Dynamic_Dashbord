#Requires -Version 5.1
# Read-only tests of new-site planning and safety contracts. Never install IIS.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'install-dynamic-dashboard-iis.ps1'

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $script, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "IIS installer PowerShell syntax errors: $errors" }

$source = Get-Content -LiteralPath $script -Raw
foreach ($expected in @(
    '$siteName = ''dynamic_dashboard''',
    '$poolName = ''dynamic_dashboard''',
    'DASHBOARD_INSTANCE_NAME',
    'DASHBOARD_STANDALONE_DATA_DIR',
    'New-Website -Name $siteName',
    'New-WebAppPool -Name $poolName',
    'Assert-NoReparse',
    'Get-WebGlobalModule',
    '/_instance/ready'
)) {
    if (-not $source.Contains($expected)) {
        throw "Missing isolated deployment contract: $expected"
    }
}
if ($source -match '(?im)^\s*(Stop-Website|Remove-Website|Stop-WebAppPool|Remove-WebAppPool)\s+-Name\s+["'']?Dashboard\b') {
    throw 'Deployment script unexpectedly manages the legacy Dashboard site or application pool.'
}

$target = Join-Path ([IO.Path]::GetTempPath()) ('dynamic-iis-plan-'+[Guid]::NewGuid().ToString('N'))
$web = Join-Path $target 'web'
$data = Join-Path $target 'private'
$output = & $script -PlanOnly -Port 5190 -WebRoot $web -DataRoot $data 2>&1 | Out-String
if ($output -notmatch 'PlanOnly: no IIS' -or $output -notmatch 'dynamic_dashboard') {
    throw 'Plan mode did not report the expected independent site.'
}
if (Test-Path -LiteralPath $target) {
    throw 'PlanOnly unexpectedly created files or modified folders.'
}

$unsafeData = Join-Path $env:ProgramData 'Dashboard\subdirectory'
$refused = $false
try {
    & $script -PlanOnly -WebRoot $web -DataRoot $unsafeData | Out-Null
} catch { $refused = $true }
if (-not $refused) { throw 'Installer accepted a shared original Dashboard data path.' }

$unsafeWeb = Join-Path $env:SystemDrive 'inetpub\wwwroot\dynamic'
$refused = $false
try {
    & $script -PlanOnly -WebRoot $unsafeWeb -DataRoot $data | Out-Null
} catch { $refused = $true }
if (-not $refused) { throw 'Installer accepted a nested IIS default site webroot.' }

Write-Host 'PASS: new dynamic_dashboard IIS installer plan parses and refuses original-site path collisions.'
