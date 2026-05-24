/**
 * Vitest globalSetup: выставляется ОДИН раз до загрузки любых тестов.
 *
 * Зачем: env.ts читает process.env при первом импорте и кэширует в `env`.
 * Если выставить переменные после импорта — поздно, БД уже создалась в файле.
 * Поэтому нужен globalSetup, который выполняется до всего остального.
 */

// Без NODE_ENV='test' env-валидация может ругаться на отсутствие production-полей.
process.env.NODE_ENV = 'test';

// In-memory SQLite — никакого мусора на диске.
process.env.DATABASE_FILE = ':memory:';

// Стабильный JWT для предсказуемости тестов.
process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-prod-xxxxxxxxxxxxxxxxxxxxxxxx';

// Отключаем rate-limit на логин в тестах (иначе после 10 успешных тестов получим 429).
process.env.LOGIN_RATE_MAX = '10000';

// Выключаем ротацию audit (для тестов не нужна).
process.env.AUDIT_RETENTION_DAYS = '0';

export default function setup() {
  // Ничего runtime не делаем — все нужные env уже выставлены выше.
}
