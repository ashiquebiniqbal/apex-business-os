param([Parameter(Mandatory)][string]$Path, [switch]$ConfirmNoSensitiveData)
. "$PSScriptRoot\MetaApi.ps1"
try {
    if (-not $ConfirmNoSensitiveData) { throw "Pass -ConfirmNoSensitiveData only after confirming the document contains no customer secrets or personal data." }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Document not found: $Path" }
    $content = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($content)) { throw "Document is empty." }
    if ($content.Length -gt 100000) { throw "Document exceeds the 100,000-character development limit." }
    $config = Get-MetaConfig
    $response = Invoke-MetaChat -Config $config -Messages @(
        @{ role = "system"; content = "Analyze this generic development document. Return only JSON with keys summary, key_points, risks, follow_up_questions. Do not infer confidential facts." },
        @{ role = "user"; content = $content }
    )
    $analysis = ConvertTo-StructuredJson (Get-MetaText $response)
    $saved = Save-MetaOutput -Name "document-analysis" -Value @{ model = $config.Model; endpoint = $config.Endpoint; source_file = (Split-Path $Path -Leaf); analysis = $analysis; tested_at = (Get-Date).ToUniversalTime().ToString("o") }
    [pscustomobject]@{ ok = $true; analysis = $analysis; output = $saved } | ConvertTo-Json -Depth 20
} catch { Write-ToolkitError $_.Exception.Message }
