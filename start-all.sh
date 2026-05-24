#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Storra WMS - start all services"
echo "============================================"

( cd server && npm install && npm start ) &
BACK_PID=$!

( npm install && npm run dev ) &
FRONT_PID=$!

echo "Backend PID : $BACK_PID"
echo "Frontend PID: $FRONT_PID"
echo "WMS frontend: http://localhost:5173"
echo "WMS backend : http://localhost:3000"
echo "Login       : admin / admin123"
wait
