// Every entry on the shelf has a `type`. Only books exist today, but the
// statuses are deliberately generic so movies, TV shows and plain to-dos can
// reuse the same data and UI later:
//
//   want    -> Want to read  / Want to watch / To do
//   doing   -> Reading       / Watching      / In progress
//   done    -> Read          / Watched       / Done
//   dropped -> Dropped       / Dropped       / Won't do

export const STATUS_ORDER = ['want', 'doing', 'done', 'dropped'];

export const TYPES = {
  book: {
    noun: 'book',
    nounPlural: 'books',
    status: {
      want: 'Want to read',
      doing: 'Reading',
      done: 'Read',
      dropped: 'Dropped',
    },
    // Shorter names for the shelf tabs, so they fit on a phone.
    shelf: {
      want: 'To read',
      done: 'Read',
      dropped: 'Dropped',
    },
    currentHeading: 'Currently reading',
  },
};
