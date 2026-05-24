# Гайд разработчика

Короткий справочник как работать с проектом — для вас же через полгода или новых
коллег.

## Структура проекта

```
storra-wms/
├── src/                # Клиент: React + Vite + Tailwind
│   ├── components/     # Переиспользуемые UI-компоненты
│   ├── hooks/          # Кастомные React-хуки (useData и т.п.)
│   ├── lib/            # Сервисы (api, ws, services, sync, sounds)
│   ├── pages/          # Страницы-разделы (одна = один маршрут)
│   ├── print/          # HTML-шаблоны печати (акты, стикеры)
│   ├── test/           # Vitest setup, моки
│   ├── App.tsx         # Каркас: маршрутизация, сайдбар, header, тосты
│   ├── db.ts           # Dexie (локальный кэш + auth)
│   └── main.tsx        # Точка входа
├── server/             # Сервер: Fastify + SQLite + Drizzle
│   ├── src/
│   │   ├── db/         # Схема, миграции, seed
│   │   ├── lib/        # env (zod)
│   │   ├── middleware/ # requireAuth, requireRole
│   │   ├── routes/     # Все REST endpoints
│   │   ├── services/   # Бизнес-логика без HTTP (audit, audit-rotation)
│   │   ├── test/       # createTestServer для интеграционных тестов
│   │   ├── ws/         # WebSocket hub
│   │   └── index.ts    # Bootstrap сервера
│   └── package.json
├── public/             # Статика: иконки PWA, manifest, sw.js
├── scripts/            # Helper-скрипты (gen-jwt-secret.cjs и т.п.)
├── setup.bat / .sh     # Универсальный установщик для пользователя
└── package.json
```

## Команды разработки

### Клиент

```bash
npm install            # Установить зависимости
npm run dev            # Vite dev-сервер с HMR на http://localhost:5173
npm run build          # Сборка production single-file HTML в dist/

# Качество кода:
npm run typecheck      # TypeScript без эмита
npm run lint           # ESLint
npm run lint:fix       # ESLint с автофиксом
npm run format         # Prettier (форматирование)
npm run format:check   # Prettier (только проверка)

# Тесты:
npm test               # Vitest run
npm run test:watch     # Vitest в watch-режиме
npm run test:coverage  # С отчётом покрытия (открывается в coverage/index.html)

# Всё сразу:
npm run check          # typecheck + lint + test
npm run ci             # format:check + typecheck + lint + test (для CI)
```

### Сервер

```bash
cd server
npm install
npm run dev            # tsx watch с автоперезагрузкой
npm start              # Запуск production-сервера

# То же что у клиента:
npm run typecheck
npm run lint / lint:fix
npm test / test:watch / test:coverage
npm run check / ci

# Работа с БД:
npm run db:migrate     # Применить миграции (создать схему)
npm run db:seed        # Создать admin/admin123 и дефолтные настройки
```

### Запустить всё для пользователя

```bash
./setup.sh             # macOS/Linux: ставит зависимости, генерирует JWT, билдит, запускает
./setup.bat            # Windows
```

## Принципы разработки

### Безопасность

- **Не клади `JWT_SECRET` в репозиторий.** `setup.sh/bat` его генерирует.
  В продакшене сервер падает с дефолтным секретом.
- **Любой mutating endpoint** требует `requireAuth` или `requireRole(...)`.
- **Любой `req.body`** валидируется через `zod` в `safeParse`.
- **Любые SQL-параметры** через Drizzle builder, не сырые шаблоны.

### Тестирование

- Бизнес-логика, через которую идут деньги/остатки (приёмка, отгрузка, перемещение,
  инвентаризация, резервы) — обязательно покрывается тестом.
- Используем `createTestServer()` из `server/src/test/` — он даёт изолированный
  Fastify-сервер с in-memory SQLite. Каждый `beforeEach` создаёт свежий, `afterEach`
  закрывает.
- Для асинхронных React-хуков — `@testing-library/react` + `userEvent`.

### TypeScript

- `strict: true` — обязательно.
- Никаких `any` в новом коде. Если данные «непредсказуемого типа» (payload от
  сервера) — `zod`-схема с runtime-валидацией.
- Существующие `any` помечены `// TODO: убрать в #3` и подсвечены как warning
  в ESLint. Постепенно вычищаем.

### Стиль кода

- Prettier автоматически форматирует при `npm run format`.
- `prettier-plugin-tailwindcss` сортирует классы Tailwind в каноническом порядке.
- ESLint автосортирует импорты через `simple-import-sort`.
- Перед коммитом стоит запустить `npm run check`.

### Git workflow

- `main` — стабильная ветка, всё проходит CI.
- `dev` / `feature/xxx` — рабочие ветки.
- PR в main → CI прогоняет typecheck, lint, test, build. Красный — не мержим.

## Где что искать

| Хочу... | Ищу в... |
|---|---|
| Добавить новый endpoint | `server/src/routes/` (новый файл или существующий) |
| Добавить таблицу в БД | `server/src/db/schema.ts` + DDL в `server/src/db/migrate.ts` |
| Изменить логику склад-операции | `server/src/routes/stock.ts` (receive/ship/move) |
| Добавить новую страницу | `src/pages/` + регистрация в `src/App.tsx` (`NAV_ITEMS`) |
| Изменить общий стиль/палитру | `src/index.css` (CSS-переменные `--color-nexus-*`) |
| Добавить переменную окружения | `server/src/lib/env.ts` (zod) + `server/.env.example` |
| Добавить WS-эвент | `server/src/ws/hub.ts` (тип) + `broadcast` в нужном route |
| Изменить лого | `src/components/StorraLogo.tsx` + `public/icon-*.svg` |

## Что НЕ делать

- ❌ Не кладите `node_modules`, `dist`, `server/data` в git (уже в `.gitignore`).
- ❌ Не добавляйте зависимости без понимания зачем (см. CHANGELOG для контекста).
- ❌ Не используйте `console.log` в продакшен-коде (будет логгер в одной из задач).
- ❌ Не пишите бизнес-логику в `*.tsx`-компонентах — выносите в `lib/` или хуки.
