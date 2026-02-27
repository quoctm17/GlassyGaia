# Routing Refactor: Monolithic Worker → itty-router Modular Architecture

> **Date:** February 2026
> **Scope:** Cloudflare Worker backend (`cloudflare-worker/src/`)
> **Library:** [`itty-router`](https://github.com/kwhitley/itty-router) v5.0.23

---

## Table of Contents

1. [Overview](#overview)
2. [Why We Refactored](#why-we-refactored)
3. [Architecture Before vs After](#architecture-before-vs-after)
4. [File Structure](#file-structure)
5. [Entry Point — `router.js`](#entry-point--routerjs)
6. [Handler Pattern — `registerXxxRoutes(router)`](#handler-pattern--registerxxxroutesrouter)
7. [Utilities, Services, and Middleware](#utilities-services-and-middleware)
8. [CORS Handling](#cors-handling)
9. [Configuration Changes](#configuration-changes)
10. [Deployment](#deployment)
11. [Files Changed Summary](#files-changed-summary)

---

## Overview

The backend was migrated from a **single monolithic `worker.js`** (~9,950 lines) into a **modular architecture** powered by `itty-router`. The refactoring was done in three phases:

| Phase | Description |
|-------|-------------|
| **Phase 1** | Endpoint cleanup (removed unused `/api/search/autocomplete`) |
| **Phase 2** | Extracted code into modular files with a sequential `forEach` router |
| **Phase 3** | Replaced custom router with `itty-router` for standard, declarative routing |

The final result is a clean separation of concerns across **27 source files** with zero logic changes.

---

## Why We Refactored

### Problems with the monolithic `worker.js`

- **Unmanageable size:** ~9,950 lines in a single file made navigation, debugging, and code review extremely difficult.
- **High merge conflict risk:** Multiple developers working on the same file would constantly conflict.
- **O(N) route matching:** A chain of `if (path === '...' && request.method === '...')` statements meant every request scanned through all route conditions sequentially.
- **Manual parameter extraction:** Path parameters (e.g., `/cards/:id`) required manual `path.match(/regex/)` calls.
- **Scattered CORS logic:** Every response was individually wrapped with `withCors()`.

### What `itty-router` provides

- **Method-specific routing:** `router.get()`, `router.post()`, etc. — only matching handlers are evaluated.
- **Automatic path parameters:** `/cards/:id` → `request.params.id` (no regex needed).
- **Middleware pipeline:** `before` (runs before all routes), `finally` (runs after), `catch` (global error handler).
- **Built-in CORS:** `cors()` utility generates `preflight` and `corsify` middleware automatically.
- **Tiny footprint:** ~1 KB gzipped — negligible impact on worker bundle size.

---

## Architecture Before vs After

### Before (monolithic)

```
cloudflare-worker/src/
└── worker.js          ← 9,950 lines, ALL routes + logic + utilities
```

### After (modular with itty-router)

```
cloudflare-worker/src/
├── router.js              ← Entry point (59 lines)
├── handlers/              ← 15 route handler files
│   ├── auth.js
│   ├── search.js
│   ├── r2.js
│   ├── media.js
│   ├── items.js
│   ├── cards.js
│   ├── categories.js
│   ├── import.js
│   ├── progress.js
│   ├── cardOps.js
│   ├── user.js
│   ├── content.js
│   ├── comments.js
│   ├── users.js
│   └── admin.js
├── utils/                 ← 7 shared utility files
│   ├── response.js
│   ├── cors.js
│   ├── db.js
│   ├── fts.js
│   ├── japanese.js
│   ├── levels.js
│   └── constants.js
├── middleware/             ← 1 middleware file
│   └── auth.js
└── services/              ← 3 service files
    ├── scheduled.js
    ├── gamification.js
    └── cardHelpers.js
```

---

## Entry Point — `router.js`

**File:** `cloudflare-worker/src/router.js` (59 lines)

This is the **main entry point** of the Cloudflare Worker, referenced in `wrangler.toml` as `main = "src/router.js"`.

### Responsibilities

1. **Create the itty-router instance** with middleware pipeline
2. **Register all route groups** by calling each handler's `registerXxxRoutes(router)`
3. **Export `fetch` and `scheduled`** handlers for the Cloudflare Worker runtime

### Key Sections

#### CORS Configuration

```javascript
const { preflight, corsify } = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  headers: ['Content-Type', 'Authorization'],
  maxAge: 86400,  // 24 hours
});
```

- `preflight` — auto-responds to `OPTIONS` requests with correct CORS headers
- `corsify` — appends CORS headers to every outgoing response

#### Router Pipeline

```javascript
const router = Router({
  before: [preflight, withParams],    // Runs before route matching
  catch: (err) => error(500, { ... }),  // Global error handler
  finally: [customHeaders, corsify],  // Runs after route handler
});
```

| Stage | Middleware | Purpose |
|-------|-----------|---------|
| `before` | `preflight` | Handle OPTIONS requests for CORS |
| `before` | `withParams` | Extract path params into `request.params` |
| `catch` | error handler | Return 500 JSON for any uncaught error |
| `finally` | custom headers | Set `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` |
| `finally` | `corsify` | Append CORS headers to every response |

#### Route Registration

```javascript
registerAuthRoutes(router);       // /auth/*
registerSearchRoutes(router);     // /api/search, /api/content/autocomplete
registerR2Routes(router);         // /r2/*
registerMediaRoutes(router);      // /media/*
registerItemRoutes(router);       // /items/*, /api/items/*
registerCardRoutes(router);       // /cards/*, /api/card/*
registerCategoryRoutes(router);   // /categories/*
registerImportRoutes(router);     // /api/import/*
registerProgressRoutes(router);   // /api/progress/*
registerCardOpsRoutes(router);    // /api/card-ops/*
registerUserRoutes(router);       // /api/user/*
registerContentRoutes(router);    // /api/content/*
registerCommentRoutes(router);    // /api/comments/*
registerUsersRoutes(router);      // /users/*
registerAdminRoutes(router);      // /admin/*, /api/admin/*

router.all('*', () => error(404, 'Not found'));  // Catch-all 404
```

#### Worker Exports

```javascript
export default {
  fetch: (request, env, ctx) => router.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(resetDailyTables(env)),
};
```

- `fetch` — handles all HTTP requests via the router
- `scheduled` — handles cron triggers (daily table resets at 00:00 UTC)

---

## Handler Pattern — `registerXxxRoutes(router)`

Every handler file follows the same pattern:

```javascript
// handlers/example.js
import { json } from '../utils/response.js';

export function registerExampleRoutes(router) {
  router.get('/api/example', async (request, env) => {
    const url = new URL(request.url);
    const param = url.searchParams.get('key');
    // ... logic ...
    return json({ data: result });
  });

  router.get('/api/example/:id', async (request, env) => {
    const { id } = request.params;  // Automatic path param extraction
    // ... logic ...
    return json({ item });
  });

  router.post('/api/example', async (request, env) => {
    const body = await request.json();
    // ... logic ...
    return json({ created: true }, { status: 201 });
  });
}
```

### Handler Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `request` | `Request` | Standard Fetch API Request, extended with `request.params` by itty-router |
| `env` | `object` | Cloudflare Worker bindings: `env.DB` (D1), `env.MEDIA_BUCKET` (R2), `env.SEARCH_CACHE` (KV), `env.JWT_SECRET`, etc. |

### What Changed in Each Handler (Phase 2 → Phase 3)

| Before (Phase 2) | After (Phase 3) |
|-------------------|-----------------|
| `export async function handleXxx(path, request, env, url)` | `export function registerXxxRoutes(router)` |
| `if (path === '/foo' && request.method === 'GET')` | `router.get('/foo', async (request, env) => { ... })` |
| `const m = path.match(/^\/foo\/([^/]+)$/)` | `router.get('/foo/:id', ...)` → `request.params.id` |
| `url.searchParams.get('key')` | `const url = new URL(request.url); url.searchParams.get('key')` |
| `return withCors(json(...))` | `return json(...)` (CORS applied globally) |
| `return null` at end of function | Removed (itty-router handles 404 via catch-all) |

### 15 Handler Files

| File | Route Prefix | Key Endpoints |
|------|-------------|---------------|
| `auth.js` | `/auth/` | `POST /auth/signup`, `POST /auth/google`, `POST /auth/login` |
| `search.js` | `/api/search`, `/api/content/` | `GET /api/search`, `GET /api/search/counts`, `GET /api/content/autocomplete` |
| `r2.js` | `/r2/` | `GET /r2/*`, `POST /r2/upload`, `DELETE /r2/*` |
| `media.js` | `/media/` | `GET /media/:key+` |
| `items.js` | `/items/`, `/api/items/` | CRUD for items and episodes |
| `cards.js` | `/cards/`, `/api/card/` | CRUD for cards, saved cards, card subtitles |
| `categories.js` | `/categories/` | CRUD for categories |
| `import.js` | `/api/import/` | Bulk import endpoints |
| `progress.js` | `/api/progress/` | User progress tracking |
| `cardOps.js` | `/api/card-ops/` | Card operations (batch updates, etc.) |
| `user.js` | `/api/user/` | User profile, preferences, settings |
| `content.js` | `/api/content/` | Content metadata, languages |
| `comments.js` | `/api/comments/` | Comment CRUD |
| `users.js` | `/users/` | Admin user management |
| `admin.js` | `/admin/`, `/api/admin/` | Admin operations, DB management, populate search words |

---

## Utilities, Services, and Middleware

### `utils/` — Shared Helpers

| File | Purpose |
|------|---------|
| `response.js` | `json(data, init)` — creates a JSON `Response` with proper headers |
| `cors.js` | `withCors(response)` — legacy CORS wrapper (no longer used by handlers; kept for backward compatibility) |
| `db.js` | `retryD1Query(fn)` — retry wrapper for D1 database calls |
| `fts.js` | `buildFtsQuery()`, `escapeFtsToken()` — full-text search query builders |
| `japanese.js` | Japanese text processing helpers (tokenization, romaji, etc.) |
| `levels.js` | `getFrameworkFromLanguage()` — maps languages to proficiency frameworks (CEFR, JLPT, etc.) |
| `constants.js` | Shared constants (e.g., `REWARD_CONFIG_IDS`, configuration values) |

### `services/` — Business Logic

| File | Purpose |
|------|---------|
| `scheduled.js` | `resetDailyTables(env)` — daily cron job logic (resets streak tables, etc.) |
| `gamification.js` | XP rewards, streak tracking, achievement logic |
| `cardHelpers.js` | `updateCardSubtitleLanguageMapBatch()`, `populateMappingTableAsync()` — card data processing utilities |

### `middleware/` — Request Processing

| File | Purpose |
|------|---------|
| `auth.js` | `hashPassword()`, `verifyPassword()`, `generateJWT()`, `verifyJWT()`, `generateToken()`, `generateUserId()` — authentication and authorization utilities |

---

## CORS Handling

### Before (scattered)

Every handler individually wrapped its response:

```javascript
return withCors(new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' }
}));
```

### After (centralized)

CORS is handled once in the router pipeline via `itty-router`'s `cors()`:

```javascript
const { preflight, corsify } = cors({ origin: '*', ... });

const router = Router({
  before: [preflight],     // Auto-handle OPTIONS
  finally: [corsify],      // Auto-add CORS headers to all responses
});
```

Handlers now simply return plain responses:

```javascript
return json({ data: result });
```

---

## Configuration Changes

### `wrangler.toml`

```diff
- main = "src/worker.js"
+ main = "src/router.js"
```

### `package.json`

Added `itty-router` as a production dependency:

```json
{
  "dependencies": {
    "itty-router": "^5.0.23"
  },
  "devDependencies": {
    "wrangler": "^4.68.1"
  }
}
```

### `worker.js`

**Deleted.** Its responsibilities were absorbed by `router.js`:
- `fetch` handler → `router.fetch()`
- `scheduled` handler → still exported from `router.js`
- OPTIONS handling → `preflight` middleware
- 404 fallback → `router.all('*', ...)`
- Global error catch → `router.catch`

---

## Deployment

Deployment remains unchanged:

```bash
cd cloudflare-worker
npx wrangler deploy
```

Wrangler uses `esbuild` under the hood to bundle all imported modules into a single worker script. The modular file structure is purely a development-time organization — the deployed artifact is still a single bundled file.

---

## Files Changed Summary

### Deleted

| File | Reason |
|------|--------|
| `src/worker.js` | Replaced by `src/router.js` as entry point |

### Created (Phase 2 → Modified in Phase 3)

| File | Lines | Description |
|------|-------|-------------|
| `src/router.js` | 59 | Main entry point with itty-router |
| `src/handlers/auth.js` | ~378 | Authentication routes |
| `src/handlers/search.js` | ~1,902 | Search and autocomplete routes |
| `src/handlers/r2.js` | ~228 | R2 storage routes |
| `src/handlers/media.js` | ~82 | Media serving routes |
| `src/handlers/items.js` | ~740 | Item/episode CRUD routes |
| `src/handlers/cards.js` | ~1,120 | Card CRUD routes |
| `src/handlers/categories.js` | ~220 | Category CRUD routes |
| `src/handlers/import.js` | ~380 | Bulk import routes |
| `src/handlers/progress.js` | ~450 | Progress tracking routes |
| `src/handlers/cardOps.js` | ~320 | Card operation routes |
| `src/handlers/user.js` | ~680 | User profile routes |
| `src/handlers/content.js` | ~520 | Content metadata routes |
| `src/handlers/comments.js` | ~290 | Comment routes |
| `src/handlers/users.js` | ~180 | Admin user management routes |
| `src/handlers/admin.js` | ~1,293 | Admin operation routes |
| `src/utils/response.js` | 7 | JSON response helper |
| `src/utils/cors.js` | ~15 | Legacy CORS helper |
| `src/utils/db.js` | ~32 | D1 retry utility |
| `src/utils/fts.js` | ~120 | FTS query builders |
| `src/utils/japanese.js` | ~80 | Japanese text utilities |
| `src/utils/levels.js` | ~60 | Language level framework mapping |
| `src/utils/constants.js` | ~15 | Shared constants |
| `src/middleware/auth.js` | ~267 | Auth utilities |
| `src/services/scheduled.js` | ~50 | Cron job logic |
| `src/services/gamification.js` | ~350 | Gamification logic |
| `src/services/cardHelpers.js` | ~200 | Card data utilities |

### Modified

| File | Change |
|------|--------|
| `wrangler.toml` | `main` changed from `src/worker.js` to `src/router.js` |
| `package.json` | Added `itty-router: ^5.0.23` dependency |

---

## Quick Reference: Adding a New Route

To add a new endpoint to the system:

1. **Choose the appropriate handler file** in `src/handlers/` (or create a new one).

2. **Add the route** inside the `registerXxxRoutes` function:

```javascript
router.get('/api/new-endpoint/:id', async (request, env) => {
  const { id } = request.params;
  const result = await env.DB.prepare('SELECT * FROM table WHERE id = ?').bind(id).first();
  return json(result);
});
```

3. **If creating a new handler file**, register it in `router.js`:

```javascript
import { registerNewRoutes } from './handlers/new.js';
// ...
registerNewRoutes(router);
```

4. **Deploy:**

```bash
npx wrangler deploy
```

No other configuration is needed — CORS, error handling, and path parameters are handled automatically by the router pipeline.
