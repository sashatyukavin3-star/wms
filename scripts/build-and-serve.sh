#!/usr/bin/env bash
# Собирает production-версию и поднимает локальный сервер на 0.0.0.0:8080
# — другие устройства в локальной сети смогут зайти по IP сервера.
set -e

cd "$(dirname "$0")/.."

echo "==> Сборка production..."
npm run build

if ! command -v npx >/dev/null 2>&1; then
  echo "Нужен npx (поставляется с Node.js)."
  exit 1
fi

echo ""
echo "==> Поднимаю сервер на 0.0.0.0:8080 — заходите с других устройств по IP:"
hostname -I 2>/dev/null | awk '{print "    http://"$1":8080/"}' || true
echo "    Локально: http://localhost:8080/"
echo ""

npx serve -l 8080 -s dist
