# Storra WMS — Server

Многопользовательский серверный бэкенд для Storra WMS.
Один Node.js процесс + SQLite-файл = всё что нужно.

## ⚡ Быстрый старт (на любом ПК)

```bash
# 1. Установить Node.js 20+ (https://nodejs.org)

# 2. Установить зависимости
cd server
npm install

# 3. (Опционально) Скопировать .env и поменять JWT_SECRET
cp .env.example .env

# 4. Запустить
npm start
```

Сервер напечатает баннер с IP-адресами:
```
  ╔══════════════════════════════════════════════════════════╗
  ║  🚀 Storra WMS Server                                    ║
  ╠══════════════════════════════════════════════════════════╣
  ║  Подключаются:                                           ║
  ║    • локально:    http://localhost:3000                  ║
  ║    • в сети:      http://192.168.1.42:3000               ║
  ║                                                          ║
  ║  По умолчанию: admin / admin123 (СМЕНИТЕ!)               ║
  ╚══════════════════════════════════════════════════════════╝
```

С любого ТСД/ПК в той же сети — открываешь `http://192.168.1.42:3000/` и работаешь.

## 🏗 Стек

- **Fastify 5** — REST-фреймворк (быстрее Express в 2-3 раза)
- **better-sqlite3** + **Drizzle ORM** — БД (всё в одном файле `data/storra.db`)
- **@fastify/jwt** + **bcryptjs** — авторизация (JWT, 10 раундов bcrypt)
- **@fastify/websocket** — realtime: при изменении на одном клиенте все остальные узнают за 100 мс
- **Zod** — валидация всех входящих данных
- **TSX** — запуск TypeScript без билда (один процесс, hot-reload)

## 📁 Структура

```
server/
├── src/
│   ├── index.ts              # точка входа: Fastify, WS, routes, баннер
│   ├── lib/env.ts            # парсинг переменных окружения (Zod)
│   ├── db/
│   │   ├── schema.ts         # Drizzle-схема всех таблиц
│   │   ├── index.ts          # подключение к SQLite + WAL-режим
│   │   ├── migrate.ts        # DDL миграции (CREATE TABLE IF NOT EXISTS)
│   │   └── seed.ts           # дефолтный админ + базовые настройки
│   ├── middleware/auth.ts    # requireAuth / requireRole
│   ├── services/audit.ts     # запись аудита действий пользователей
│   ├── ws/hub.ts             # broadcast WebSocket-событий
│   └── routes/
│       ├── auth.ts           # login / me / users CRUD
│       ├── asn.ts            # ASN / ожидаемые поставки, QC и приёмка по строкам
│       ├── products.ts       # справочник товаров + bulk
│       ├── cells.ts          # справочник ячеек + расширенные свойства bin/location
│       ├── stock.ts          # остатки + АТОМАРНЫЕ операции (receive/ship/move)
│       ├── orders.ts         # заказы + резервы + pick list + packing
│       ├── replenishment.ts  # пополнение picking-face из storage ячеек
│       ├── returns.ts        # возвраты / reverse flow / quarantine / scrap
│       ├── cycleCount.ts     # directed cycle count / кандидаты / apply adjustments
│       ├── search.ts         # глобальный поиск по сущностям WMS
│       ├── acts.ts           # акты осмотра / переборки
│       └── misc.ts           # settings, audit, backup, server-info
├── data/                     # SQLite файлы (создаётся автоматически)
└── .env.example
```

## 🔐 Авторизация

- При входе клиент шлёт `POST /api/auth/login` → получает JWT-токен
- Все защищённые роуты ждут `Authorization: Bearer <token>`
- WebSocket: токен передаётся в query: `ws://host/api/ws?token=...`
- Роли: `operator < supervisor < admin`
- Пароли — bcrypt (10 rounds), никогда не хранятся в открытом виде

## 🔄 Realtime-синхронизация

При любом изменении сервер шлёт WS-событие всем подключённым клиентам:

```json
{ "type": "stock:changed", "barcode": "4607...", "cell": "A-01-01" }
{ "type": "order:changed", "id": 42 }
{ "type": "act:changed", "kind": "rework", "id": 7 }
```

Клиент по событию заново подтягивает изменившуюся сущность через REST.
Это надёжнее чем «прислать всё в WS» — даже при потере события данные не разойдутся.

## 🛡 Атомарность

Все операции, изменяющие остатки (приёмка / отгрузка / перемещение),
обёрнуты в `db.transaction(...)` SQLite. Это гарантирует:

- При параллельных запросах остаток никогда не уйдёт в минус
- При ошибке посередине операции — откат, ничего не сломается
- Резервы под заказы и журнал операций пишутся в той же транзакции

## 📡 API-эндпоинты (краткая шпаргалка)

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/auth/login` | Логин → JWT |
| GET | `/api/auth/me` | Информация о текущем пользователе |
| GET | `/api/products?since=ts` | Список товаров (дельта по updated_at) |
| PUT | `/api/products` | Upsert одного товара |
| POST | `/api/products/bulk` | Массовый импорт (CSV) |
| GET | `/api/cells?since=ts` | Список ячеек |
| GET | `/api/stock?since=ts` | Остатки |
| POST | `/api/ops/receive` | Атомарная приёмка |
| POST | `/api/ops/ship` | Атомарная отгрузка |
| POST | `/api/ops/move` | Атомарное перемещение |
| GET | `/api/ops?limit=100` | Журнал операций |
| GET | `/api/replenishment/suggestions` | Предложения пополнения picking-face |
| POST | `/api/replenishment/execute` | Выполнить пополнение |
| GET/POST | `/api/returns` | Документы возврата |
| POST | `/api/returns/:id/process` | Обработать возврат: restock / quarantine / scrap |
| GET/POST | `/api/asn` | ASN / ожидаемые поставки |
| POST | `/api/asn/:id/mark-arrived` | Отметить прибытие ASN |
| POST | `/api/asn/:id/receive` | Принять строку ASN в остатки, включая брак/расхождения |
| GET/POST | `/api/orders` | Заказы |
| POST | `/api/orders/:id/pack` | Упаковать полностью собранный заказ |
| POST | `/api/orders/:id/reserve` | FIFO-резервирование |
| GET | `/api/orders/:id/picklist` | План комплектации (с сортировкой по маршруту) |
| GET | `/api/acts/inspection` | Акты осмотра ячеек |
| GET | `/api/acts/rework` | Акты переборки |
| GET | `/api/audit?limit=300` | Журнал действий пользователей |
| GET | `/api/backup` | Полный бэкап (JSON, скачивается) |
| POST | `/api/restore` | Восстановление из бэкапа |
| GET | `/api/server-info` | Метрика: счётчики таблиц, кол-во WS-клиентов |
| GET | `/api/health` | Пинг для мониторинга |
| GET | `/api/search/global?q=...` | Глобальный поиск по ключевым сущностям WMS |
| GET | `/api/cycle-counts/suggestions` | Кандидаты на выборочный пересчёт |
| GET/POST | `/api/cycle-counts` | Задачи cycle count |
| POST | `/api/cycle-counts/:id/apply` | Применить корректировки cycle count |
| WS | `/api/ws?token=...` | Realtime-события |

## 🔌 Integration API (AI / automation)

Для внешних automation-сценариев добавлен отдельный integration token.
Это безопаснее, чем использовать живого пользователя `admin` в n8n.

### Авторизация

Передавайте один из заголовков:

```http
X-Integration-Token: <INTEGRATION_TOKEN>
```

или

```http
Authorization: Bearer <INTEGRATION_TOKEN>
```

### Эндпоинты

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/integrations/health` | Проверка integration-слоя |
| GET | `/api/integrations/products/:barcode` | Карточка товара по barcode |
| GET | `/api/integrations/stock/:barcode` | Остатки и размещение товара по barcode |
| GET | `/api/integrations/orders/:id` | Заказ с линиями, резервами и stock summary |
| GET | `/api/integrations/orders/:id/analysis` | Детерминированный анализ проблем заказа |
| GET | `/api/integrations/search?q=...` | Поиск по товарам / ячейкам / заказам |
| GET | `/api/integrations/low-stock` | Список позиций ниже минимального остатка |
| GET | `/api/integrations/expiring-stock?days=30` | Партии с истекающим сроком |
| GET | `/api/integrations/daily-digest?hours=24&top=5` | Сводка по операциям, заказам и алертам |
| GET | `/api/integrations/backup` | Экспорт полного JSON backup |



Для AI-сервиса в папке `../storra-ai/` особенно полезны endpoints:

- `/api/integrations/orders/:id`
- `/api/integrations/products/:barcode`
- `/api/integrations/stock/:barcode`

Они дают read-only контекст для LangChain-ассистента без прямого доступа к БД.


### Hermes / external agent readiness

Для внешних агентных систем (например, Hermes Agent) добавлены специальные read-only endpoints:

- `/api/integrations/orders/:id/analysis` — разбор блокирующих линий и дефицитов
- `/api/integrations/search?q=...` — быстрый поиск сущностей

Это позволяет строить Telegram/CLI-ассистентов поверх WMS без прямого доступа к БД и без write-операций.

## 🔧 Конфигурация (`.env`)

| Переменная | Дефолт | Что значит |
|---|---|---|
| `PORT` | `3000` | Порт сервера |
| `HOST` | `0.0.0.0` | `0.0.0.0` = слушать все интерфейсы, `127.0.0.1` = только локально |
| `DATABASE_FILE` | `./data/storra.db` | Где лежит SQLite |
| `JWT_SECRET` | dev-default | **Обязательно** смените в продакшене (32+ символов) |
| `JWT_TTL_MINUTES` | `720` (12 ч) | Срок жизни токена |
| `CORS_ORIGIN` | `*` | Разрешённые источники для CORS |
| `CLIENT_DIR` | `../../dist` | Папка со статикой фронта (если сервер раздаёт ещё и клиент) |

## 💾 Бэкапы

**Простейший способ** — копирование файла БД:
```bash
# Хорошо для остановленного сервера или WAL-режима SQLite (поддерживает горячее копирование)
cp data/storra.db backups/storra-$(date +%Y%m%d-%H%M%S).db
```

**Через API** (даже на работающем сервере):
```bash
curl http://localhost:3000/api/backup \
  -H "Authorization: Bearer $TOKEN" \
  -o backup-$(date +%Y%m%d).json
```

В UI клиента: **Настройки → Резервное копирование**.

## 🧪 Проверить, что всё работает

```bash
# Health
curl http://localhost:3000/api/health
# {"ok":true,"ts":...,"clients":0}

# Логин
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## 🐛 Частые проблемы

### `EADDRINUSE: address already in use`
Порт занят. Поменяй `PORT` в `.env` или останови старый процесс.

### Клиент не подключается с другого ПК
Проверь:
1. `HOST=0.0.0.0` в `.env` (не `127.0.0.1`)
2. Файрвол на сервере разрешает входящие на порту (Windows: `New-NetFirewallRule`)
3. Оба ПК в одной сети (`ping <ip>`)

### «Недостаточно остатков» при отгрузке, хотя они есть
В разных ячейках. Отгрузка идёт из **конкретной** ячейки. Используй Pick List или сначала перемести товар.

### Нужно сбросить БД и начать с нуля
```bash
rm data/storra.db
npm start   # пересоздаст и засидит дефолтным админом
```
