import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { z } from 'zod';

// Подгружаем .env надёжно, даже если сервер запущен не из папки server/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
];
const envPath = envCandidates.find(path => existsSync(path));
if (envPath) config({ path: envPath });

const INSECURE_DEFAULT_SECRET = 'insecure_dev_secret_do_not_use_in_production';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_FILE: z.string().default('./data/storra.db'),
  JWT_SECRET: z.string().min(16).default(INSECURE_DEFAULT_SECRET),
  JWT_TTL_MINUTES: z.coerce.number().int().positive().default(720),
  CORS_ORIGIN: z.string().default('*'),
  CLIENT_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Лимит попыток входа: max попыток за окно (мс). 10 / 60_000 = 10 за минуту.
  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Сколько дней хранить audit-log. 0 = вечно. По умолчанию 90 дней. */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  // Отдельный токен для интеграций (например, n8n) — не смешиваем с JWT пользователей.
  INTEGRATION_TOKEN: z.string().default(process.env.NODE_ENV === 'test' ? 'test-integration-token' : ''),
});

export const env = schema.parse(process.env);

// В продакшене жёстко запрещаем дефолтный JWT_SECRET — иначе любой подделает токен.
if (env.NODE_ENV === 'production' && env.JWT_SECRET === INSECURE_DEFAULT_SECRET) {
  console.error('');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('  ❌ ОШИБКА: в продакшене запрещено использовать дефолтный JWT_SECRET.');
  console.error('  Задайте JWT_SECRET в server/.env (минимум 32 случайных символа).');
  console.error('  Сгенерировать: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('  Или просто запустите setup.sh / setup.bat — он сделает это автоматически.');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('');
  process.exit(1);
}

if (env.JWT_SECRET === INSECURE_DEFAULT_SECRET) {
  console.warn('');
  console.warn('⚠️  Внимание: используется дефолтный JWT_SECRET (только для разработки!).');
  console.warn('   Для боевого использования задайте уникальный JWT_SECRET в server/.env');
  console.warn('');
}
