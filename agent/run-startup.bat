@echo off
rem PCにログインした時にタスクスケジューラーから呼ぶ
rem 1. 止め忘れのチェック（売れた商品がまだ出品中なら止める） 2. 値下げの取り戻し（ラクマ・ヤフーフリマ）
cd /d "%~dp0"
if not exist logs mkdir logs
node agent.mjs check-stops >> logs\startup.log 2>&1
node agent.mjs price >> logs\price.log 2>&1
