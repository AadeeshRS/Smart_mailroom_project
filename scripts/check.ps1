#Requires -Version 7
<#
  Every check before a push (plan §0 rule 9), stopping at the first failure: contracts, API (typecheck, tests,
  format), mobile (typecheck, lint, tests, format), then a web export and both browser suites.

    pwsh scripts/check.ps1               everything
    pwsh scripts/check.ps1 -SkipBrowser  only when no API or mobile behaviour changed

  The API tests and browser suites use the local smart_mailroom_test database (api/.env.test), never Neon.
#>
param([switch]$SkipBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# npm and npx can be .ps1 shims, which native-command error handling doesn't cover, so check every exit code.
function Run {
  $command, $arguments = $args
  & $command @arguments
  if ($LASTEXITCODE) { throw "'$args' failed with exit code $LASTEXITCODE." }
}

function Step([string]$name, [string]$folder, [scriptblock]$commands) {
  Write-Host "== $name" -ForegroundColor Cyan
  Push-Location (Join-Path $root $folder)
  try { & $commands } finally { Pop-Location }
}

Step 'contracts' 'contracts' {
  Run npm run generate
  Run npm run validate
  Run npm run check
  Run git diff --exit-code -- generated ../mobile/src/api/routes.generated.ts
}
Step 'api' 'api' {
  Run npx tsc --noEmit
  Run npm test
  Run npm run format:check
}
Step 'mobile' 'mobile' {
  Run npm run typecheck
  Run npm run lint
  Run npm test
  Run npm run format:check
}
if (-not $SkipBrowser) {
  Step 'web export for the HTTP suite' 'mobile' {
    $saved = $env:NODE_ENV, $env:EXPO_PUBLIC_API_BASE_URL
    $env:NODE_ENV = 'production'
    $env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:3100/v1'
    try { Run node node_modules/expo/bin/cli export --clear --platform web --max-workers 2 --output-dir dist-http }
    finally { $env:NODE_ENV, $env:EXPO_PUBLIC_API_BASE_URL = $saved }
  }
  Step 'HTTP browser suite' 'mobile' { Run npx playwright test -c playwright.http.config.ts }
  Step 'dev-renderer browser suite' 'mobile' { Run npx playwright test -c playwright.dev.config.ts }
}
Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green
