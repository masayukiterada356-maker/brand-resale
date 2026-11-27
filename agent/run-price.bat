@echo off
rem Called by Task Scheduler at 19:00 (price drops until 23:59). Log: logs\price.log
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs price >> logs\price.log 2>&1
