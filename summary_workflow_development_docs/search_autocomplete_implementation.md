---
description: How to implement Search Autocomplete
---

# Search Autocomplete Implementation Guide

This document outlines the implementation details of the search autocomplete feature in the GlassyGaia project.

## Overview
The autocomplete system provides fast, efficient search suggestions based on terms that actually exist in the database (inverted index approach). It uses a dedicated `search_terms` table in D1 to avoid heavy full-text search queries during typing.

## Key Files
- **Frontend**
  - `src/components/SearchBar.tsx`: content handling user input, debouncing, and displaying suggestions.
  - `src/styles/components/search-bar.css`: Styling for the search bar and dropdown (using "Noto Sans").
  - `src/services/cfApi.ts`: `apiSearchAutocomplete` function calling the worker endpoint.

- **Backend (Cloudflare Worker)**
  - `cloudflare-worker/src/worker.js`: 
    - `/api/search/autocomplete` endpoint logic.
    - `/search` (FTS) endpoint "Strict Mode" validation.
  - `cloudflare-worker/migrations/041_add_search_terms_index.sql`: Schema for `search_terms` table.

## Implementation Logic

### 1. Database Schema (`search_terms`)
A lightweight table designed for prefix matching:
```sql
CREATE TABLE search_terms (
  term TEXT NOT NULL,
  language TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  UNIQUE(term, language)
);
CREATE INDEX idx_search_terms_autocomplete ON search_terms(language, term, frequency DESC);
```

### 2. Frontend Flow (`SearchBar.tsx`)
1. **User Types**: Input changes trigger `useEffect`.
2. **Debounce**: A 200ms debounce prevents API spam.
3. **API Call**: `apiSearchAutocomplete` is called with the current query `q`.
4. **Display**: Results are shown in a dropdown using `search-autocomplete-dropdown` class (Moto Sans font).
5. **Selection**: Clicking a term sets the search value and triggers a search.

### 3. Backend Logic (`worker.js`)
- **Autocomplete Endpoint** (`/api/search/autocomplete`):
  - Accepts `q` (prefix), `limit`, and optional `language`.
  - Performs a fast `LIKE ? || '%'` query on `search_terms`.
  - Returns suggestions sorted by frequency (popularity) and then term.

- **Strict Search Mode** (`/search`):
  - When the user submits a search (e.g., presses Enter), the FTS endpoint validates the query.
  - **Inverted Index Check**: It checks `SELECT 1 FROM search_terms WHERE term = ?`.
  - **Logic**: 
    - If the term exists in the index -> Proceed with Full-Text Search.
    - If the term does **NOT** exist -> Return `[]` (empty results) immediately.
  - This prevents the system from falling back to slow, inaccurate substring matches for gibberish or non-indexed terms.

## Styling
The dropdown uses specific classes in `search-bar.css`:
- `.search-autocomplete-dropdown`: Container with absolute positioning and "Noto Sans" font family.
- `.search-autocomplete-item`: Individual suggestion row with hover effects.

## Performance Considerations
- **Strict Mode**: Prevents expensive FTS5 queries for invalid terms.
- **Prefix Index**: The `search_terms` index is optimized for `LIKE 'prefix%'` queries.
- **Worker Caching**: (Optional) The worker could cache autocomplete results in KV if traffic substantially increases.
