/**
 * Типизированные сервисы поверх api(). Один файл — вся бизнес-логика на сервере.
 * Здесь же — типы, совместимые со старым клиентским кодом, чтобы не переделывать
 * сразу все страницы. Старые типы из ./db остаются ради совместимости.
 */

import type {
AuditLog, Cell,   InspectionAct, InvLine,
  InvSession, Op, Order, OrderLine,
  Product, Reservation,
ReworkAct, Stock, Asn, AsnLine, ReturnDoc, ReturnLine, CycleCount, CycleCountLine, } from '../db';
import { apiDelete,apiGet, apiPatch, apiPost, apiPut } from './api';

// ─── Products ──────────────────────────────────────────────
export const productsApi = {
  list: (since?: number) => apiGet<Product[]>('/api/products', since ? { since } : undefined),
  get: (barcode: string) => apiGet<Product>(`/api/products/${encodeURIComponent(barcode)}`),
  upsert: (p: Partial<Product> & { barcode: string; name: string; unit?: string }) =>
    apiPut<{ ok: true }>('/api/products', p),
  bulk: (arr: Array<Partial<Product> & { barcode: string; name: string; unit?: string }>) =>
    apiPost<{ added: number; updated: number }>('/api/products/bulk', arr),
  remove: (barcode: string) => apiDelete<{ ok: true }>(`/api/products/${encodeURIComponent(barcode)}`),
};

// ─── Cells ─────────────────────────────────────────────────
export const cellsApi = {
  list: (since?: number) => apiGet<Cell[]>('/api/cells', since ? { since } : undefined),
  upsert: (c: Partial<Cell> & { addr: string; type: Cell['type']; status: Cell['status']; max_units?: number; allow_mixed_sku?: boolean; pick_priority?: number; putaway_priority?: number; is_picking_face?: boolean }) =>
    apiPut<{ ok: true }>('/api/cells', c),
  bulk: (arr: Array<Partial<Cell> & { addr: string; type: Cell['type']; status: Cell['status']; max_units?: number; allow_mixed_sku?: boolean; pick_priority?: number; putaway_priority?: number; is_picking_face?: boolean }>) =>
    apiPost<{ added: number; updated: number }>('/api/cells/bulk', arr),
  remove: (addr: string) => apiDelete<{ ok: true }>(`/api/cells/${encodeURIComponent(addr)}`),
};

// ─── Stock ─────────────────────────────────────────────────
export const stockApi = {
  list: (params?: { since?: number; barcode?: string; cell?: string }) =>
    apiGet<Stock[]>('/api/stock', params as Record<string, string | number | undefined>),
};

// ─── Operations: receive / ship / move ─────────────────────
export const opsApi = {
  receive: (input: {
    barcode: string; cell: string; qty: number;
    operator?: string; lot_number?: string; expiry_date?: string;
    supplier?: string; note?: string;
  }) => apiPost<{ batch_id?: number }>('/api/ops/receive', input),

  ship: (input: {
    barcode: string; cell: string; qty: number;
    operator?: string; order_id?: number; note?: string;
  }) => apiPost<{ ok: true }>('/api/ops/ship', input),

  move: (input: {
    barcode: string; from: string; to: string; qty: number;
    operator?: string; note?: string;
  }) => apiPost<{ ok: true }>('/api/ops/move', input),

  list: (params?: { limit?: number; type?: string }) =>
    apiGet<Op[]>('/api/ops', params as Record<string, string | number | undefined>),
};

// ─── Orders ────────────────────────────────────────────────
export interface OrderWithLines extends Order {
  lines: OrderLine[];
}

export interface PickStep {
  order_line_id: number;
  barcode: string;
  name: string;
  cell: string;
  qty_to_pick: number;
  qty_done: number;
  zone?: string;
  row?: string;
  level?: string;
  pick_priority?: number;
  is_picking_face?: boolean;
}

export const ordersApi = {
  list: (params?: { since?: number; status?: string }) =>
    apiGet<Order[]>('/api/orders', params as Record<string, string | number | undefined>),
  get: (id: number) => apiGet<OrderWithLines>(`/api/orders/${id}`),
  getLines: (id: number) => apiGet<OrderLine[]>(`/api/orders/${id}/lines`),
  create: (input: { ext_id?: string; customer?: string; operator?: string; note?: string }) =>
    apiPost<{ id: number }>('/api/orders', input),
  update: (id: number, patch: Partial<Pick<Order, 'ext_id' | 'customer' | 'operator' | 'note' | 'status' | 'package_count'>>) =>
    apiPatch<{ ok: true }>(`/api/orders/${id}`, patch),
  remove: (id: number) => apiDelete<{ ok: true }>(`/api/orders/${id}`),
  addLine: (id: number, line: { barcode: string; qty_plan: number }) =>
    apiPost<{ ok: true }>(`/api/orders/${id}/lines`, line),
  removeLine: (lineId: number) => apiDelete<{ ok: true }>(`/api/orders/lines/${lineId}`),
  reserve: (id: number) => apiPost<{ ok: true }>(`/api/orders/${id}/reserve`),
  pack: (id: number, input?: { package_count?: number; packed_by?: string; note?: string }) =>
    apiPost<{ ok: true }>(`/api/orders/${id}/pack`, input || {}),
  picklist: (id: number) => apiGet<PickStep[]>(`/api/orders/${id}/picklist`),
};

// ─── Inventory — серверные сессии и строки ─────────────────
export interface InvSessionWithLines extends InvSession {
  lines: InvLine[];
}

export const inventoryApi = {
  listSessions: () => apiGet<InvSession[]>('/api/inventory/sessions'),
  getSession: (id: number) => apiGet<InvSessionWithLines>(`/api/inventory/sessions/${id}`),
  getLines: (id: number) => apiGet<InvLine[]>(`/api/inventory/sessions/${id}/lines`),
  createSession: (input: { name: string; zone_filter?: string; operator?: string }) =>
    apiPost<{ id: number }>('/api/inventory/sessions', input),
  addLine: (sessionId: number, line: { barcode: string; cell: string; qty_system: number; qty_fact: number }) =>
    apiPost<{ id: number; delta: number }>(`/api/inventory/sessions/${sessionId}/lines`, line),
  removeLine: (lineId: number) =>
    apiDelete<{ ok: true }>(`/api/inventory/lines/${lineId}`),
  closeSession: (id: number) =>
    apiPatch<{ ok: true }>(`/api/inventory/sessions/${id}/close`),
  removeSession: (id: number) =>
    apiDelete<{ ok: true }>(`/api/inventory/sessions/${id}`),
};

export const reservationsApi = {
  list: (since?: number) => apiGet<Reservation[]>('/api/reservations', since ? { since } : undefined),
};

// ─── Acts ──────────────────────────────────────────────────
type InspectionPayload = Omit<InspectionAct, 'id' | 'act_number' | 'date' | 'created_at' | 'updated_at' | 'status'>;
type ReworkPayload = Omit<ReworkAct, 'id' | 'act_number' | 'date' | 'created_at' | 'updated_at' | 'status'>;

export const actsApi = {
  // Inspection
  listInspection: () => apiGet<Array<{ id: number; act_number: string; date: string; payload: InspectionPayload; status: string; created_at: number; updated_at: number }>>('/api/acts/inspection'),
  createInspection: (input: { date: string; payload: InspectionPayload; act_number?: string }) =>
    apiPost<{ id: number; act_number: string }>('/api/acts/inspection', input),
  updateInspection: (id: number, patch: { date?: string; payload?: InspectionPayload }) =>
    apiPatch<{ ok: true }>(`/api/acts/inspection/${id}`, patch),
  removeInspection: (id: number) => apiDelete<{ ok: true }>(`/api/acts/inspection/${id}`),
  // Rework
  listRework: () => apiGet<Array<{ id: number; act_number: string; date: string; payload: ReworkPayload; status: string; created_at: number; updated_at: number }>>('/api/acts/rework'),
  createRework: (input: { date: string; payload: ReworkPayload; act_number?: string }) =>
    apiPost<{ id: number; act_number: string }>('/api/acts/rework', input),
  updateRework: (id: number, patch: { date?: string; payload?: ReworkPayload }) =>
    apiPatch<{ ok: true }>(`/api/acts/rework/${id}`, patch),
  removeRework: (id: number) => apiDelete<{ ok: true }>(`/api/acts/rework/${id}`),
};

// ─── Settings / Audit / Backup ─────────────────────────────
export const settingsApi = {
  getAll: () => apiGet<Record<string, string>>('/api/settings'),
  putAll: (obj: Record<string, string>) => apiPut<{ ok: true }>('/api/settings', obj),
};

export const auditApi = {
  list: (params?: { limit?: number; action?: string }) =>
    apiGet<AuditLog[]>('/api/audit', params as Record<string, string | number | undefined>),
  clear: () => apiDelete<{ ok: true }>('/api/audit'),
};

export interface ServerInfo {
  version: string;
  name: string;
  clients: number;
  tables: Record<string, number>;
}

export const serverApi = {
  info: () => apiGet<ServerInfo>('/api/server-info'),
  backup: () => apiGet<{ version: string; exported_at: string; data: Record<string, unknown[]> }>('/api/backup'),
  restore: (body: { data: Record<string, unknown[]> }) =>
    apiPost<{ tables: number; records: number }>('/api/restore', body),
};

// ─── Users (admin only) ────────────────────────────────────
export const usersApi = {
  list: () => apiGet<Array<{
    id: number; username: string; full_name: string;
    role: 'operator' | 'supervisor' | 'admin';
    active: boolean; created_at: number; last_login_at?: number;
  }>>('/api/users'),
  create: (u: { username: string; password: string; full_name: string; role: 'operator' | 'supervisor' | 'admin'; active?: boolean }) =>
    apiPost<{ id: number }>('/api/users', u),
  update: (id: number, patch: { username?: string; password?: string; full_name?: string; role?: 'operator' | 'supervisor' | 'admin'; active?: boolean }) =>
    apiPatch<{ ok: true }>(`/api/users/${id}`, patch),
  remove: (id: number) => apiDelete<{ ok: true }>(`/api/users/${id}`),
};


export interface AsnWithLines extends Asn {
  lines: AsnLine[];
}

export const asnApi = {
  list: (params?: { since?: number; status?: string }) =>
    apiGet<Asn[]>('/api/asn', params as Record<string, string | number | undefined>),
  get: (id: number) => apiGet<AsnWithLines>(`/api/asn/${id}`),
  create: (input: { asn_number: string; supplier?: string; eta_date?: string; note?: string }) =>
    apiPost<{ id: number }>('/api/asn', input),
  update: (id: number, patch: { asn_number?: string; supplier?: string; eta_date?: string; note?: string; status?: Asn['status'] }) =>
    apiPatch<{ ok: true }>(`/api/asn/${id}`, patch),
  remove: (id: number) => apiDelete<{ ok: true }>(`/api/asn/${id}`),
  markArrived: (id: number) => apiPost<{ ok: true }>(`/api/asn/${id}/mark-arrived`),
  addLine: (id: number, line: { barcode: string; qty_expected: number; note?: string }) =>
    apiPost<{ id: number }>(`/api/asn/${id}/lines`, line),
  updateLine: (lineId: number, patch: { qty_expected?: number; note?: string }) =>
    apiPatch<{ ok: true }>(`/api/asn/lines/${lineId}`, patch),
  removeLine: (lineId: number) => apiDelete<{ ok: true }>(`/api/asn/lines/${lineId}`),
  receive: (id: number, input: { line_id: number; cell: string; qty: number; damaged_qty?: number; operator?: string; lot_number?: string; expiry_date?: string; note?: string; discrepancy_reason?: string }) =>
    apiPost<{ batch_id?: number; qty_received: number; qty_damaged: number; status: AsnLine['status']; qc_status: AsnLine['qc_status'] }>(`/api/asn/${id}/receive`, input),
};

export interface ReplenishmentSuggestion {
  barcode: string;
  name: string;
  min_stock: number;
  target_qty: number;
  current_pick_qty: number;
  available_source_qty: number;
  suggested_qty: number;
  destination_cell: string;
  destination_capacity_left: number | null;
  source_options: Array<{ cell: string; available_qty: number }>;
  reason: string;
}

export const replenishmentApi = {
  list: (barcode?: string) => apiGet<ReplenishmentSuggestion[]>('/api/replenishment/suggestions', barcode ? { barcode } : undefined),
  execute: (input: { barcode: string; from: string; to: string; qty: number; operator?: string; note?: string }) =>
    apiPost<{ ok: true }>('/api/replenishment/execute', input),
};

export interface ReturnWithLines extends ReturnDoc {
  lines: ReturnLine[];
}

export const returnsApi = {
  list: (params?: { since?: number; status?: string }) =>
    apiGet<ReturnDoc[]>('/api/returns', params as Record<string, string | number | undefined>),
  get: (id: number) => apiGet<ReturnWithLines>(`/api/returns/${id}`),
  create: (input: { return_number: string; order_id?: number; customer?: string; reason?: string; note?: string }) =>
    apiPost<{ id: number }>('/api/returns', input),
  update: (id: number, patch: { customer?: string; reason?: string; note?: string; status?: ReturnDoc['status'] }) =>
    apiPatch<{ ok: true }>(`/api/returns/${id}`, patch),
  remove: (id: number) => apiDelete<{ ok: true }>(`/api/returns/${id}`),
  addLine: (id: number, line: { barcode: string; qty_expected: number; disposition?: ReturnLine['disposition']; note?: string; reason?: string }) =>
    apiPost<{ id: number }>(`/api/returns/${id}/lines`, line),
  removeLine: (lineId: number) => apiDelete<{ ok: true }>(`/api/returns/lines/${lineId}`),
  process: (id: number, input: { line_id: number; qty: number; disposition: ReturnLine['disposition']; cell?: string; operator?: string; note?: string; reason?: string }) =>
    apiPost<{ ok: true }>(`/api/returns/${id}/process`, input),
};

export interface CycleCountWithLines extends CycleCount {
  lines: CycleCountLine[];
}

export interface CycleCountSuggestion {
  barcode: string;
  cell: string;
  name: string;
  qty_system: number;
  priority: number;
  reasons: string[];
  zone?: string;
}

export const cycleCountApi = {
  suggestions: (q?: string) => apiGet<CycleCountSuggestion[]>('/api/cycle-counts/suggestions', q ? { q } : undefined),
  list: () => apiGet<CycleCount[]>('/api/cycle-counts'),
  get: (id: number) => apiGet<CycleCountWithLines>(`/api/cycle-counts/${id}`),
  create: (input: { task_number: string; name: string; zone_filter?: string; note?: string; lines: Array<{ barcode: string; cell: string; priority: number; reason: string }> }) =>
    apiPost<{ id: number }>('/api/cycle-counts', input),
  countLine: (lineId: number, input: { qty_counted: number; note?: string }) =>
    apiPatch<{ ok: true; delta: number }>(`/api/cycle-count-lines/${lineId}/count`, input),
  apply: (id: number) => apiPost<{ applied: number; failed: number }>(`/api/cycle-counts/${id}/apply`),
  close: (id: number) => apiPatch<{ ok: true }>(`/api/cycle-counts/${id}/close`),
};
