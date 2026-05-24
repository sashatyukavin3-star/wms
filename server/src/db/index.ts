import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { env } from '../lib/env.ts';
import * as schema from './schema.ts';

// In-memory БД (:memory:) используется в тестах — для неё директория не нужна.
const isInMemory = env.DATABASE_FILE === ':memory:';
if (!isInMemory) {
  mkdirSync(dirname(env.DATABASE_FILE), { recursive: true });
}

export const sqlite = new Database(env.DATABASE_FILE);
// WAL = быстрее запись и параллельные чтения.
// Для :memory: WAL не нужен и не работает — оставляем дефолтный journal_mode.
if (!isInMemory) {
  sqlite.pragma('journal_mode = WAL');
}
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
