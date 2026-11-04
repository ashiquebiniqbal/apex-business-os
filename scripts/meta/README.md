# Meta API development toolkit

These scripts are for PowerShell development experiments only. They do not change the Codex model provider.

Set environment variables in the current PowerShell session without printing them:

```powershell
$env:META_API_URL = "https://api.meta.ai/v1/responses"
$env:META_MODEL = "muse-spark-1.3"
$env:META_API_KEY = "your-secret-key"
```

Run from the project root:

```powershell
./scripts/meta/test-connectivity.ps1
./scripts/meta/test-models.ps1
./scripts/meta/analyze-inquiry.ps1
./scripts/meta/analyze-document.ps1 -Path .\safe-development-note.txt -ConfirmNoSensitiveData
./scripts/meta/validate-json.ps1 -Path .\outputs\meta\some-result.json
```

Scripts never print or save the API key. They use Meta's Responses API (`model` + `input`). Results are JSON and are written to `outputs/meta/`.
