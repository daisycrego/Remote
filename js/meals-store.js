// Meal planner storage. Shops, settings and saved plans live under one key;
// the Anthropic API key lives under its own key and is never exported.

import { DEFAULT_MODEL, MODELS } from './planner.js';

const KEY = 'shelf.meals.v1';
const API_KEY = 'shelf.anthropicKey';

export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];
export const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner'];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const guessTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

export function emptyData() {
  return {
    version: 1,
    settings: {
      model: DEFAULT_MODEL,
      maxSearches: 15,
      city: '',
      region: '',
      country: '',
      timezone: guessTimezone(),
      currency: 'USD',
    },
    shops: [],
    // shopIds: null until the user picks shops (then every shop is preselected).
    lastRequest: { budget: 80, days: 5, meals: ['Dinner'], servings: 2, shopIds: null, preferences: '', pantry: '' },
    plans: [],
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const intIn = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalize(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw.settings ?? {};
  const settings = {
    model: MODELS[s.model] ? s.model : base.settings.model,
    maxSearches: intIn(s.maxSearches, 1, 30, base.settings.maxSearches),
    city: str(s.city),
    region: str(s.region),
    country: str(s.country).toUpperCase(),
    timezone: str(s.timezone) || base.settings.timezone,
    currency: CURRENCIES.includes(s.currency) ? s.currency : base.settings.currency,
  };
  const shops = (Array.isArray(raw.shops) ? raw.shops : [])
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({ id: str(x.id) || uid(), name: typeof x.name === 'string' ? x.name : '', details: typeof x.details === 'string' ? x.details : '' }));
  const r = raw.lastRequest ?? {};
  const lastRequest = {
    budget: Number.parseFloat(r.budget) > 0 ? Number.parseFloat(r.budget) : base.lastRequest.budget,
    days: intIn(r.days, 1, 14, base.lastRequest.days),
    meals: Array.isArray(r.meals) ? r.meals.filter((m) => MEAL_NAMES.includes(m)) : base.lastRequest.meals,
    servings: intIn(r.servings, 1, 12, base.lastRequest.servings),
    shopIds: Array.isArray(r.shopIds) ? r.shopIds.filter((id) => typeof id === 'string') : null,
    preferences: typeof r.preferences === 'string' ? r.preferences : '',
    pantry: typeof r.pantry === 'string' ? r.pantry : '',
  };
  const plans = (Array.isArray(raw.plans) ? raw.plans : []).filter(
    (p) => p && typeof p === 'object' && str(p.id) && p.plan && Array.isArray(p.plan.meals) && Array.isArray(p.plan.shoppingList),
  );
  return { version: 1, settings, shops, lastRequest, plans };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyData();
  } catch (err) {
    console.warn('Shelf: could not load meal data', err);
    return emptyData();
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Shelf: could not save meal data', err);
    return false;
  }
}

export function loadKey() {
  try {
    return localStorage.getItem(API_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(value) {
  try {
    if (value) localStorage.setItem(API_KEY, value);
    else localStorage.removeItem(API_KEY);
  } catch {
    /* the key then lasts only for this page load */
  }
}

export const newShop = () => ({ id: uid(), name: '', details: '' });
export const newPlanId = uid;

// What goes into a backup file: shops and plans. Never the API key.
export function exportable(data) {
  return { shops: data.shops.filter((s) => s.name.trim()), plans: data.plans };
}

// Merge shops and plans from a backup. Existing entries win; nothing is deleted.
export function merge(data, incoming) {
  const clean = normalize({ settings: data.settings, shops: incoming?.shops, plans: incoming?.plans });
  const shopIds = new Set(data.shops.map((s) => s.id));
  const planIds = new Set(data.plans.map((p) => p.id));
  const shops = clean.shops.filter((s) => !shopIds.has(s.id));
  const plans = clean.plans.filter((p) => !planIds.has(p.id));
  data.shops.push(...shops);
  data.plans.push(...plans);
  data.plans.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { shops: shops.length, plans: plans.length };
}
