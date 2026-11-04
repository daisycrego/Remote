// A tiny HTML template helper that escapes everything it interpolates,
// so book titles, notes and API data can never inject markup.
//
//   html`<p>${userText}</p>`          -> escaped
//   html`<ul>${items.map(row)}</ul>`  -> arrays are joined, nested html`` is kept

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class SafeHTML {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

export function setHTML(el, content) {
  el.innerHTML = render(content);
}
