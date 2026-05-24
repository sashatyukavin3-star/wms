@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Storra WMS - Setup

echo.
echo ============================================================
echo    Storra WMS - установка и запуск
echo ============================================================
echo.

REM ===== 1. Node.js =====
where node >nul 2>&1
if errorlevel 1 goto :no_node
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER!
goto :step_client

:no_node
echo.
echo [ОШИБКА] Node.js не установлен.
echo Скачайте Node.js 20 LTS с https://nodejs.org и запустите setup.bat снова.
echo.
pause
exit /b 1

REM ===== 2. Зависимости клиента =====
:step_client
if exist "node_modules\.installed" goto :have_client
echo [1/4] Устанавливаю зависимости клиента. Первый запуск занимает 2-5 минут...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npm_client_fail
echo done > "node_modules\.installed"
goto :step_server

:have_client
echo [OK] Зависимости клиента уже установлены
goto :step_server

:npm_client_fail
echo.
echo [ОШИБКА] Не удалось установить зависимости клиента.
echo Проверьте интернет и попробуйте снова.
echo.
pause
exit /b 1

REM ===== 3. Зависимости сервера =====
:step_server
if exist "server\node_modules\.installed" goto :have_server
echo [2/4] Устанавливаю зависимости сервера...
pushd server
call npm install --no-audit --no-fund
if errorlevel 1 goto :npm_server_fail
popd
echo done > "server\node_modules\.installed"
goto :step_env

:have_server
echo [OK] Зависимости сервера уже установлены
goto :step_env

:npm_server_fail
popd
echo.
echo [ОШИБКА] Не удалось установить зависимости сервера.
echo Проверьте интернет и попробуйте снова.
echo.
pause
exit /b 1

REM ===== 4. server\.env с уникальным JWT_SECRET =====
:step_env
if exist "server\.env" goto :have_env
echo [3/4] Генерирую server\.env с уникальным JWT_SECRET...
REM Записываем секрет во временный файл - так не нужно мучиться с кавычками в cmd.
node "scripts\gen-jwt-secret.cjs" > "%TEMP%\storra_jwt.tmp"
if errorlevel 1 goto :jwt_fail
set /p JWT_SECRET=<"%TEMP%\storra_jwt.tmp"
del "%TEMP%\storra_jwt.tmp" >nul 2>&1
> server\.env echo # Сгенерировано setup.bat - НЕ ПУБЛИКУЙТЕ ЭТОТ ФАЙЛ.
>> server\.env echo PORT=3000
>> server\.env echo HOST=0.0.0.0
>> server\.env echo DATABASE_FILE=./data/storra.db
>> server\.env echo JWT_SECRET=!JWT_SECRET!
>> server\.env echo JWT_TTL_MINUTES=720
>> server\.env echo CORS_ORIGIN=*
>> server\.env echo NODE_ENV=production
echo [OK] server\.env создан с криптостойким JWT_SECRET
goto :step_build

:have_env
echo [OK] server\.env уже существует
goto :step_build

:jwt_fail
echo.
echo [ОШИБКА] Не удалось сгенерировать JWT_SECRET через node.
echo.
pause
exit /b 1

REM ===== 5. Сборка фронта =====
:step_build
if exist "dist\index.html" goto :have_dist
echo [4/4] Собираю фронт. Это занимает 30-60 секунд...
call npm run build
if errorlevel 1 goto :build_fail
goto :run_server

:have_dist
echo [OK] dist уже собран. Чтобы пересобрать после правок в src - удалите папку dist и запустите setup.bat снова.
goto :run_server

:build_fail
echo.
echo [ОШИБКА] Сборка фронта упала. Посмотрите ошибку выше.
echo.
pause
exit /b 1

REM ===== 6. Запуск сервера =====
:run_server
echo.
echo ============================================================
echo    Всё готово. Запускаю сервер...
echo ============================================================
echo.
echo   Открывайте в браузере:
echo     - На этом ПК:  http://localhost:3000
echo.
echo   Чтобы подключиться с других ПК, узнайте IP - в новом окне cmd выполните:
echo     ipconfig
echo   Возьмите IPv4 ^(обычно 192.168.x.x^) и откройте http://этот-IP:3000
echo.
echo   Логин по умолчанию:  admin / admin123
echo   ВАЖНО: смените пароль после первого входа в разделе Настройки.
echo.
echo   Чтобы остановить сервер - нажмите Ctrl+C
echo.

cd server
call npm start
endlocal
