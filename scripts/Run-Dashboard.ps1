param(
    [ValidateRange(1024, 65515)][int]$Port = 5188
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Start-Standalone.ps1') -Port $Port
