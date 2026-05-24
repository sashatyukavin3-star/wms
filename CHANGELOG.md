# Changelog

История заметных изменений в проекте Storra WMS.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
проект следует [семантическому версионированию](https://semver.org/lang/ru/).

## [Unreleased]

### Безопасность 🔒

- **Закрыты 8 уязвимостей в зависимостях сервера:**
  - 🔴 2 critical: `fast-jwt` (через `@fastify/jwt`) — обход JWT-аутентификации,
    утечка claims между токенами, ReDoS, accept empty HMAC secret.
    Обновлено `@fastify/jwt` 9 → 10.
  - 🟠 1 high: `drizzle-orm` — SQL-инъекция через неэкранированные идентификаторы.
    Обновлено 0.36 → 0.45.
  - 🟡 5 moderate: `@fastify/static` (path traversal в листинге), `esbuild`
    (через transitive `drizzle-kit`). Обновлено `@fastify/static` 8 → 9,
    удалён неиспользуемый `drizzle-kit`.
- После обновлений `npm audit` показывает **0 уязвимостей**.

### Добавлено ✨

- **Vitest** для клиента и сервера с конфигурацией покрытия v8.
- Серверный хелпер `createTestServer()` с in-memory SQLite для изолированных тестов.
- Глобальный setup `src/test/setup.ts` (клиент): моки `matchMedia`, `IntersectionObserver`,
  `ResizeObserver` для тестов React-компонентов.
- Первые 14 тестов:
  - `src/lib/__tests__/api.test.ts` (7 тестов) — `getApiBase()`, защита от
    застрявшего localhost в localStorage.
  - `server/src/routes/__tests__/health.test.ts` (7 тестов) — `/api/health`,
    `/api/auth/login`, `/api/server-info`.
- **GitHub Actions CI** (`.github/workflows/ci.yml`):
  - На каждый push/PR: typecheck + lint + test + build для клиента и сервера.
  - Раз в неделю: `npm audit` для отслеживания новых уязвимостей.
- **ESLint 9 flat config** (`eslint.config.js`) с плагинами:
  - `typescript-eslint` (strict recommended)
  - `eslint-plugin-simple-import-sort` (автосортировка импортов)
  - `eslint-plugin-unused-imports` (автоудаление неиспользуемых)
  - `eslint-plugin-react-hooks` (правила хуков)
- **Prettier с `prettier-plugin-tailwindcss`** — автосортировка Tailwind-классов.
- Новые npm-скрипты для клиента и сервера:
  - `npm test` / `npm run test:watch` / `npm run test:coverage`
  - `npm run lint` / `npm run lint:fix`
  - `npm run format` / `npm run format:check`
  - `npm run check` — typecheck + lint + test одной командой
  - `npm run ci` — то же + format:check (для GitHub Actions)
- `CHANGELOG.md`, `CONTRIBUTING.md`.

### Изменено 🔧

- `server/src/db/index.ts` — поддержка `DATABASE_FILE=':memory:'` (для тестов
  пропускает `mkdirSync` и `journal_mode = WAL`).
- Удалены устаревшие `@typescript-eslint/eslint-plugin` и `@typescript-eslint/parser`
  (заменены метапакетом `typescript-eslint`).
- Удалён старый `.eslintrc.cjs` (заменён на flat config `eslint.config.js`).

---

## [7.1.0] — 2026-05-23

### Добавлено

- Серверная синхронизация инвентаризации (раздел Inventory работает между ПК).
- URL-маршрутизация (`?page=orders`) — F5 не сбрасывает на дашборд.
- Серверный endpoint `/api/dashboard/alerts` — алерты считаются на сервере одним SQL.
- Ротация audit-log (по умолчанию 90 дней, настраивается через `AUDIT_RETENTION_DAYS`).
- Полный ребрендинг под лого Storra (голубая палитра вместо фиолетовой).

### Исправлено

- Бесконечная загрузка приложения на не-secure-context (HTTP без localhost).
- WebSocket уходил на `localhost` при «застрявшем» значении в localStorage.
- Зависимости старых вкладок Service Worker отдавали сломанный кэш — версия v3.

---

## [7.0.0] — 2026-05-21

### Добавлено

- Полная серверная архитектура (Fastify + SQLite + Drizzle + WebSocket).
- Realtime-синхронизация между ПК через WebSocket.
- Автоматическая установка и запуск через `setup.bat` / `setup.sh`.
- Многопользовательская авторизация с ролями (operator/supervisor/admin).
- Rate-limit на логин (10 попыток/минута).
- Раздел «Акты» с генератором строк, Tab-инкрементом, 11 статусами,
  автоматическим расчётом «План/Отбор/Факт», подсветкой расхождений.
- Автосохранение черновиков актов в localStorage с восстановлением при возврате.

### Безопасность

- PBKDF2-SHA256 (210 000 итераций) для legacy-клиента + bcryptjs на сервере.
- Принудительный JWT_SECRET в продакшене (сервер падает с дефолтным).
- Запрет удаления заказов в статусе shipped/picked.
