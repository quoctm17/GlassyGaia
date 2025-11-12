// Canonical content types used across the app
// Keep this list centralized for easy expansion

export type ContentType = 'movie' | 'series' | 'book' | 'audio';

export const CONTENT_TYPES: ContentType[] = ['movie', 'series', 'book', 'audio'];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  movie: 'Movie',
  series: 'Series',
  book: 'Book',
  audio: 'Audio',
};
