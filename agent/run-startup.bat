@echo off
rem Called by Task Scheduler at logon: 1) stop-check for sold items 2) catch up price drops
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs check-stops >> logs\startup.log 2>&1
node agent.mjs price >> logs\price.log 2>&1
