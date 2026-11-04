// Persistence: everything lives in localStorage under one key, as
// { version: 1, items: [...] }. Export/import moves it between devices.

import { STATUS_ORDER } from './types.js';

export const KEY = 'shelf.v1';
const PREF_PREFIX = 'shelf.pref.';

export const emptyState = () => ({ version: 1, items: [] });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyState();
  } catch (err) {
    console.warn('Shelf: could not load saved data', err);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Shelf: could not save', err);
    return false;
  }
}

export function loadPref(name, fallback) {
  try {
    return localStorage.getItem(PREF_PREFIX + name) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(name, value) {
  try {
    localStorage.setItem(PREF_PREFIX + name, value);
  } catch {
    /* preferences are a nicety; ignore */
  }
}

// ---------- items ----------

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// The side effects of moving an item to a new status (dates, progress).
export function statusPatch(item, status) {
  const patch = { status };
  if (status === 'doing' && !item.startedAt) patch.startedAt = today();
  if (status === 'done') {
    if (!item.finishedAt) patch.finishedAt = today();
    if (item.pages) patch.progress = item.pages;
  }
  if (status === 'dropped' && !item.finishedAt) patch.finishedAt = today();
  return patch;
}

export function createItem(fields, status = 'want') {
  const now = new Date().toISOString();
  const item = normalizeItem({ ...fields, id: uid(), status: 'want', addedAt: now, updatedAt: now });
  return Object.assign(item, statusPatch(item, status));
}

// ---------- validation (used for loading and importing) ----------

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const ymd = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

function normalizeItem(it) {
  if (!it || typeof it !== 'object' || !str(it.title)) return null;
  const now = new Date().toISOString();
  return {
    id: str(it.id) || uid(),
    type: str(it.type) || 'book',
    title: str(it.title),
    creator: str(it.creator),
    year: int(it.year),
    pages: int(it.pages) || null,
    coverUrl: /^https:\/\//.test(str(it.coverUrl)) ? str(it.coverUrl) : '',
    source:
      it.source && typeof it.source === 'object' && str(it.source.id)
        ? { name: str(it.source.name), id: str(it.source.id) }
        : null,
    status: STATUS_ORDER.includes(it.status) ? it.status : 'want',
    progress: int(it.progress) ?? 0,
    rating: Math.min(5, int(it.rating) ?? 0),
    notes: typeof it.notes === 'string' ? it.notes : '',
    startedAt: ymd(it.startedAt),
    finishedAt: ymd(it.finishedAt),
    addedAt: str(it.addedAt) || now,
    updatedAt: str(it.updatedAt) || now,
  };
}

export function normalize(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return { version: 1, items: items.map(normalizeItem).filter(Boolean) };
}

// Merge an imported backup into the current shelf. Same id: newest edit wins.
export function merge(current, incoming) {
  const byId = new Map(current.items.map((i) => [i.id, i]));
  let added = 0;
  let updated = 0;
  for (const item of incoming.items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      added++;
    } else if (item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item);
      updated++;
    }
  }
  return { state: { version: 1, items: [...byId.values()] }, added, updated };
}
