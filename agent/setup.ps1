# 初回だけ実行する準備（PowerShellで：右クリック →「PowerShellで実行」）
# 1. 必要な部品を入れる  2. 毎晩の自動実行を登録する

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js が入っていません。https://nodejs.org から LTS 版を入れてから、もう一度実行してください。"
  exit 1
}

# Chromeはパソコンに入っているものを使うので、Playwright用のブラウザはダウンロードしない
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install

if (-not (Test-Path "config.json")) {
  Copy-Item "config.example.json" "config.json"
  Write-Host "config.json を作りました。メモ帳で開いて、appUrl と agentToken を書き換えてください。"
}

# 毎晩 1:13 に下書き作成を実行（パソコンが起きている必要があります）
$bat = Join-Path $PSScriptRoot "run.bat"
schtasks /Create /F /TN "フリマ下書き作成" /SC DAILY /ST 01:13 /TR "`"$bat`"" | Out-Null
Write-Host "タスクスケジューラーに「フリマ下書き作成」（毎晩1:13）を登録しました。"

# 毎晩 21:00 に値下げ（22:00までに終わる）
$bat2 = Join-Path $PSScriptRoot "run-price.bat"
schtasks /Create /F /TN "フリマ値下げ" /SC DAILY /ST 21:00 /TR "`"$bat2`"" | Out-Null
Write-Host "タスクスケジューラーに「フリマ値下げ」（毎晩21:00〜22:00）を登録しました。"
Write-Host "次に「npm run login」で3つのフリマにログインしてください。"
