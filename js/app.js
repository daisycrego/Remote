import { html, setHTML } from './html.js';
import { $, actions, enableBackdropClose, formatDate, toast } from './ui.js';
import * as store from './store.js';
import * as meals from './meals.js';
import { searchBooks, openLibraryUrl } from './openlibrary.js';
import { STATUS_ORDER, TYPES } from './types.js';

const T = TYPES.book;

const TABS = [
  { id: 'want', label: T.shelf.want },
  { id: 'done', label: T.shelf.done },
  { id: 'dropped', label: T.shelf.dropped },
  { id: 'all', label: 'All' },
];

let state = store.load();
const ui = { tab: store.loadPref('tab', 'want'), filter: '' };
if (!TABS.some((t) => t.id === ui.tab)) ui.tab = 'want';

let openItemId = null;
let warnedStorage = false;

const itemDialog = $('#item-dialog');
const addDialog = $('#add-dialog');
const menuDialog = $('#menu-dialog');

// ---------------------------------------------------------------- views (#books, #meals)

const VIEWS = ['books', 'meals'];

function currentView() {
  const name = location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(name) ? name : 'books';
}

function showView() {
  const view = currentView();
  for (const name of VIEWS) {
    $(`#view-${name}`).hidden = name !== view;
    const link = $(`[data-nav="${name}"]`);
    if (name === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = view === 'meals' ? 'Meals · Shelf' : 'Shelf';
  if (view === 'meals') meals.render();
}

window.addEventListener('hashchange', () => {
  showView();
  window.scrollTo(0, 0);
});

// ---------------------------------------------------------------- helpers

const getItem = (id) => state.items.find((i) => i.id === id);
const findBySource = (source) =>
  source && state.items.find((i) => i.source?.name === source.name && i.source?.id === source.id);
const byDesc = (key) => (a, b) => (b[key] || '').localeCompare(a[key] || '');

function progressPct(item) {
  if (!item.pages) return 0;
  return Math.min(100, Math.round((item.progress / item.pages) * 100));
}

function progressLabel(item) {
  if (item.pages) return `Page ${item.progress} of ${item.pages} · ${progressPct(item)}%`;
  return item.progress ? `Page ${item.progress}` : 'Add the page count to track progress';
}

function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function initials(text) {
  const words = text.replace(/^(the|a|an)\s+/i, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
}

// Cover URLs that failed to load this session, so re-renders skip straight to the placeholder.
const brokenCovers = new Set();

function cover(item, size) {
  if (item.coverUrl && !brokenCovers.has(item.coverUrl)) {
    return html`<img class="cover cover-${size}" src="${item.coverUrl}" alt="" loading="lazy" decoding="async"
      data-size="${size}" data-title="${item.title}">`;
  }
  return placeholderCover(item.title, size);
}

function placeholderCover(title, size) {
  return html`<span class="cover cover-${size} cover-placeholder" style="--hue:${hue(title)}" aria-hidden="true">${initials(title)}</span>`;
}

function stars(rating) {
  if (!rating) return '';
  return html`<span class="stars" role="img" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}<span class="stars-off">${'★'.repeat(5 - rating)}</span></span>`;
}

function metaLine(parts) {
  return parts.filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- state changes

function persist() {
  if (!store.save(state) && !warnedStorage) {
    warnedStorage = true;
    toast("This browser isn't letting Shelf save, so changes will be lost when you reload.");
  }
  render();
}

function updateItem(id, patch) {
  const item = getItem(id);
  if (!item) return;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  persist();
}

function addItem(fields, status) {
  const item = store.createItem(fields, status);
  state.items.unshift(item);
  persist();
  return item;
}

function changeStatus(id, status) {
  const item = getItem(id);
  if (!item || item.status === status) return;
  updateItem(id, store.statusPatch(item, status));
  rerenderItemDialog(`[data-action="status"][data-status="${status}"]`);
}

function rate(id, rating) {
  const item = getItem(id);
  if (!item) return;
  updateItem(id, { rating: item.rating === rating ? 0 : rating });
  rerenderItemDialog(`[data-action="rate"][data-rating="${rating}"]`);
}

function deleteItem(id) {
  const index = state.items.findIndex((i) => i.id === id);
  if (index < 0) return;
  const [removed] = state.items.splice(index, 1);
  itemDialog.close();
  persist();
  toast(`Removed “${removed.title}”`, {
    label: 'Undo',
    run: () => {
      state.items.splice(Math.min(index, state.items.length), 0, removed);
      persist();
    },
  });
}

// ---------------------------------------------------------------- main view

function render() {
  renderCurrent();
  renderLibrary();
}

function renderCurrent() {
  const reading = state.items.filter((i) => i.status === 'doing').sort(byDesc('updatedAt'));
  const el = $('#current');

  if (!state.items.length) {
    setHTML(el, html`
      <div class="welcome">
        <h2 id="current-heading">Welcome to your shelf</h2>
        <p>Keep track of what you're reading, what's next, and what you thought of it.</p>
        <button type="button" class="btn primary" data-action="open-add">Add your first book</button>
      </div>`);
    return;
  }

  setHTML(el, html`
    <div class="section-head">
      <h2 id="current-heading">${T.currentHeading}</h2>
      <button type="button" class="btn primary" data-action="open-add"><span aria-hidden="true">+</span> Add book</button>
    </div>
    ${reading.length
      ? html`<div class="current-grid">${reading.map(currentCard)}</div>`
      : html`<p class="empty-current">Nothing on the go. Open a book from <em>${T.shelf.want}</em> and set it to <em>${T.status.doing}</em>.</p>`}`);
}

function currentCard(item) {
  return html`
    <article class="current-card" data-open="${item.id}" tabindex="0" aria-label="${item.title}">
      ${cover(item, 'md')}
      <div class="current-info">
        <h3 class="title">${item.title}</h3>
        ${item.creator && html`<p class="creator">${item.creator}</p>`}
        <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${progressPct(item)}%"></div></div>
        <p class="progress-label">${progressLabel(item)}</p>
        <button type="button" class="btn small" data-action="progress" data-id="${item.id}">Update progress</button>
      </div>
    </article>`;
}

function renderLibrary() {
  const library = $('#library');
  library.hidden = state.items.length === 0;
  if (library.hidden) return;

  const counts = { all: state.items.length };
  for (const s of STATUS_ORDER) counts[s] = state.items.filter((i) => i.status === s).length;

  setHTML($('#tabs'), TABS.map((t) => html`
    <button type="button" role="tab" class="tab" id="tab-${t.id}" aria-selected="${String(t.id === ui.tab)}"
      data-action="tab" data-tab="${t.id}">${t.label}<span class="tab-count">${counts[t.id]}</span></button>`));
  $('#list').setAttribute('aria-labelledby', `tab-${ui.tab}`);

  let items = ui.tab === 'all' ? [...state.items] : state.items.filter((i) => i.status === ui.tab);
  const q = ui.filter.trim().toLowerCase();
  if (q) items = items.filter((i) => `${i.title} ${i.creator}`.toLowerCase().includes(q));

  if (ui.tab === 'done') items.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '') || byDesc('updatedAt')(a, b));
  else if (ui.tab === 'want') items.sort(byDesc('addedAt'));
  else items.sort(byDesc('updatedAt'));

  setHTML($('#list-summary'), summary());

  if (!items.length) {
    setHTML($('#list'), html`<p class="empty">${q ? `No books match “${ui.filter.trim()}”.` : emptyMessage()}</p>`);
    return;
  }
  setHTML($('#list'), items.map(row));
}

function summary() {
  if (ui.tab !== 'done') return '';
  const read = state.items.filter((i) => i.status === 'done');
  if (!read.length) return '';
  const year = String(new Date().getFullYear());
  const thisYear = read.filter((i) => i.finishedAt.startsWith(year));
  const pages = thisYear.reduce((sum, i) => sum + (i.pages || 0), 0);
  return html`<strong>${thisYear.length}</strong> read in ${year}${pages ? html` · <strong>${pages.toLocaleString()}</strong> pages` : ''}`;
}

function emptyMessage() {
  return {
    want: 'Nothing on your list yet. Add a book you want to read.',
    done: 'Books you finish will show up here.',
    dropped: 'Books you give up on will show up here. No guilt.',
    all: 'Your shelf is empty.',
  }[ui.tab];
}

function row(item) {
  let meta;
  if (item.status === 'done') meta = html`${stars(item.rating)}${item.finishedAt ? html`<span>Finished ${formatDate(item.finishedAt)}</span>` : ''}`;
  else if (item.status === 'doing') meta = progressLabel(item);
  else if (item.status === 'dropped') meta = metaLine([item.progress && `Stopped at page ${item.progress}`, item.finishedAt && formatDate(item.finishedAt)]);
  else meta = metaLine([item.year, item.pages && `${item.pages} pages`]);

  return html`
    <button type="button" class="row" data-open="${item.id}">
      ${cover(item, 'sm')}
      <span class="row-main">
        <span class="title">${item.title}</span>
        ${item.creator && html`<span class="creator">${item.creator}</span>`}
        <span class="meta">${meta}</span>
      </span>
      ${ui.tab === 'all' && html`<span class="pill pill-${item.status}">${T.status[item.status]}</span>`}
    </button>`;
}

// ---------------------------------------------------------------- item dialog

function openItem(id, { focus } = {}) {
  const item = getItem(id);
  if (!item) return;
  openItemId = id;
  renderItemDialog(item);
  if (!itemDialog.open) itemDialog.showModal();
  const target = focus === 'progress' ? $('#f-progress', itemDialog) : $('[data-action="close-dialog"]', itemDialog);
  target?.focus();
  if (focus === 'progress') target?.select();
}

function rerenderItemDialog(focusSelector) {
  const item = getItem(openItemId);
  if (!item || !itemDialog.open) return;
  renderItemDialog(item);
  if (focusSelector) $(focusSelector, itemDialog)?.focus();
}

function renderItemDialog(item) {
  const link = openLibraryUrl(item.source);
  const showProgress = item.status === 'doing' || item.status === 'dropped';

  setHTML(itemDialog, html`
    <div class="sheet">
      <header class="sheet-bar">
        <span></span>
        <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">✕</button>
      </header>
      <div class="sheet-body">
        <div class="item-head">
          ${cover(item, 'lg')}
          <div>
            <h2 id="item-title" class="item-title">${item.title}</h2>
            ${item.creator && html`<p class="creator">${item.creator}</p>`}
            <p class="meta">${metaLine([item.year, item.pages && `${item.pages} pages`])}</p>
            ${link && html`<a class="ext-link" href="${link}" target="_blank" rel="noopener">View on Open Library ↗</a>`}
          </div>
        </div>

        <div class="field">
          <span class="label" id="status-label">Status</span>
          <div class="segmented" role="group" aria-labelledby="status-label">
            ${STATUS_ORDER.map((s) => html`<button type="button" data-action="status" data-status="${s}" aria-pressed="${String(item.status === s)}">${T.status[s]}</button>`)}
          </div>
        </div>

        ${showProgress && progressFields(item)}
        ${dateFields(item)}

        ${item.status === 'done' && html`
          <div class="field">
            <span class="label" id="rating-label">Your rating</span>
            <div class="rating" role="group" aria-labelledby="rating-label">
              ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="star" data-action="rate" data-rating="${n}"
                aria-pressed="${String(item.rating === n)}" aria-label="${n} star${n > 1 ? 's' : ''}" data-on="${String(n <= item.rating)}">★</button>`)}
            </div>
          </div>`}

        <div class="field">
          <label class="label" for="f-notes">Notes</label>
          <textarea id="f-notes" data-field="notes" rows="4" placeholder="Thoughts, quotes, who recommended it…">${item.notes}</textarea>
        </div>
      </div>
      <footer class="sheet-foot">
        <button type="button" class="btn danger-ghost" data-action="delete">Remove</button>
        <button type="button" class="btn primary" data-action="close-dialog">Done</button>
      </footer>
    </div>`);
}

function progressFields(item) {
  const atEnd = item.status === 'doing' && item.pages && item.progress >= item.pages;
  return html`
    <div class="field">
      <label class="label" for="f-progress">${item.status === 'dropped' ? 'Stopped at' : 'Progress'}</label>
      <div class="progress-inputs">
        <span>Page</span>
        <input id="f-progress" type="number" inputmode="numeric" min="0" data-field="progress" value="${item.progress || ''}" placeholder="0">
        <span>of</span>
        <input id="f-pages" type="number" inputmode="numeric" min="1" data-field="pages" value="${item.pages ?? ''}" placeholder="?" aria-label="Total pages">
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" data-progress-bar style="width:${progressPct(item)}%"></div></div>
      <p class="hint" data-progress-label>${progressLabel(item)}</p>
      <button type="button" class="btn small" data-action="mark-done" data-finish-hint ${atEnd ? '' : 'hidden'}>Finished it? Mark as read</button>
    </div>`;
}

function dateFields(item) {
  const started = html`<label class="date-field">Started <input type="date" data-field="startedAt" value="${item.startedAt}"></label>`;
  const ended = (label) => html`<label class="date-field">${label} <input type="date" data-field="finishedAt" value="${item.finishedAt}"></label>`;
  if (item.status === 'want') return html`<p class="hint">Added ${formatDate(item.addedAt)}</p>`;
  if (item.status === 'doing') return html`<div class="field dates">${started}</div>`;
  return html`<div class="field dates">${started}${ended(item.status === 'done' ? 'Finished' : 'Stopped')}</div>`;
}

// Inputs in the item dialog save as you type.
itemDialog.addEventListener('input', (e) => {
  const field = e.target.dataset?.field;
  const item = getItem(openItemId);
  if (!field || !item) return;

  let value = e.target.value;
  if (field === 'progress') value = Math.max(0, Number.parseInt(value, 10) || 0);
  if (field === 'pages') value = Number.parseInt(value, 10) > 0 ? Number.parseInt(value, 10) : null;
  updateItem(item.id, { [field]: value });

  if (field === 'progress' || field === 'pages') {
    $('[data-progress-bar]', itemDialog).style.width = `${progressPct(item)}%`;
    $('[data-progress-label]', itemDialog).textContent = progressLabel(item);
    $('[data-finish-hint]', itemDialog).hidden = !(item.status === 'doing' && item.pages && item.progress >= item.pages);
  }
});

itemDialog.addEventListener('close', () => {
  openItemId = null;
});

// ---------------------------------------------------------------- add dialog

let lastResults = [];
let searchTimer;
let searchAbort;
const searchInput = $('#search-input');
const resultsEl = $('#search-results');

function openAdd() {
  if (!addDialog.open) addDialog.showModal();
  renderResults(lastResults.length ? {} : { idle: true });
  searchInput.focus();
  searchInput.select();
}

function renderResults({ idle, loading, error } = {}) {
  if (idle) {
    setHTML(resultsEl, html`<p class="results-note">Search millions of books from <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>.</p>`);
    return;
  }
  if (loading) {
    resultsEl.classList.add('is-loading');
    if (!lastResults.length) setHTML(resultsEl, html`<p class="results-note">Searching…</p>`);
    return;
  }
  resultsEl.classList.remove('is-loading');
  if (error) {
    setHTML(resultsEl, html`<p class="results-note error">Couldn't reach Open Library. Check your connection, or add the book by hand below.</p>`);
    return;
  }
  if (!lastResults.length) {
    setHTML(resultsEl, html`<p class="results-note">No matches. Try a different spelling, or add it by hand below.</p>`);
    return;
  }
  setHTML(resultsEl, html`<ul class="result-list">${lastResults.map(resultRow)}</ul>`);
}

function resultRow(result, index) {
  const existing = findBySource(result.source);
  return html`
    <li class="result">
      ${cover(result, 'sm')}
      <div class="row-main">
        <span class="title">${result.title}</span>
        ${result.creator && html`<span class="creator">${result.creator}</span>`}
        <span class="meta">${metaLine([result.year, result.pages && `${result.pages} pages`])}</span>
      </div>
      <div class="result-actions">
        ${existing
          ? html`<button type="button" class="btn small ghost" data-action="open-existing" data-id="${existing.id}">On shelf: ${T.status[existing.status]}</button>`
          : html`
            <button type="button" class="btn small" data-action="add-result" data-index="${index}" data-status="want">Want to read</button>
            <button type="button" class="btn small primary" data-action="add-result" data-index="${index}" data-status="doing">Reading</button>`}
      </div>
    </li>`;
}

async function runSearch(query) {
  clearTimeout(searchTimer);
  searchAbort?.abort();
  const controller = new AbortController();
  searchAbort = controller;
  renderResults({ loading: true });
  try {
    lastResults = await searchBooks(query, { signal: controller.signal });
    renderResults();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('Shelf: search failed', err);
    lastResults = [];
    renderResults({ error: true });
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchAbort?.abort();
    lastResults = [];
    renderResults({ idle: true });
    return;
  }
  searchTimer = setTimeout(() => runSearch(query), 350);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchInput.value.trim().length >= 1) {
    e.preventDefault();
    runSearch(searchInput.value.trim());
  }
});

function addFromResult(index, status) {
  const result = lastResults[index];
  if (!result || findBySource(result.source)) return;
  addItem(result, status);
  renderResults();
  toast(`Added “${result.title}” to ${T.status[status]}`);
}

$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const status = e.submitter?.value === 'doing' ? 'doing' : 'want';
  const item = addItem({ type: 'book', ...data }, status);
  form.reset();
  $('#manual').open = false;
  addDialog.close();
  toast(`Added “${item.title}” to ${T.status[status]}`);
});

// ---------------------------------------------------------------- menu: export / import

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function openMenu() {
  const plans = meals.planCount();
  $('#menu-count').textContent = `${plural(state.items.length, T.noun, T.nounPlural)} and ${plural(plans, 'meal plan', 'meal plans')} on this device.`;
  if (!menuDialog.open) menuDialog.showModal();
}

function exportData() {
  const backup = { ...state, meals: meals.exportData() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shelf-backup-${store.today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    raw = null;
  }
  const incoming = store.normalize(raw);
  const hasMeals = Array.isArray(raw?.meals?.plans) || Array.isArray(raw?.meals?.shops);
  if (!incoming.items.length && !hasMeals) {
    toast("That file doesn't look like a Shelf backup.");
    return;
  }
  const books = store.merge(state, incoming);
  state = books.state;
  persist();
  const mealCounts = hasMeals ? meals.importData(raw.meals) : { plans: 0, shops: 0 };
  menuDialog.close();
  const parts = [`${books.added} new and ${books.updated} updated ${T.nounPlural}`];
  if (mealCounts.plans || mealCounts.shops) parts.push(`${plural(mealCounts.plans, 'meal plan', 'meal plans')}, ${plural(mealCounts.shops, 'shop', 'shops')}`);
  toast(`Imported ${parts.join('; ')}`);
});

// ---------------------------------------------------------------- events

Object.assign(actions, {
  'open-add': openAdd,
  'open-menu': openMenu,
  tab: (el) => {
    ui.tab = el.dataset.tab;
    store.savePref('tab', ui.tab);
    renderLibrary();
  },
  progress: (el) => openItem(el.dataset.id, { focus: 'progress' }),
  status: (el) => changeStatus(openItemId, el.dataset.status),
  rate: (el) => rate(openItemId, Number(el.dataset.rating)),
  'mark-done': () => changeStatus(openItemId, 'done'),
  delete: () => deleteItem(openItemId),
  'add-result': (el) => addFromResult(Number(el.dataset.index), el.dataset.status),
  'open-existing': (el) => {
    addDialog.close();
    openItem(el.dataset.id);
  },
  export: exportData,
  import: () => $('#import-file').click(),
});

// Book cards and rows open the book (buttons inside them have their own actions).
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action]')) return;
  const openEl = e.target.closest('[data-open]');
  if (openEl) openItem(openEl.dataset.open);
});

// Cards are focusable divs (they contain a button), so give them keyboard support.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]:not(button)')) {
    e.preventDefault();
    openItem(e.target.dataset.open);
  }
});

for (const dialog of document.querySelectorAll('dialog')) enableBackdropClose(dialog);

// Covers that fail to load are swapped for the lettered placeholder.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover')) return;
    brokenCovers.add(img.getAttribute('src'));
    const holder = document.createElement('template');
    setHTML(holder, placeholderCover(img.dataset.title || '', img.dataset.size || 'sm'));
    img.replaceWith(holder.content);
  },
  true,
);

$('#filter').addEventListener('input', (e) => {
  ui.filter = e.target.value;
  renderLibrary();
});

// Keep multiple open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key !== store.KEY) return;
  state = store.load();
  render();
});

render();
showView();
