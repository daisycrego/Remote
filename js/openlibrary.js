// Book search via Open Library (https://openlibrary.org/developers/api).
// Free, no API key, and it allows requests straight from the browser.

const SEARCH_URL = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median';

export async function searchBooks(query, { signal } = {}) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=12&fields=${FIELDS}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
  const data = await res.json();
  return (data.docs ?? [])
    .filter((doc) => doc.title)
    .map((doc) => ({
      type: 'book',
      title: doc.title,
      creator: (doc.author_name ?? []).slice(0, 2).join(', '),
      year: doc.first_publish_year ?? null,
      pages: doc.number_of_pages_median ?? null,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
      source: { name: 'openlibrary', id: doc.key },
    }));
}

export function openLibraryUrl(source) {
  if (source?.name !== 'openlibrary' || !/^\/works\/OL\w+$/.test(source.id ?? '')) return '';
  return `https://openlibrary.org${source.id}`;
}
