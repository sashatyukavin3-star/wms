@echo off
chcp 65001 > nul
cd /d "%~dp0\.."

echo.
echo ============================================
echo   Storra WMS - запуск на Windows
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не установлен.
    echo Скачайте с https://nodejs.org и перезапустите этот скрипт.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Первый запуск - устанавливаю зависимости...
    call npm install
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось установить зависимости.
        pause
        exit /b 1
    )
)

echo.
echo Запускаю dev-сервер на http://localhost:5173
echo Для остановки нажмите Ctrl+C
echo.
call npm run dev
pause
