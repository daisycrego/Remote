// Shared UI plumbing: element lookup, click actions, dialogs, toasts, formatting.

import { html, setHTML } from './html.js';

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- actions
// Any element with data-action="name" runs actions[name](element, event) on click.

export const actions = {
  'close-dialog': (el) => el.closest('dialog')?.close(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});

// ---------------------------------------------------------------- dialogs

// Close dialogs when clicking the backdrop (but not when a drag ends there).
export function enableBackdropClose(dialog) {
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === dialog) dialog.close();
    downOnBackdrop = false;
  });
}

// ---------------------------------------------------------------- toast

const toastEl = $('#toast');
const supportsPopover = typeof toastEl.showPopover === 'function';
let toastTimer;
let toastAction = null;

export function toast(message, action) {
  setHTML(toastEl, html`<span class="toast-msg">${message}</span>${action && html`<button type="button" class="toast-btn" data-toast-action>${action.label}</button>`}`);
  toastAction = action?.run ?? null;
  if (supportsPopover) {
    // Re-showing moves it above any dialog that opened since.
    if (toastEl.matches(':popover-open')) toastEl.hidePopover();
    toastEl.showPopover();
  } else {
    toastEl.classList.add('show');
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 3500);
}

export function hideToast() {
  clearTimeout(toastTimer);
  toastAction = null;
  if (supportsPopover) {
    if (toastEl.matches(':popover-open')) toastEl.hidePopover();
  } else {
    toastEl.classList.remove('show');
  }
}

toastEl.addEventListener('click', (e) => {
  if (!e.target.closest('[data-toast-action]')) return;
  const run = toastAction;
  hideToast();
  run?.();
});

// ---------------------------------------------------------------- formatting

// Only http(s) links are ever rendered; anything else becomes ''.
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

export function hostOf(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function formatMoney(amount, currency = 'USD') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function currencySymbol(currency) {
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

export function formatDate(value, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '';
  // Plain YYYY-MM-DD dates are local calendar days; anything else is a timestamp.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, opts);
}
