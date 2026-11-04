// The Meals view: settings (API key, shops, area), the plan form, live progress
// while Claude researches prices, and saved plans with shopping lists and recipes.

import { html, setHTML } from './html.js';
import { $, actions, currencySymbol, formatDate, formatMoney, hostOf, safeUrl, toast } from './ui.js';
import * as mstore from './meals-store.js';
import { CURRENCIES, MEAL_NAMES } from './meals-store.js';
import { MODELS, modelName, runPlanner } from './planner.js';

const settingsDialog = $('#meal-settings-dialog');

let data = mstore.load();
let apiKey = mstore.loadKey();
let currentPlanId = data.plans[0]?.id ?? null;
let planTab = 'list';
let run = null; // { controller, startedAt, log[], status, timer }
let runError = '';
let warnedStorage = false;

const namedShops = () => data.shops.filter((s) => s.name.trim());
const isReady = () => Boolean(apiKey) && namedShops().length > 0;
const currentPlan = () => data.plans.find((p) => p.id === currentPlanId) ?? null;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const metaLine = (parts) => parts.filter(Boolean).join(' · ');

function persist() {
  if (!mstore.save(data) && !warnedStorage) {
    warnedStorage = true;
    toast("This browser isn't letting Shelf save, so meal plans will be lost when you reload.");
  }
}

// ---------------------------------------------------------------- used by app.js

export const planCount = () => data.plans.length;
export const exportData = () => mstore.exportable(data);

export function importData(raw) {
  const counts = mstore.merge(data, raw);
  persist();
  currentPlanId ??= data.plans[0]?.id ?? null;
  render();
  return counts;
}

// ---------------------------------------------------------------- render

export function render() {
  renderSetup();
  renderRun();
  renderPlan();
  renderForm();
  renderHistory();
}

function renderSetup() {
  const el = $('#meals-setup');
  if (isReady()) {
    setHTML(el, '');
    return;
  }
  const steps = [
    { done: Boolean(apiKey), text: 'Add your Anthropic API key' },
    { done: namedShops().length > 0, text: 'Add the shops you buy groceries from' },
    { done: Boolean(data.settings.city || data.settings.region), text: 'Optional: add your city, so prices are local' },
  ];
  setHTML(el, html`
    <div class="card setup">
      <h3>Set up meal planning</h3>
      <p class="muted">Shelf asks Claude to search the web for current prices at your shops, then builds recipes and a
        priced shopping list that fit your budget. It runs on your own Anthropic account.</p>
      <ol class="checklist">
        ${steps.map((s) => html`<li class="${s.done ? 'done' : ''}"><span class="check" aria-hidden="true">${s.done ? '✓' : ''}</span>
          <span>${s.text}${s.done ? html`<span class="visually-hidden"> (done)</span>` : ''}</span></li>`)}
      </ol>
      <button type="button" class="btn primary" data-action="meal-settings">Open settings</button>
    </div>`);
}

// ---------------------------------------------------------------- the form

function renderForm() {
  const r = data.lastRequest;
  const shops = namedShops();
  const selected = new Set(Array.isArray(r.shopIds) ? r.shopIds : shops.map((s) => s.id));
  const busy = Boolean(run);
  const model = modelName(data.settings.model);

  setHTML($('#meals-form'), html`
    <form id="plan-form" class="card plan-form" novalidate aria-labelledby="plan-form-title">
      <h3 id="plan-form-title">${data.plans.length ? 'New plan' : 'Plan your meals'}</h3>
      <fieldset ${busy ? 'disabled' : ''}>
        <div class="form-grid">
          <label class="fld"><span class="fld-label">Budget</span>
            <span class="affix"><span class="affix-text">${currencySymbol(data.settings.currency)}</span>
              <input name="budget" type="number" min="1" step="any" inputmode="decimal" value="${r.budget}" required></span></label>
          <label class="fld"><span class="fld-label">Days</span>
            <input name="days" type="number" min="1" max="14" inputmode="numeric" value="${r.days}" required></label>
          <label class="fld"><span class="fld-label">People</span>
            <input name="servings" type="number" min="1" max="12" inputmode="numeric" value="${r.servings}" required></label>
        </div>
        <div class="fld">
          <span class="fld-label" id="meal-slots-label">Meals each day</span>
          <div class="chips" role="group" aria-labelledby="meal-slots-label">
            ${MEAL_NAMES.map((m) => html`<label class="chip"><input type="checkbox" name="meals" value="${m}" ${r.meals.includes(m) ? 'checked' : ''}><span>${m}</span></label>`)}
          </div>
        </div>
        <div class="fld">
          <span class="fld-label" id="shop-choice-label">Shops</span>
          ${shops.length
            ? html`<div class="chips" role="group" aria-labelledby="shop-choice-label">
                ${shops.map((s) => html`<label class="chip"><input type="checkbox" name="shops" value="${s.id}" ${selected.has(s.id) ? 'checked' : ''}><span>${s.name}</span></label>`)}
              </div>`
            : html`<p class="hint">No shops yet. <button type="button" class="link-btn" data-action="meal-settings">Add your shops</button></p>`}
        </div>
        <label class="fld"><span class="fld-label">Preferences <span class="opt">optional</span></span>
          <textarea name="preferences" rows="2" placeholder="Vegetarian, no mushrooms, quick weeknight dinners, I have an air fryer">${r.preferences}</textarea></label>
        <label class="fld"><span class="fld-label">Already in your kitchen <span class="opt">optional</span></span>
          <textarea name="pantry" rows="2" placeholder="Rice, olive oil, spices, half a bag of spinach">${r.pantry}</textarea></label>
        <div class="form-foot">
          <p class="fineprint">${isReady()
            ? `Uses ${model} and up to ${plural(data.settings.maxSearches, 'web search', 'web searches')}, billed to your Anthropic account.`
            : 'Finish setup above to start planning.'}</p>
          <button type="submit" class="btn primary" ${isReady() && !busy ? '' : 'disabled'}>Plan my meals</button>
        </div>
      </fieldset>
    </form>`);
}

function readForm(form) {
  const fd = new FormData(form);
  return {
    budget: Number.parseFloat(fd.get('budget')),
    days: Number.parseInt(fd.get('days'), 10),
    servings: Number.parseInt(fd.get('servings'), 10),
    meals: fd.getAll('meals').map(String),
    shopIds: fd.getAll('shops').map(String),
    preferences: String(fd.get('preferences') ?? '').trim(),
    pantry: String(fd.get('pantry') ?? '').trim(),
  };
}

// Remember what was typed, so the form comes back the same next time.
function rememberForm(form) {
  const f = readForm(form);
  const r = data.lastRequest;
  data.lastRequest = {
    budget: f.budget > 0 ? f.budget : r.budget,
    days: f.days >= 1 ? Math.min(14, f.days) : r.days,
    servings: f.servings >= 1 ? Math.min(12, f.servings) : r.servings,
    meals: f.meals,
    shopIds: form.querySelector('[name="shops"]') ? f.shopIds : r.shopIds,
    preferences: f.preferences,
    pantry: f.pantry,
  };
  persist();
}

$('#meals-form').addEventListener('input', (e) => {
  if (e.target.form?.id === 'plan-form') rememberForm(e.target.form);
});

$('#meals-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const req = readForm(e.target);
  const problems = [];
  if (!(req.budget > 0)) problems.push('a budget');
  if (!(req.days >= 1 && req.days <= 14)) problems.push('1 to 14 days');
  if (!(req.servings >= 1 && req.servings <= 12)) problems.push('1 to 12 people');
  if (!req.meals.length) problems.push('at least one meal a day');
  if (!req.shopIds.length) problems.push('at least one shop');
  if (problems.length) {
    toast(`Please choose ${problems.join(', ')}.`);
    return;
  }
  startRun(req);
});

// ---------------------------------------------------------------- running a plan

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function startRun(req) {
  if (run || !isReady()) return;
  const settings = { ...data.settings };
  const request = {
    budget: req.budget,
    days: req.days,
    meals: MEAL_NAMES.filter((m) => req.meals.includes(m)),
    servings: req.servings,
    shops: namedShops()
      .filter((s) => req.shopIds.includes(s.id))
      .map((s) => ({ name: s.name.trim(), details: s.details.trim() })),
    preferences: req.preferences,
    pantry: req.pantry,
    date: today(),
  };

  run = { controller: new AbortController(), startedAt: Date.now(), log: [], status: 'Starting…', timer: null };
  runError = '';
  render();
  $('#meals-run').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  run.timer = setInterval(updateElapsed, 1000);

  let finished = false;
  try {
    const result = await runPlanner({ apiKey, settings, request, signal: run.controller.signal, onProgress });
    const saved = {
      id: mstore.newPlanId(),
      createdAt: new Date().toISOString(),
      request: { ...request, currency: settings.currency },
      plan: result.plan,
      usage: result.usage,
      cost: result.cost,
      model: result.model,
      sources: result.sources.slice(0, 60),
      checked: {},
    };
    data.plans.unshift(saved);
    currentPlanId = saved.id;
    planTab = 'list';
    persist();
    finished = true;
  } catch (err) {
    if (err?.kind === 'cancelled') toast('Planning cancelled');
    else runError = err?.message || String(err);
  } finally {
    clearInterval(run.timer);
    run = null;
    render();
  }
  if (finished) {
    const onMeals = !$('#view-meals').hidden;
    toast('Your meal plan is ready', onMeals ? undefined : { label: 'View', run: () => (location.hash = '#meals') });
    if (onMeals) $('#meals-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let runRenderQueued = false;
function onProgress(event) {
  if (!run) return;
  if (event.kind === 'search') {
    run.log.push({ kind: 'Search', text: event.text });
    run.status = 'Looking up prices and recipes…';
  } else if (event.kind === 'fetch') {
    run.log.push({ kind: 'Read', text: event.text });
    run.status = 'Reading shop pages…';
  } else if (event.kind === 'writing') {
    run.status = 'Writing your plan…';
  } else if (event.kind === 'status') {
    run.status = event.text;
  }
  // Tool input streams in small pieces; redraw at most once a frame.
  if (runRenderQueued) return;
  runRenderQueued = true;
  requestAnimationFrame(() => {
    runRenderQueued = false;
    renderRun();
  });
}

function elapsed() {
  if (!run) return '';
  const s = Math.floor((Date.now() - run.startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateElapsed() {
  const el = $('[data-elapsed]');
  if (el) el.textContent = elapsed();
}

function shortUrl(value) {
  try {
    const u = new URL(value);
    const path = u.pathname.length > 32 ? `${u.pathname.slice(0, 31)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return String(value);
  }
}

function renderRun() {
  const el = $('#meals-run');
  if (run) {
    const lookups = run.log.length;
    setHTML(el, html`
      <div class="card run">
        <div class="run-head">
          <span class="spinner" aria-hidden="true"></span>
          <div class="run-status">
            <strong>${run.status}</strong>
            <span class="muted" data-elapsed>${elapsed()}</span>
          </div>
          <button type="button" class="btn small" data-action="cancel-plan">Cancel</button>
        </div>
        ${lookups > 0 && html`<ol class="run-log">${run.log.slice(-6).map((l) => html`
          <li><span class="log-kind">${l.kind}</span><span class="log-text">${l.kind === 'Read' ? shortUrl(l.text) : l.text}</span></li>`)}</ol>`}
        <p class="fineprint">${lookups ? `${plural(lookups, 'lookup')} so far. ` : ''}This usually takes a few minutes. Keep this tab open; you can browse your books meanwhile.</p>
      </div>`);
    return;
  }
  if (runError) {
    setHTML(el, html`
      <div class="card run-error" role="alert">
        <strong>Couldn't make a plan</strong>
        <p>${runError}</p>
        <div class="form-actions start">
          <button type="button" class="btn small" data-action="dismiss-error">Dismiss</button>
          <button type="button" class="btn small" data-action="meal-settings">Settings</button>
        </div>
      </div>`);
    return;
  }
  setHTML(el, '');
}

window.addEventListener('beforeunload', (e) => {
  if (run) e.preventDefault();
});

// ---------------------------------------------------------------- a saved plan

function groupByShop(saved) {
  const order = (saved.request.shops ?? []).map((s) => s.name);
  const groups = new Map(order.map((name) => [name, []]));
  saved.plan.shoppingList.forEach((it, i) => {
    const shop = String(it.shop || 'Other');
    if (!groups.has(shop)) groups.set(shop, []);
    groups.get(shop).push({ it, i });
  });
  return [...groups].filter(([, items]) => items.length);
}

function renderPlan() {
  const el = $('#meals-plan');
  const saved = currentPlan();
  if (!saved) {
    setHTML(el, '');
    return;
  }
  const { plan, request } = saved;
  const cur = plan.currency || request.currency || data.settings.currency;
  const total = Number(plan.total) || 0;
  const budget = Number(request.budget) || 0;
  const over = budget > 0 && total > budget;
  const pct = budget > 0 ? Math.min(100, (total / budget) * 100) : 0;
  const listed = plan.shoppingList.filter((it) => it.basis === 'listed').length;
  const tabs = [
    { id: 'list', label: 'Shopping list', count: plan.shoppingList.length },
    { id: 'meals', label: 'Meals', count: plan.meals.length },
    { id: 'notes', label: 'Notes' },
  ];
  const panel = { list: shoppingPanel, meals: mealsPanel, notes: notesPanel }[planTab] ?? shoppingPanel;

  setHTML(el, html`
    <article class="card plan" aria-labelledby="plan-title">
      <header class="plan-head">
        <h3 id="plan-title">${plural(request.days, 'day')} of ${(request.meals ?? []).join(', ').toLowerCase()} for ${request.servings}</h3>
        <p class="muted">${metaLine([formatDate(saved.createdAt), (request.shops ?? []).map((s) => s.name).join(', ')])}</p>
      </header>
      <div class="budget ${over ? 'over' : ''}">
        <div class="budget-numbers">
          <strong>${formatMoney(total, cur)}</strong>
          <span>${over ? `${formatMoney(total - budget, cur)} over` : 'of'} your ${formatMoney(budget, cur)} budget</span>
        </div>
        <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${pct}%"></div></div>
        <p class="hint">${listed} of ${plural(plan.shoppingList.length, 'price')} seen in shop listings; the rest are estimates.</p>
      </div>
      ${plan.summary && html`<p class="plan-summary">${plan.summary}</p>`}
      <div class="tabs plan-tabs" role="tablist" aria-label="Plan sections">
        ${tabs.map((t) => html`<button type="button" role="tab" class="tab" aria-selected="${String(t.id === planTab)}"
          data-action="plan-tab" data-tab="${t.id}">${t.label}${t.count != null && html`<span class="tab-count">${t.count}</span>`}</button>`)}
      </div>
      <div class="plan-panel" role="tabpanel">${panel(saved, cur)}</div>
      <footer class="plan-foot">
        <button type="button" class="btn danger-ghost" data-action="delete-plan">Delete plan</button>
      </footer>
    </article>`);
}

function shoppingPanel(saved, cur) {
  const checked = saved.checked ?? {};
  const done = saved.plan.shoppingList.filter((_, i) => checked[i]).length;
  return html`
    <div class="list-actions">
      <span class="hint">${done} of ${saved.plan.shoppingList.length} in the basket</span>
      <button type="button" class="btn small" data-action="copy-list">Copy list</button>
    </div>
    ${groupByShop(saved).map(([shop, items]) => html`
      <section class="shop-group">
        <h4 class="shop-head"><span>${shop}</span><span>${formatMoney(items.reduce((s, { it }) => s + (Number(it.price) || 0), 0), cur)}</span></h4>
        <ul class="buy-list">${items.map(({ it, i }) => buyRow(it, i, Boolean(checked[i]), cur))}</ul>
      </section>`)}`;
}

function buyRow(it, i, checked, cur) {
  const src = safeUrl(it.sourceUrl);
  const forMeals = Array.isArray(it.forMeals) ? it.forMeals : [];
  return html`
    <li class="buy ${checked ? 'is-checked' : ''}">
      <label class="buy-main">
        <input type="checkbox" data-check="${i}" ${checked ? 'checked' : ''}>
        <span class="buy-text">
          <span class="buy-item">${it.item}</span>
          ${it.quantity && html`<span class="buy-qty">${it.quantity}</span>`}
        </span>
      </label>
      <span class="buy-price">${formatMoney(it.price, cur)}</span>
      <div class="buy-meta">
        ${it.basis === 'listed' ? html`<span class="badge listed">Listed price</span>` : html`<span class="badge">Estimate</span>`}
        ${src && html`<a href="${src}" target="_blank" rel="noopener noreferrer">${hostOf(src)} ↗</a>`}
        ${forMeals.length > 0 && html`<span>For ${forMeals.join(', ')}</span>`}
      </div>
    </li>`;
}

function mealsPanel(saved) {
  const days = new Map();
  for (const m of saved.plan.meals) {
    if (!days.has(m.day)) days.set(m.day, []);
    days.get(m.day).push(m);
  }
  return [...days].sort((a, b) => a[0] - b[0]).map(([day, meals]) => html`
    <section class="day">
      <h4 class="day-head">Day ${day}</h4>
      ${meals.map(mealRow)}
    </section>`);
}

function mealRow(m) {
  if (m.leftoversOf) {
    return html`
      <div class="meal leftovers">
        <span class="meal-slot">${m.meal}</span>
        <span class="meal-title">${m.title}</span>
        <span class="meal-meta">Leftovers of ${m.leftoversOf}</span>
      </div>`;
  }
  const url = safeUrl(m.recipeUrl);
  const ingredients = Array.isArray(m.ingredients) ? m.ingredients : [];
  const steps = Array.isArray(m.steps) ? m.steps : [];
  return html`
    <details class="meal">
      <summary>
        <span class="meal-slot">${m.meal}</span>
        <span class="meal-title">${m.title}</span>
        <span class="meal-meta">${metaLine([m.timeMinutes > 0 && `${m.timeMinutes} min`, m.servings > 0 && `serves ${m.servings}`])}</span>
      </summary>
      <div class="meal-body">
        ${ingredients.length > 0 && html`<h5>Ingredients</h5><ul>${ingredients.map((x) => html`<li>${x}</li>`)}</ul>`}
        ${steps.length > 0 && html`<h5>Steps</h5><ol>${steps.map((x) => html`<li>${x}</li>`)}</ol>`}
        ${url && html`<a class="ext-link" href="${url}" target="_blank" rel="noopener noreferrer">Full recipe on ${hostOf(url)} ↗</a>`}
      </div>
    </details>`;
}

function notesPanel(saved, cur) {
  const { plan, request, usage } = saved;
  const sources = (Array.isArray(saved.sources) ? saved.sources : [])
    .map((s) => ({ url: safeUrl(s.url), title: String(s.title || '') }))
    .filter((s) => s.url);
  const count = (n) => Number(n) || 0;
  const tokensIn = usage ? count(usage.input) + count(usage.cacheWrite) + count(usage.cacheRead) : 0;
  const k = (n) => (count(n) >= 1000 ? `${Math.round(count(n) / 1000).toLocaleString()}k` : String(count(n)));
  return html`
    ${plan.notes.length > 0 && html`<h4 class="small-head">Notes from Claude</h4><ul class="notes">${plan.notes.map((n) => html`<li>${n}</li>`)}</ul>`}
    ${plan.pantryAssumed.length > 0 && html`<h4 class="small-head">Assumed you already have</h4><p>${plan.pantryAssumed.join(', ')}</p>`}
    <h4 class="small-head">What you asked for</h4>
    <dl class="asked">
      <dt>Budget</dt><dd>${formatMoney(request.budget, cur)}</dd>
      <dt>Meals</dt><dd>${plural(request.days, 'day')} · ${(request.meals ?? []).join(', ')} · ${plural(request.servings, 'person', 'people')}</dd>
      <dt>Shops</dt><dd>${(request.shops ?? []).map((s) => s.name).join(', ')}</dd>
      ${request.preferences && html`<dt>Preferences</dt><dd>${request.preferences}</dd>`}
      ${request.pantry && html`<dt>Had at home</dt><dd>${request.pantry}</dd>`}
    </dl>
    ${sources.length > 0 && html`
      <h4 class="small-head">Pages Claude looked at</h4>
      <ul class="sources">${sources.slice(0, 30).map((s) => html`<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title && s.title !== s.url ? s.title : hostOf(s.url)}</a> <span class="muted">${hostOf(s.url)}</span></li>`)}</ul>`}
    ${usage && html`
      <h4 class="small-head">What this plan cost</h4>
      <p class="hint">${plural(count(usage.searches), 'web search', 'web searches')}, ${k(tokensIn)} input and ${k(usage.output)} output tokens
        with ${modelName(saved.model)}: about ${formatMoney(saved.cost, 'USD')} at Anthropic's list prices.</p>`}`;
}

$('#meals-plan').addEventListener('change', (e) => {
  const index = e.target.dataset?.check;
  const saved = currentPlan();
  if (index == null || !saved) return;
  saved.checked = { ...saved.checked, [index]: e.target.checked };
  if (!e.target.checked) delete saved.checked[index];
  persist();
  renderPlan();
  $(`[data-check="${index}"]`)?.focus();
});

function renderHistory() {
  const el = $('#meals-history');
  const others = data.plans.filter((p) => p.id !== currentPlanId);
  if (!others.length) {
    setHTML(el, '');
    return;
  }
  setHTML(el, html`
    <section class="history" aria-labelledby="history-title">
      <h3 id="history-title" class="small-head">Earlier plans</h3>
      ${others.map((p) => {
        const cur = p.plan.currency || p.request.currency || 'USD';
        return html`
          <button type="button" class="row history-row" data-action="open-plan" data-id="${p.id}">
            <span class="row-main">
              <span class="title">${plural(p.request.days, 'day')} · ${formatMoney(p.plan.total, cur)} of ${formatMoney(p.request.budget, cur)}</span>
              <span class="meta">${metaLine([formatDate(p.createdAt), (p.request.meals ?? []).join(', '), plural(p.request.servings, 'person', 'people')])}</span>
            </span>
            <span class="chevron" aria-hidden="true">›</span>
          </button>`;
      })}
    </section>`);
}

async function copyList() {
  const saved = currentPlan();
  if (!saved) return;
  const cur = saved.plan.currency || saved.request.currency;
  const lines = [];
  for (const [shop, items] of groupByShop(saved)) {
    lines.push(shop);
    for (const { it } of items) lines.push(`- ${it.item}${it.quantity ? ` (${it.quantity})` : ''}: ${formatMoney(it.price, cur)}`);
    lines.push('');
  }
  lines.push(`Total: about ${formatMoney(saved.plan.total, cur)}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    toast('Shopping list copied');
  } catch {
    toast("Couldn't copy. Your browser blocked clipboard access.");
  }
}

function deletePlan() {
  const index = data.plans.findIndex((p) => p.id === currentPlanId);
  if (index < 0) return;
  const [removed] = data.plans.splice(index, 1);
  currentPlanId = data.plans[0]?.id ?? null;
  persist();
  render();
  toast('Plan deleted', {
    label: 'Undo',
    run: () => {
      data.plans.splice(Math.min(index, data.plans.length), 0, removed);
      currentPlanId = removed.id;
      persist();
      render();
    },
  });
}

// ---------------------------------------------------------------- settings dialog

function openSettings() {
  renderSettings();
  if (!settingsDialog.open) settingsDialog.showModal();
  if (!apiKey) $('#f-api-key', settingsDialog)?.focus();
}

function renderSettings() {
  const s = data.settings;
  setHTML(settingsDialog, html`
    <div class="sheet">
      <header class="sheet-bar">
        <h2 id="meal-settings-title">Meal planner settings</h2>
        <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">✕</button>
      </header>
      <div class="sheet-body settings">
        <section class="settings-section">
          <h3>Anthropic API key</h3>
          <p class="hint">Planning uses Claude with web search, billed to your own Anthropic account. Create a key in the
            <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Claude Console</a>, and consider
            giving it a monthly spend limit.</p>
          <div class="key-row">
            <input id="f-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${apiKey}" aria-label="Anthropic API key">
            <button type="button" class="btn small" data-action="toggle-key">Show</button>
          </div>
          <p class="fineprint">Saved only in this browser and sent only to Anthropic. It's never included in backups,
            but anyone who can use this browser could find it.</p>
          ${apiKey && html`<button type="button" class="btn small danger-ghost" data-action="remove-key">Remove key</button>`}
        </section>

        <section class="settings-section">
          <h3>Your shops</h3>
          <p class="hint">An address or website helps Claude find the right store.</p>
          <ul class="shop-list">
            ${data.shops.map((shop) => html`
              <li class="shop-edit">
                <input data-shop="${shop.id}" data-shop-field="name" value="${shop.name}" placeholder="Shop name" aria-label="Shop name" autocomplete="off">
                <input data-shop="${shop.id}" data-shop-field="details" value="${shop.details}" placeholder="Address or website (optional)" aria-label="Address or website" autocomplete="off">
                <button type="button" class="icon-btn" data-action="remove-shop" data-id="${shop.id}" aria-label="Remove ${shop.name || 'this shop'}">✕</button>
              </li>`)}
          </ul>
          <button type="button" class="btn small" data-action="add-shop">+ Add shop</button>
        </section>

        <section class="settings-section">
          <h3>Your area</h3>
          <p class="hint">Used to find local prices. Optional, but it helps.</p>
          <div class="three-col">
            <label class="fld"><span class="fld-label">City</span><input data-setting="city" value="${s.city}" autocomplete="address-level2"></label>
            <label class="fld"><span class="fld-label">State or region</span><input data-setting="region" value="${s.region}" autocomplete="address-level1"></label>
            <label class="fld"><span class="fld-label">Country code</span><input data-setting="country" value="${s.country}" maxlength="2" placeholder="US" autocomplete="off"></label>
          </div>
        </section>

        <section class="settings-section">
          <h3>Planning</h3>
          <div class="three-col">
            <label class="fld"><span class="fld-label">Model</span>
              <select data-setting="model">${Object.entries(MODELS).map(([id, m]) => html`<option value="${id}" ${id === s.model ? 'selected' : ''}>${m.label}</option>`)}</select></label>
            <label class="fld"><span class="fld-label">Most web searches</span>
              <input data-setting="maxSearches" type="number" min="1" max="30" inputmode="numeric" value="${s.maxSearches}"></label>
            <label class="fld"><span class="fld-label">Currency</span>
              <select data-setting="currency">${CURRENCIES.map((c) => html`<option ${c === s.currency ? 'selected' : ''}>${c}</option>`)}</select></label>
          </div>
          <p class="fineprint">Each web search costs $0.01, plus the tokens Claude reads and writes. Each plan shows what it cost.</p>
        </section>
      </div>
      <footer class="sheet-foot">
        <span></span>
        <button type="button" class="btn primary" data-action="close-dialog">Done</button>
      </footer>
    </div>`);
}

settingsDialog.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'f-api-key') {
    apiKey = t.value.trim();
    mstore.saveKey(apiKey);
    return;
  }
  const setting = t.dataset.setting;
  if (setting) {
    let value = t.value.trim();
    if (setting === 'country') value = value.toUpperCase();
    if (setting === 'maxSearches') {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n)) return;
      value = Math.min(30, Math.max(1, n));
    }
    data.settings[setting] = value;
    persist();
    return;
  }
  const shop = data.shops.find((x) => x.id === t.dataset.shop);
  if (shop && t.dataset.shopField) {
    shop[t.dataset.shopField] = t.value;
    persist();
  }
});

settingsDialog.addEventListener('close', () => render());

function addShop() {
  const shop = mstore.newShop();
  data.shops.push(shop);
  if (Array.isArray(data.lastRequest.shopIds)) data.lastRequest.shopIds.push(shop.id);
  persist();
  renderSettings();
  $(`[data-shop="${shop.id}"][data-shop-field="name"]`, settingsDialog)?.focus();
}

function removeShop(id) {
  data.shops = data.shops.filter((s) => s.id !== id);
  if (Array.isArray(data.lastRequest.shopIds)) data.lastRequest.shopIds = data.lastRequest.shopIds.filter((x) => x !== id);
  persist();
  renderSettings();
  $('[data-action="add-shop"]', settingsDialog)?.focus();
}

// ---------------------------------------------------------------- actions

Object.assign(actions, {
  'meal-settings': openSettings,
  'toggle-key': (el) => {
    const input = $('#f-api-key', settingsDialog);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Hide' : 'Show';
  },
  'remove-key': () => {
    apiKey = '';
    mstore.saveKey('');
    renderSettings();
    $('#f-api-key', settingsDialog)?.focus();
  },
  'add-shop': addShop,
  'remove-shop': (el) => removeShop(el.dataset.id),
  'cancel-plan': () => run?.controller.abort(),
  'dismiss-error': () => {
    runError = '';
    renderRun();
  },
  'plan-tab': (el) => {
    planTab = el.dataset.tab;
    renderPlan();
    $(`[data-action="plan-tab"][data-tab="${planTab}"]`)?.focus();
  },
  'open-plan': (el) => {
    currentPlanId = el.dataset.id;
    planTab = 'list';
    render();
    $('#meals-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'copy-list': copyList,
  'delete-plan': deletePlan,
});

window.addEventListener('storage', (e) => {
  if (e.key !== 'shelf.meals.v1' || run) return;
  data = mstore.load();
  if (!currentPlan()) currentPlanId = data.plans[0]?.id ?? null;
  if (!$('#view-meals').hidden) render();
});
