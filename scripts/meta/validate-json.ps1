param([Parameter(Mandatory)][string]$Path)
. "$PSScriptRoot\MetaApi.ps1"
try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSON file not found: $Path" }
    $value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    $result = @{ valid = $true; path = (Resolve-Path $Path).Path; top_level_type = $value.GetType().Name; validated_at = (Get-Date).ToUniversalTime().ToString("o") }
    $saved = Save-MetaOutput -Name "validation" -Value $result
    $result.output = $saved
    [pscustomobject]$result | ConvertTo-Json
} catch { Write-ToolkitError "JSON validation failed: $($_.Exception.Message)" }
