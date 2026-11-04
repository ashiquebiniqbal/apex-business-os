. "$PSScriptRoot\MetaApi.ps1"
try {
    $config = Get-MetaConfig
    $response = Invoke-MetaChat -Config $config -Messages @(
        @{ role = "system"; content = "Return only valid JSON with keys ok and message." },
        @{ role = "user"; content = 'Connectivity test. Return {"ok":true,"message":"connected"}.' }
    )
    $result = ConvertTo-StructuredJson (Get-MetaText $response)
    $saved = Save-MetaOutput -Name "connectivity" -Value @{ ok = [bool]$result.ok; message = [string]$result.message; model = $config.Model; endpoint = $config.Endpoint; tested_at = (Get-Date).ToUniversalTime().ToString("o") }
    [pscustomobject]@{ ok = $true; model = $config.Model; endpoint = $config.Endpoint; output = $saved } | ConvertTo-Json
} catch { Write-ToolkitError $_.Exception.Message }
