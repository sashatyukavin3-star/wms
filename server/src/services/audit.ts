import { db } from '../db/index.ts';
import { auditLog } from '../db/schema.ts';

export interface AuditContext {
  user_id?: number;
  username?: string;
  ip?: string;
}

export function writeAudit(
  ctx: AuditContext,
  input: {
    action: string;
    entity?: string;
    entity_id?: string | number;
    details?: string | Record<string, unknown>;
  }
): void {
  try {
    db.insert(auditLog).values({
      user_id: ctx.user_id,
      username: ctx.username,
      ip: ctx.ip,
      action: input.action,
      entity: input.entity,
      entity_id: input.entity_id !== undefined ? String(input.entity_id) : undefined,
      details: typeof input.details === 'string' ? input.details : input.details ? JSON.stringify(input.details) : undefined,
    }).run();
  } catch {
    // Никогда не падаем на аудите
  }
}
