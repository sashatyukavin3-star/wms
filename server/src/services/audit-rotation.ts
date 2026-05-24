/**
 * Ротация audit-log.
 *
 * Зачем нужно:
 *  • Каждый успешный логин, каждая приёмка/отгрузка/перемещение, каждый
 *    create/update/delete справочников и т.д. пишутся в audit_log.
 *  • На активном складе это ~5000-50000 строк в день.
 *  • За год без ротации — миллионы строк, SQLite начнёт тормозить даже на простых SELECT.
 *
 * Что делаем:
 *  • При старте сервера удаляем записи старше AUDIT_RETENTION_DAYS дней.
 *  • Дальше — раз в сутки.
 *  • После удаления делаем VACUUM, чтобы файл БД реально уменьшился.
 *
 * Безопасность:
 *  • Если AUDIT_RETENTION_DAYS = 0 — ротация полностью отключена (вечное хранение).
 *  • Никогда не валится — все ошибки гасятся.
 */

import { sql } from 'drizzle-orm';

import { db, sqlite } from '../db/index.ts';
import { auditLog } from '../db/schema.ts';
import { env } from '../lib/env.ts';

const DAY_MS = 86400_000;

export function runAuditRotation(): { deleted: number; cutoffDate: string } | null {
  if (env.AUDIT_RETENTION_DAYS === 0) return null;

  try {
    const cutoffTs = Date.now() - env.AUDIT_RETENTION_DAYS * DAY_MS;
    const cutoffDate = new Date(cutoffTs).toISOString();

    // Считаем, сколько уйдёт — для лога
    const before = db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM ${auditLog} WHERE ts < ${cutoffTs}`);
    const toDelete = before[0]?.c ?? 0;
    if (toDelete === 0) return { deleted: 0, cutoffDate };

    // Чистим
    db.delete(auditLog).where(sql`${auditLog.ts} < ${cutoffTs}`).run();

    // Сжимаем файл БД, чтобы освободившееся место реально вернулось ОС.
    // VACUUM нельзя внутри транзакции, поэтому через прямой sqlite.exec.
    try { sqlite.exec('VACUUM'); } catch { /* noop */ }

    return { deleted: toDelete, cutoffDate };
  } catch (e) {
    console.warn('[audit-rotation] не удалось выполнить ротацию:', e);
    return null;
  }
}

/**
 * Запускает ротацию сейчас + раз в 24 часа.
 * Возвращает unref-таймер, чтобы Node.js мог корректно завершиться при остановке.
 */
export function scheduleAuditRotation() {
  const result = runAuditRotation();
  if (result) {
    if (result.deleted > 0) {
      console.log(`[audit-rotation] удалено ${result.deleted} записей старше ${env.AUDIT_RETENTION_DAYS} дней (до ${result.cutoffDate})`);
    }
  } else if (env.AUDIT_RETENTION_DAYS === 0) {
    console.log('[audit-rotation] отключена (AUDIT_RETENTION_DAYS=0)');
  }
  const timer = setInterval(() => {
    const r = runAuditRotation();
    if (r && r.deleted > 0) {
      console.log(`[audit-rotation] удалено ${r.deleted} старых записей`);
    }
  }, DAY_MS);
  timer.unref?.();
  return timer;
}
