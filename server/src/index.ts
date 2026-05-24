/**
 * Storra WMS — главный файл сервера.
 *
 * Запускает Fastify + WebSocket + раздачу клиента,
 * выполняет миграции и seed, печатает баннер с IP-адресами.
 */

import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { env } from './lib/env.ts';
import { actsRoutes } from './routes/acts.ts';
import { asnRoutes } from './routes/asn.ts';
import { authRoutes } from './routes/auth.ts';
import { cellsRoutes } from './routes/cells.ts';
import { cycleCountRoutes } from './routes/cycleCount.ts';
import { integrationsRoutes } from './routes/integrations.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { miscRoutes } from './routes/misc.ts';
import { ordersRoutes } from './routes/orders.ts';
import { replenishmentRoutes } from './routes/replenishment.ts';
import { returnsRoutes } from './routes/returns.ts';
import { productsRoutes } from './routes/products.ts';
import { stockRoutes } from './routes/stock.ts';
import { searchRoutes } from './routes/search.ts';
import { scheduleAuditRotation } from './services/audit-rotation.ts';
import { addClient, removeClient } from './ws/hub.ts';

async function main() {
  // 1. Инициализация БД
  migrate();
  await seed();
  scheduleAuditRotation(); // 2. Ротация audit-log: при старте + раз в 24 часа

  // 2. Fastify
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
    trustProxy: true,
  });

  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true,
  });

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: `${env.JWT_TTL_MINUTES}m` },
  });

  await app.register(fastifyWebsocket);

  // 3. WebSocket эндпоинт
  app.register(async function wsRoute(app) {
    app.get('/api/ws', { websocket: true }, (connection, req) => {
      // Авторизация: токен в query ?token=...
      let user: { id: number; username: string; role: string } | undefined;
      try {
        const token = (req.query as { token?: string }).token;
        if (token) user = app.jwt.verify(token) as { id: number; username: string; role: string };
      } catch { /* anon */ }

      const client = { ws: connection, userId: user?.id, username: user?.username };
      addClient(client);
      connection.send(JSON.stringify({ type: 'welcome', ts: Date.now() }));

      connection.on('message', () => {
        // Пока ничего — клиент только слушает события
      });
      connection.on('close', () => removeClient(client));
      connection.on('error', () => removeClient(client));
    });
  });

  // 4. REST роуты
  await app.register(authRoutes);
  await app.register(asnRoutes);
  await app.register(productsRoutes);
  await app.register(cellsRoutes);
  await app.register(stockRoutes);
  await app.register(ordersRoutes);
  await app.register(replenishmentRoutes);
  await app.register(returnsRoutes);
  await app.register(actsRoutes);
  await app.register(miscRoutes);
  await app.register(integrationsRoutes);
  await app.register(searchRoutes);
  await app.register(cycleCountRoutes);
  await app.register(inventoryRoutes);

  // 5. Раздача клиента — умный поиск папки с фронтом
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Список кандидатов: сначала из ENV (если задан), потом стандартные места
  const candidates = [
    env.CLIENT_DIR,
    resolve(__dirname, '../../dist'),  // server/src → ../../dist (корень проекта)
    resolve(__dirname, '../dist'),     // server/src → ../dist (внутри server)
    resolve(process.cwd(), '../dist'), // запущен из server/, dist в родителе
    resolve(process.cwd(), 'dist'),    // запущен из корня проекта
  ].filter(Boolean) as string[];

  let clientPath: string | null = null;
  for (const c of candidates) {
    const indexPath = resolve(c, 'index.html');
    if (existsSync(indexPath)) { clientPath = c; break; }
  }

  if (clientPath) {
    await app.register(fastifyStatic, {
      root: clientPath,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
    app.log.info(`📦 Клиент раздаётся из ${clientPath}`);
  } else {
    app.log.warn('');
    app.log.warn('⚠️  Клиент (dist/index.html) не найден.');
    app.log.warn('   Собери фронт:  cd ..  &&  npm install  &&  npm run build');
    app.log.warn('   Искал в:');
    for (const c of candidates) app.log.warn(`     • ${c}`);
    app.log.warn('   API всё равно работает на /api/*');
    app.log.warn('');

    // Заглушка на корень — чтобы не было голого 404
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>Storra WMS Server</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0a0b14;color:#e4e7f0;padding:40px;max-width:720px;margin:auto;line-height:1.6;}
  h1{color:#9d8fff;margin-bottom:6px;} h2{color:#7c6aff;margin-top:32px;font-size:18px;}
  code{background:#1a1d2e;padding:2px 8px;border-radius:4px;color:#9d8fff;font-family:'Courier New',monospace;}
  pre{background:#1a1d2e;padding:14px;border-radius:8px;overflow-x:auto;border:1px solid #252a3e;}
  .ok{color:#22c55e;} .warn{color:#f59e0b;}
  a{color:#9d8fff;}
  .badge{display:inline-block;background:#22c55e;color:#0a0b14;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:bold;margin-left:10px;}
</style></head><body>
  <h1>🚀 Storra WMS Server <span class="badge">RUNNING</span></h1>
  <p class="ok">Сервер работает! API доступен по <code>/api/*</code>.</p>

  <h2>⚠️ Фронтенд ещё не собран</h2>
  <p>Чтобы открыть веб-интерфейс — собери клиент:</p>
  <pre># В корне проекта (один уровень выше server/):
cd ..
npm install      # если ещё не делал
npm run build    # соберёт dist/index.html
# Перезапусти сервер — он сам подхватит</pre>

  <h2>📡 Проверить API уже сейчас</h2>
  <pre>curl http://localhost:3000/api/health
# → {"ok":true,"ts":...}

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'</pre>

  <h2>🔗 Полезные ссылки</h2>
  <ul>
    <li><a href="/api/health">/api/health</a> — пинг сервера</li>
    <li>Документация API — <code>server/README.md</code></li>
  </ul>
</body></html>`);
    });
  }

  // 6. Запуск
  await app.listen({ port: env.PORT, host: env.HOST });
  printBanner(env.PORT, env.HOST);
}

function printBanner(port: number, host: string) {
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    if (!list) continue;
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }

  const line = '═'.repeat(58);
  console.log('');
  console.log('  ╔' + line + '╗');
  console.log('  ║' + '  🚀 Storra WMS Server'.padEnd(58) + '║');
  console.log('  ╠' + line + '╣');
  console.log('  ║' + `  Хост: ${host}   Порт: ${port}`.padEnd(58) + '║');
  console.log('  ║' + ''.padEnd(58) + '║');
  console.log('  ║' + '  Подключаются:'.padEnd(58) + '║');
  console.log('  ║' + `    • локально:    http://localhost:${port}`.padEnd(58) + '║');
  for (const ip of ips) {
    console.log('  ║' + `    • в сети:      http://${ip}:${port}`.padEnd(58) + '║');
  }
  console.log('  ║' + ''.padEnd(58) + '║');
  console.log('  ║' + '  По умолчанию: admin / admin123 (СМЕНИТЕ!)'.padEnd(58) + '║');
  console.log('  ╚' + line + '╝');
  console.log('');
}

main().catch(err => {
  console.error('❌ Ошибка запуска сервера:', err);
  process.exit(1);
});
