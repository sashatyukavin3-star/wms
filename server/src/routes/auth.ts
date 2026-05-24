import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { env } from '../lib/env.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// ─── In-memory rate-limit для /api/auth/login ──────────────
// Ключ — IP + username, чтобы атакующий не положил всех пользователей
// одним IP перебором логинов, и наоборот.
// Окно скользящее: храним массив таймстампов попыток и отсекаем старые.
const loginAttempts = new Map<string, number[]>();

function checkRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - env.LOGIN_RATE_WINDOW_MS;
  const arr = (loginAttempts.get(key) || []).filter(t => t > windowStart);
  if (arr.length >= env.LOGIN_RATE_MAX) {
    const oldest = arr[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + env.LOGIN_RATE_WINDOW_MS - now) / 1000));
    loginAttempts.set(key, arr);
    return { allowed: false, retryAfterSec };
  }
  arr.push(now);
  loginAttempts.set(key, arr);
  return { allowed: true, retryAfterSec: 0 };
}

// Раз в минуту чистим карту, чтобы не текла память.
setInterval(() => {
  const cutoff = Date.now() - env.LOGIN_RATE_WINDOW_MS;
  for (const [key, arr] of loginAttempts) {
    const fresh = arr.filter(t => t > cutoff);
    if (fresh.length === 0) loginAttempts.delete(key);
    else loginAttempts.set(key, fresh);
  }
}, 60_000).unref?.();

function rateLimitKey(req: FastifyRequest, username: string): string {
  return `${req.ip}|${username.toLowerCase()}`;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const username = body.data.username.trim();

    // Rate-limit: защита от брут-форса.
    const rl = checkRateLimit(rateLimitKey(req, username));
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfterSec));
      writeAudit({ username, ip: req.ip }, { action: 'login_rate_limited' });
      return reply.code(429).send({
        error: `Слишком много попыток входа. Повторите через ${rl.retryAfterSec} сек.`,
      });
    }

    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user || !user.active) {
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    const ok = await bcrypt.compare(body.data.password, user.password_hash);
    if (!ok) {
      writeAudit({ username, ip: req.ip }, { action: 'login_failed', entity: 'user', entity_id: user.id });
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    const now = Date.now();
    db.update(users).set({ last_login_at: now, updated_at: now }).where(eq(users.id, user.id)).run();

    const token = app.jwt.sign({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    writeAudit({ user_id: user.id, username: user.username, ip: req.ip }, { action: 'login', entity: 'user', entity_id: user.id });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
    };
  });

  // GET /api/auth/me — проверить токен и получить инфу о себе
  app.get('/api/auth/me', { preHandler: requireAuth }, async req => {
    if (!req.user) return null;
    const u = db.select().from(users).where(eq(users.id, req.user.id)).get();
    if (!u) return null;
    return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active };
  });

  // POST /api/auth/logout — на сервере nothing-to-do (JWT stateless),
  // но пишем в аудит
  app.post('/api/auth/logout', { preHandler: requireAuth }, async req => {
    writeAudit(
      { user_id: req.user!.id, username: req.user!.username, ip: req.ip },
      { action: 'logout', entity: 'user', entity_id: req.user!.id }
    );
    return { ok: true };
  });

  // ─── Управление пользователями (только admin) ──────────────
  app.get('/api/users', { preHandler: requireRole('admin') }, async () => {
    return db.select({
      id: users.id,
      username: users.username,
      full_name: users.full_name,
      role: users.role,
      active: users.active,
      created_at: users.created_at,
      last_login_at: users.last_login_at,
    }).from(users).all();
  });

  const createSchema = z.object({
    username: z.string().min(2),
    password: z.string().min(4),
    full_name: z.string().min(1),
    role: z.enum(['operator', 'supervisor', 'admin']),
    active: z.boolean().optional(),
  });

  app.post('/api/users', { preHandler: requireRole('admin') }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const exists = db.select().from(users).where(eq(users.username, parsed.data.username.trim())).get();
    if (exists) return reply.code(409).send({ error: 'Пользователь с таким логином уже существует' });

    const hash = await bcrypt.hash(parsed.data.password, 10);
    const inserted = db.insert(users).values({
      username: parsed.data.username.trim(),
      password_hash: hash,
      full_name: parsed.data.full_name.trim(),
      role: parsed.data.role,
      active: parsed.data.active !== false,
    }).returning({ id: users.id }).get();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'user.create', entity: 'user', entity_id: inserted!.id,
      details: { username: parsed.data.username, role: parsed.data.role },
    });

    return { id: inserted!.id };
  });

  const updateSchema = z.object({
    username: z.string().min(2).optional(),
    password: z.string().min(4).optional(),
    full_name: z.string().min(1).optional(),
    role: z.enum(['operator', 'supervisor', 'admin']).optional(),
    active: z.boolean().optional(),
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!id) return reply.code(400).send({ error: 'Неверный id' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (parsed.data.username) patch.username = parsed.data.username.trim();
    if (parsed.data.full_name) patch.full_name = parsed.data.full_name.trim();
    if (parsed.data.role) patch.role = parsed.data.role;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;
    if (parsed.data.password) patch.password_hash = await bcrypt.hash(parsed.data.password, 10);

    db.update(users).set(patch).where(eq(users.id, id)).run();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'user.update', entity: 'user', entity_id: id,
      details: { fields: Object.keys(parsed.data) },
    });

    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const id = Number(req.params.id);
    const count = db.select({ c: users.id }).from(users).all().length;
    if (count <= 1) return reply.code(400).send({ error: 'Нельзя удалить последнего пользователя' });
    db.delete(users).where(eq(users.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'user.delete', entity: 'user', entity_id: id,
    });
    return { ok: true };
  });
}
