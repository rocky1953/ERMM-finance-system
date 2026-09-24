@echo off
chcp 65001 >nul
title ERMM 財務模組管理系統
cd /d e:\finance
echo ============================================
echo   ERMM 財務模組管理系統 啟動中...
echo ============================================
echo.
node app.js
pause
