. "$PSScriptRoot\MetaApi.ps1"
try {
    $config = Get-MetaConfig
    try {
        $response = Invoke-RestMethod -Uri (Get-MetaModelsEndpoint $config) -Method Get -Headers @{ Authorization = "Bearer $($config.ApiKey)" } -TimeoutSec 30 -ErrorAction Stop
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status) { throw "Meta models request failed with HTTP $status. Response details were intentionally suppressed." }
        throw "Meta models request failed: $($_.Exception.Message)"
    }
    $models = @($response.data | ForEach-Object { [string]$_.id } | Where-Object { $_ })
    $saved = Save-MetaOutput -Name "models" -Value @{ endpoint = (Get-MetaModelsEndpoint $config); configured_model = $config.Model; models = $models; tested_at = (Get-Date).ToUniversalTime().ToString("o") }
    [pscustomobject]@{ ok = $true; configured_model = $config.Model; model_count = $models.Count; models = $models; output = $saved } | ConvertTo-Json
} catch { Write-ToolkitError $_.Exception.Message }
