@echo off
rem タスクスケジューラーから呼ぶ。結果は logs\run.log に追記する
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs run >> logs\run.log 2>&1
