@echo off
chcp 65001 >nul
title 知行读书 - 启动中...
echo.
echo  ========================================
echo   知行读书 - AI阅读成长助手
echo  ========================================
echo.
echo  正在启动应用，请稍候...
echo.
cd /d "%~dp0"
npm run dev
pause
