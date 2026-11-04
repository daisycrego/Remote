# Shelf

A small, calm personal app with two sections:

- **Books**: track what you're reading, what's next, and what you thought of it.
- **Meals**: give it a budget, a number of days and meals, and the shops you use. Claude searches the web
  for current prices at those shops, picks recipes, and gives you a priced shopping list.

It's a static site hosted on GitHub Pages: no build step, no server, no account.

**Live site:** https://daisycrego.github.io/Remote/ (once GitHub Pages is on; see below)

## Books

- **Currently reading** at the top, with page progress.
- Shelves for **To read**, **Read** (rating and finish date) and **Dropped**, plus **All**.
- **Book search** through [Open Library](https://openlibrary.org/developers/api): free, no API key, with covers.
  If a book isn't there, you can add it by hand.
- Notes on any book, plus start and finish dates that fill themselves in when you change status.
- A yearly count of books and pages read.

## Meals

1. Open **Meals → Settings** and add:
   - an **Anthropic API key** from the [Claude Console](https://platform.claude.com/settings/keys)
     (giving it a monthly spend limit is a good idea);
   - **your shops**, each with an optional address or website so Claude finds the right store;
   - optionally **your city, region and country code**, so search results are local.
2. Fill in a budget, days, which meals, how many people, and any preferences or ingredients you already have.
3. **Plan my meals.** While Claude works you can watch what it searches and reads; it usually takes a few minutes.

You get:

- a **shopping list grouped by shop**, with checkboxes, a per-shop subtotal and a total against your budget;
- each price marked **Listed price** (Claude saw it in a listing for that shop, with a link) or **Estimate**;
- **recipes by day**, with ingredients, steps, a link to the original recipe when there is one, and planned leftovers;
- **notes**: assumptions, caveats, the pages Claude looked at, and what the plan cost.

Plans are saved, so you can come back to the list in the shop and tick things off.

### How it works

The browser calls the Claude API directly with your key, using the official
[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) (bundled in `js/vendor/`).
The request uses:

- **Claude Opus 5.5** by default (Claude Sonnet 5.5 is available in settings to lower the cost), at high effort;
- the **web search** and **web fetch** server tools, with search results localized to your area;
- a strict `submit_meal_plan` tool that returns the plan as structured data, which the app checks before showing it.
  The total is recalculated from the line prices, and a price only counts as "listed" when it has a source link;
- **server-side fallback** (`fallbacks: "default"`): if the model declines a request, the API retries it on
  another model automatically;
- prompt caching, and automatic continuation when a long search turn pauses (`pause_turn`).

### Cost

Each web search costs $0.01, and you pay for the tokens Claude reads and writes, including search results.
Settings cap the number of searches (15 by default). Every plan's **Notes** tab shows the searches and tokens it
used, with an approximate cost at Anthropic's list prices.

### Your API key

The key is saved only in this browser's local storage and sent only to `api.anthropic.com`. It's never included
in backups. Anyone who can use your browser profile could read it, so use a key with a spend limit, and remove it
from settings if you share the device.

## Where your data lives

Everything is saved in your browser's `localStorage` on the device you're using. To move books, shops and meal plans
between devices, use **⋯ → Export backup** on one device and **Import backup** on the other. Importing merges and
never deletes.

## Turning on GitHub Pages

1. Repo **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the branch with this code and the **/ (root)** folder, then **Save**.

Each push to that branch then redeploys the site in about a minute.

## Running it locally

It uses ES modules, so serve it rather than opening the file directly:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Code layout

```
index.html               page shell, views and dialogs
css/styles.css           all styles (light and dark tokens at the top)
js/app.js                entry point: Books view, navigation, export/import
js/meals.js              Meals view: settings, plan form, progress, saved plans
js/planner.js            the Claude request: prompt, tools, streaming loop, plan validation
js/meals-store.js        meal planner storage (API key kept separately, never exported)
js/store.js              book storage, validation, import/export merge
js/ui.js                 shared helpers: actions, dialogs, toasts, formatting
js/types.js              item types and status labels
js/openlibrary.js        book search
js/html.js               tiny auto-escaping HTML template helper
js/vendor/anthropic-sdk.mjs   the Anthropic SDK as one browser module
tools/build-sdk.sh       rebuilds the SDK bundle (needs Node.js)
```

## Data model

```js
// localStorage "shelf.v1"
{
  version: 1,
  items: [{
    id, type: 'book',
    title, creator, year, pages, coverUrl,
    source: { name: 'openlibrary', id: '/works/OL…W' } | null,
    status: 'want' | 'doing' | 'done' | 'dropped',
    progress, rating /* 0–5 */, notes,
    startedAt, finishedAt /* YYYY-MM-DD */,
    addedAt, updatedAt /* ISO timestamps */
  }]
}

// localStorage "shelf.meals.v1"
{
  settings: { model, maxSearches, city, region, country, timezone, currency },
  shops: [{ id, name, details }],
  plans: [{
    id, createdAt, request, model, usage, cost, sources, checked,
    plan: { summary, currency, total, meals: [...], shoppingList: [...], pantryAssumed, notes }
  }]
}
```

The book statuses are generic on purpose, so other kinds of items can reuse them:
*want / doing / done / dropped* reads as *to read / reading / read*, *to watch / watching / watched*,
or *to do / in progress / done*.

## Ideas for next steps

- Movies and TV shows (TVmaze is free with no API key; TMDB needs a free API key).
- General to-dos alongside the media shelves, and adding a meal plan's shopping list as to-dos.
- Sync across devices without manual export, for example by saving to a GitHub Gist or a small backend.
- Import a Goodreads CSV export.
- Installable on a phone home screen (web app manifest and offline support).
