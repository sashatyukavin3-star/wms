/**
 * Hub событий для realtime-обновлений между клиентами.
 *
 * При любом изменении данных (приёмка, отгрузка, создание заказа, ...)
 * сервер шлёт событие "{entity}:{action}" + payload всем подключённым клиентам.
 * Клиенты получают сигнал и подтягивают актуальные данные через REST.
 */

import type { WebSocket } from 'ws';

export type WSEvent =
  | { type: 'stock:changed'; barcode?: string; cell?: string }
  | { type: 'product:changed'; barcode?: string }
  | { type: 'cell:changed'; addr?: string }
  | { type: 'order:changed'; id?: number }
  | { type: 'order_line:changed'; order_id?: number; id?: number }
  | { type: 'reservation:changed'; order_id?: number }
  | { type: 'inv:changed'; session_id?: number }
  | { type: 'act:changed'; kind: 'inspection' | 'rework'; id?: number }
  | { type: 'op:created'; op_type: string }
  | { type: 'user:changed' }
  | { type: 'audit:new' }
  | { type: 'asn:changed'; id?: number }
  | { type: 'return:changed'; id?: number }
  | { type: 'cycle_count:changed'; id?: number };

interface Client {
  ws: WebSocket;
  userId?: number;
  username?: string;
}

const clients = new Set<Client>();

export function addClient(c: Client) {
  clients.add(c);
}
export function removeClient(c: Client) {
  clients.delete(c);
}
export function clientCount(): number {
  return clients.size;
}

export function broadcast(evt: WSEvent): void {
  const data = JSON.stringify(evt);
  for (const c of clients) {
    try {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    } catch { /* noop */ }
  }
}
