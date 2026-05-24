@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   Storra WMS - start all services
echo ============================================
echo.

echo [1/2] Starting backend on :3000 ...
start "Storra Backend" cmd /k "cd /d "%~dp0server" && npm install && npm start"

echo [2/2] Starting frontend on :5173 ...
start "Storra Frontend" cmd /k "cd /d "%~dp0" && npm install && npm run dev"

echo.
echo Services are being started in separate windows.
echo WMS frontend: http://localhost:5173
echo WMS backend : http://localhost:3000
echo Login       : admin / admin123
echo Token       : invent_alex20_den26
echo.
start "" http://localhost:5173
pause
