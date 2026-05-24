#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo ""
echo "============================================"
echo "  Storra WMS — запуск на macOS / Linux"
echo "============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ОШИБКА] Node.js не установлен."
  echo "Установите через https://nodejs.org или вашим менеджером пакетов:"
  echo "  macOS: brew install node"
  echo "  Ubuntu/Debian: sudo apt install nodejs npm"
  echo "  Arch: sudo pacman -S nodejs npm"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Первый запуск — устанавливаю зависимости..."
  npm install
fi

echo ""
echo "Запускаю dev-сервер на http://localhost:5173"
echo "Для остановки нажмите Ctrl+C"
echo ""
npm run dev
