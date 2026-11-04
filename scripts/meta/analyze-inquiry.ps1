param([string]$Inquiry = "A small business wants two Operations Suite licenses and asks for a quotation.")
. "$PSScriptRoot\MetaApi.ps1"
try {
    $config = Get-MetaConfig
    $response = Invoke-MetaChat -Config $config -Messages @(
        @{ role = "system"; content = "Analyze a generic business inquiry. Return only JSON with keys intent, requested_items, missing_information, suggested_next_action. Never invent price, tax, stock, customer identity, or product availability." },
        @{ role = "user"; content = $Inquiry }
    )
    $analysis = ConvertTo-StructuredJson (Get-MetaText $response)
    $saved = Save-MetaOutput -Name "inquiry-analysis" -Value @{ model = $config.Model; endpoint = $config.Endpoint; analysis = $analysis; tested_at = (Get-Date).ToUniversalTime().ToString("o") }
    [pscustomobject]@{ ok = $true; analysis = $analysis; output = $saved } | ConvertTo-Json -Depth 20
} catch { Write-ToolkitError $_.Exception.Message }
