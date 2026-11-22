@echo off
rem 毎晩19時と、PCにログインした時にタスクスケジューラーから呼ぶ（23:59まで）。結果は logs\price.log に追記する
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs price >> logs\price.log 2>&1
