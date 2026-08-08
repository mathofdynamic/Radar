$ErrorActionPreference = "Stop"

$username = "radar-operator-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$bytes = New-Object byte[] 36
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($bytes)
}
finally {
    $random.Dispose()
}
$password = [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")

$username | npx wrangler secret put RADAR_DASHBOARD_USERNAME --name radar-pipeline --config wrangler.jsonc
$password | npx wrangler secret put RADAR_DASHBOARD_PASSWORD --name radar-pipeline --config wrangler.jsonc

Write-Host "Dashboard credentials created for radar-pipeline. Save these locally; they will not be shown again:" -ForegroundColor Green
Write-Host "Username: $username"
Write-Host "Password: $password"
