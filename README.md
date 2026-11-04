# Shelf

A small, calm tracker for what you're reading, what's next, and what you thought of it.
It's a static site hosted on GitHub Pages: no build step, no server, no account.

**Live site:** https://daisycrego.github.io/Remote/ (once GitHub Pages is on; see below)

## What it does

- **Currently reading** at the top, with page progress.
- Shelves for **To read**, **Read** (rating and finish date) and **Dropped**, plus **All**.
- **Book search** through [Open Library](https://openlibrary.org/developers/api): free, no API key, with covers.
  If a book isn't there, you can add it by hand.
- Notes on any book, plus start and finish dates that fill themselves in when you change status.
- A yearly count of books and pages read.
- Light and dark themes, and a layout built for phones first.

## Where your data lives

Everything is saved in your browser's `localStorage` on the device you're using. Nothing is sent anywhere,
apart from search queries to Open Library. To move books between devices, use **⋯ → Export backup**
on one device and **Import backup** on the other. Importing merges and never deletes.

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
index.html          page shell and dialogs
css/styles.css      all styles (light and dark tokens at the top)
js/app.js           rendering and interactions
js/store.js         localStorage, validation, import/export merge
js/types.js         item types and status labels
js/openlibrary.js   book search
js/html.js          tiny auto-escaping HTML template helper
```

## Data model

```js
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
```

The statuses are generic on purpose, so other kinds of items can reuse them:
*want / doing / done / dropped* reads as *to read / reading / read*, *to watch / watching / watched*,
or *to do / in progress / done*.

## Ideas for next steps

- Movies and TV shows (TVmaze is free with no API key; TMDB needs a free API key).
- General to-dos alongside the media shelves.
- Sync across devices without manual export, for example by saving to a GitHub Gist or a small backend.
- Import a Goodreads CSV export.
- Installable on a phone home screen (web app manifest and offline support).
