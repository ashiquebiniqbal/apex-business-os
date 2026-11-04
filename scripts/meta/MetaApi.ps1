Set-StrictMode -Version Latest

function Get-MetaConfig {
    $apiKey = $env:META_API_KEY
    $endpoint = if ($env:META_API_URL) { $env:META_API_URL } else { "https://api.meta.ai/v1/responses" }
    $model = $env:META_MODEL

    if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "META_API_KEY is not set." }
    if ([string]::IsNullOrWhiteSpace($endpoint)) { throw "META_API_URL is not set." }
    if ([string]::IsNullOrWhiteSpace($model)) { throw "META_MODEL is not set." }

    [uri]$parsed = $endpoint
    if ($parsed.Scheme -ne "https") { throw "META_API_URL must use HTTPS." }
    if ($endpoint -notmatch "/responses/?$") { throw "META_API_URL must point to the verified Responses endpoint." }

    return @{ ApiKey = $apiKey; Endpoint = $endpoint.TrimEnd('/'); Model = $model }
}

function Get-MetaModelsEndpoint([hashtable]$Config) {
    return ($Config.Endpoint -replace "/responses/?$", "/models")
}

function Invoke-MetaChat {
    param(
        [Parameter(Mandatory)] [hashtable]$Config,
        [Parameter(Mandatory)] [array]$Messages,
        [int]$TimeoutSec = 45
    )

    $instruction = @($Messages | Where-Object { $_.role -in @("system", "developer") } | ForEach-Object { [string]$_.content }) -join "`n"
    $input = @($Messages | Where-Object { $_.role -eq "user" } | ForEach-Object { [string]$_.content }) -join "`n"
    $body = @{ model = $Config.Model; instructions = $instruction; input = $input; store = $false; text = @{ format = @{ type = "json_object" } } } | ConvertTo-Json -Depth 20
    try {
        return Invoke-RestMethod -Uri $Config.Endpoint -Method Post -Headers @{ Authorization = "Bearer $($Config.ApiKey)" } -ContentType "application/json" -Body $body -TimeoutSec $TimeoutSec -ErrorAction Stop
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status) { throw "Meta API request failed with HTTP $status. Response details were intentionally suppressed." }
        throw "Meta API request failed: $($_.Exception.Message)"
    }
}

function Get-MetaText($Response) {
    if ($Response.output_text) { return [string]$Response.output_text }
    $text = @($Response.output | ForEach-Object { $_.content } | ForEach-Object { $_ } | Where-Object { $_.type -eq "output_text" } | ForEach-Object { $_.text }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($text)) { throw "Meta API returned no assistant content." }
    return $text
}

function ConvertTo-StructuredJson([string]$Text) {
    $clean = $Text.Trim() -replace '^```json\s*', '' -replace '^```\s*', '' -replace '\s*```$', ''
    try { return ($clean | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "Meta response was not valid JSON." }
}

function Save-MetaOutput {
    param([Parameter(Mandatory)] [string]$Name, [Parameter(Mandatory)] $Value)
    $root = Join-Path $PSScriptRoot "..\..\outputs\meta"
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $path = Join-Path $root "$timestamp-$Name.json"
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $path -Encoding UTF8
    return (Resolve-Path $path).Path
}

function Write-ToolkitError([string]$Message) {
    [Console]::Error.WriteLine("META_TOOLKIT_ERROR: $Message")
    exit 1
}
