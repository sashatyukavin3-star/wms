import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../lib/env.ts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: number; username: string; role: 'operator' | 'supervisor' | 'admin' };
    user: { id: number; username: string; role: 'operator' | 'supervisor' | 'admin' };
  }
}

const ROLE_RANK: Record<string, number> = { operator: 1, supervisor: 2, admin: 3 };

function safeTokenEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function extractIntegrationToken(req: FastifyRequest): string | null {
  const headerToken = req.headers['x-integration-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

/** Гарантирует, что JWT присутствует и валиден. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Требуется авторизация' });
  }
}

/**
 * Гарантирует, что у пользователя роль не ниже требуемой.
 * Внутри уже сам вызывает jwtVerify — НЕ дублирует работу.
 */
export function requireRole(min: 'operator' | 'supervisor' | 'admin') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Требуется авторизация' });
    }
    const role = req.user?.role;
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }
  };
}

/**
 * Авторизация для интеграций (n8n, cron, внешние системы) по отдельному токену.
 * Принимает либо `X-Integration-Token`, либо `Authorization: Bearer <token>`.
 */
export async function requireIntegration(req: FastifyRequest, reply: FastifyReply) {
  if (!env.INTEGRATION_TOKEN) {
    return reply.code(503).send({
      error: 'INTEGRATION_TOKEN не настроен на сервере',
    });
  }

  const token = extractIntegrationToken(req);
  if (!token || !safeTokenEqual(token, env.INTEGRATION_TOKEN)) {
    return reply.code(401).send({ error: 'Неверный integration token' });
  }
}
