#!/usr/bin/env bash
# Storra WMS — единый установщик и запускатор для macOS / Linux.
# Делает ВСЁ за вас:
#   1. Проверяет Node.js
#   2. Ставит зависимости клиента и сервера (если их нет или они старые)
#   3. Собирает фронт в dist/
#   4. Генерирует server/.env с уникальным JWT_SECRET (если ещё нет)
#   5. Запускает сервер на 0.0.0.0:3000 (доступен с других ПК в сети)
#
# Использование:
#   chmod +x setup.sh
#   ./setup.sh

set -e
cd "$(dirname "$0")"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}   🚀 Storra WMS — установка и запуск${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# ─── 1. Node.js ─────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}[ОШИБКА] Node.js не установлен.${NC}"
  echo "  Установите Node.js 20 LTS: https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}[ОШИБКА] Нужен Node.js 18+ (у вас $(node -v)).${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# ─── 2. Зависимости клиента ─────────────────────────────────
NEED_CLIENT_INSTALL=0
if [ ! -d "node_modules" ]; then
  NEED_CLIENT_INSTALL=1
elif [ "package-lock.json" -nt "node_modules/.package-lock-stamp" ] 2>/dev/null; then
  NEED_CLIENT_INSTALL=1
fi
if [ "$NEED_CLIENT_INSTALL" = "1" ]; then
  echo -e "${CYAN}[1/4]${NC} Ставлю зависимости клиента (это бывает медленно при первом запуске)..."
  npm install --no-audit --no-fund
  touch node_modules/.package-lock-stamp
else
  echo -e "${GREEN}✓${NC} Зависимости клиента актуальны"
fi

# ─── 3. Зависимости сервера ────────────────────────────────
NEED_SERVER_INSTALL=0
if [ ! -d "server/node_modules" ]; then
  NEED_SERVER_INSTALL=1
elif [ "server/package-lock.json" -nt "server/node_modules/.package-lock-stamp" ] 2>/dev/null; then
  NEED_SERVER_INSTALL=1
fi
if [ "$NEED_SERVER_INSTALL" = "1" ]; then
  echo -e "${CYAN}[2/4]${NC} Ставлю зависимости сервера..."
  (cd server && npm install --no-audit --no-fund)
  touch server/node_modules/.package-lock-stamp
else
  echo -e "${GREEN}✓${NC} Зависимости сервера актуальны"
fi

# ─── 4. .env с уникальным JWT_SECRET ───────────────────────
if [ ! -f "server/.env" ]; then
  echo -e "${CYAN}[3/4]${NC} Генерирую server/.env с уникальным JWT_SECRET..."
  JWT_SECRET=$(node scripts/gen-jwt-secret.cjs)
  INTEGRATION_TOKEN=$(node scripts/gen-jwt-secret.cjs)
  cat > server/.env <<EOF
# Сгенерировано setup.sh — НЕ ПУБЛИКУЙТЕ ЭТОТ ФАЙЛ.
PORT=3000
HOST=0.0.0.0
DATABASE_FILE=./data/storra.db
JWT_SECRET=${JWT_SECRET}
JWT_TTL_MINUTES=720
CORS_ORIGIN=*
NODE_ENV=production
INTEGRATION_TOKEN=${INTEGRATION_TOKEN}
EOF
  echo -e "${GREEN}✓${NC} server/.env создан с криптостойким JWT_SECRET"
else
  echo -e "${GREEN}✓${NC} server/.env уже есть (не перезаписываю)"
fi

# ─── 5. Сборка фронта ──────────────────────────────────────
NEED_BUILD=0
if [ ! -f "dist/index.html" ]; then
  NEED_BUILD=1
elif find src -newer dist/index.html -type f 2>/dev/null | grep -q .; then
  NEED_BUILD=1
fi
if [ "$NEED_BUILD" = "1" ]; then
  echo -e "${CYAN}[4/4]${NC} Собираю фронт (production)..."
  npm run build
else
  echo -e "${GREEN}✓${NC} dist/ актуален"
fi

# ─── 6. Запуск ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}   ✅ Всё готово. Запускаю сервер...${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  ${YELLOW}Открывайте в браузере:${NC}"
echo -e "    • На этом ПК: ${CYAN}http://localhost:3000${NC}"
# Печатаем IP сети, чтобы видно было, по какому адресу подключаться с других ПК.
if command -v hostname >/dev/null 2>&1; then
  IPS=$(hostname -I 2>/dev/null || hostname -i 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true)
  for ip in $IPS; do
    case "$ip" in
      127.*|::1|fe80:*) ;;
      *) echo -e "    • С других ПК в сети: ${CYAN}http://${ip}:3000${NC}" ;;
    esac
  done
fi
echo ""
echo -e "  ${YELLOW}Логин по умолчанию:${NC} admin / admin123  (СМЕНИТЕ ПОСЛЕ ВХОДА!)"
echo ""
echo -e "  ${YELLOW}Чтобы остановить сервер — нажмите Ctrl+C${NC}"
echo ""

cd server && exec npm start
