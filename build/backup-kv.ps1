#!/usr/bin/env pwsh
# KV 备份导出。在 D:\zhouyi-site 根目录执行：pwsh build\backup-kv.ps1
# 产出 worker\backups\kv-<时间戳>.jsonl
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $root 'worker\backups'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "kv-$stamp.jsonl"

$env:CLOUDFLARE_API_TOKEN = (Get-Content (Join-Path $root 'worker\.cf-token') -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = '3c42788f6e1e9a866634592a37ca0da2'

Push-Location (Join-Path $root 'worker')
try {
  & 'D:\cache\npm-global\wrangler.cmd' kv key list --binding=KEYS --remote --path $out
  Write-Host "OK exported -> $out"
} finally {
  Pop-Location
}
Write-Host "Keep backups\\ off this machine too (cloud drive / second disk)."
