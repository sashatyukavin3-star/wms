/**
 * Базовая инициализация БД: создание дефолтного админа и базовых настроек.
 * Вызывается на каждом старте сервера — идемпотентно.
 */

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

import { db } from './index.ts';
import { settings,users } from './schema.ts';

const DEFAULT_ADMIN_PASSWORD = 'admin123';

export async function seed() {
  // 1. Дефолтные настройки
  const defaults: Record<string, string> = {
    warehouse_name: 'Основной склад',
    warehouse_addr: '',
    fifo_mode: 'fifo',
    abc_period_days: '90',
    nelikvid_days: '90',
    expiry_warn_days: '30',
    sounds_enabled: '1',
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.insert(settings).values({ key, value }).onConflictDoNothing().run();
  }

  // 2. Админ admin / admin123 — если ни одного пользователя
  const userCount = db.select({ c: sql<number>`count(*)`.mapWith(Number) }).from(users).get();
  if (!userCount?.c) {
    const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    db.insert(users).values({
      username: 'admin',
      password_hash: hash,
      full_name: 'Системный администратор',
      role: 'admin',
      active: true,
    }).run();
    console.log(`✓ Создан админ по умолчанию: admin / ${DEFAULT_ADMIN_PASSWORD} (СМЕНИТЕ ПАРОЛЬ!)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seed();
  console.log('✓ Seed выполнен');
}
