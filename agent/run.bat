@echo off
rem Called by Task Scheduler every night (draft creation). Log: logs\run.log
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs run >> logs\run.log 2>&1
