# GlassyGaia Worker (Cloudflare)

This folder contains a ready-to-deploy Worker implementing the endpoints used by the frontend.

## Endpoints
- `POST /r2/sign-upload` → returns a URL that the frontend PUTs the file to
- `PUT /r2/upload` → uploads bytes into R2 (binding `MEDIA_BUCKET`)
- `GET /films`, `GET /films/:id`
- `GET /films/:id/episodes/:eid/cards`
- `GET /cards`
- `GET /cards/:film/:episode/:card`
- `POST /import` → bulk insert film + cards + subtitles

CORS is enabled for local dev (`Access-Control-Allow-Origin: *`).

## Setup

1.  **Update `wrangler.toml`:**
    -   Ensure the `database_id` for your D1 database is correct. You can find this in the Cloudflare Dashboard → D1 → your DB → Overview → IDs.
    -   Confirm `bucket_name` matches your R2 bucket (`glassygaia-media`).
2.  **Install Wrangler (if needed):**
    ```powershell
    npm i -g wrangler
    ```
3.  **Login and Deploy Worker:**
    ```powershell
    wrangler login
    # Navigate to this folder
    cd cloudflare-worker
    # Deploy the worker code
    wrangler deploy
    ```
    This will create/update the worker and bind the D1/R2 resources as configured. The database schema is managed separately (see below).

## Database Migrations (D1)

Schema is managed via files in `migrations/`. Current baseline: `001_init.sql`.

**IMPORTANT: Local vs. Remote Database**

-   By default, Wrangler D1 commands run on a **local** database emulator on your computer. This is for safe development and testing.
-   To affect the **real, live database on Cloudflare**, you **MUST** add the `--remote` flag to your commands.

### Workflow: How to Apply Changes

1.  **For Local Development & Testing:**
    -   Run `wrangler dev` to start a local server.
    -   Apply migrations to the local database:
        ```powershell
        # Applies migrations to the local DB emulator
        wrangler d1 migrations apply glassygaia-db
        ```
2.  **For Production (The Real Database on Cloudflare):**
    -   **Step 1: Create a new migration file** (see section below).
    -   **Step 2: Apply the migration to the remote database.**
        ```powershell
        # Applies migrations to the LIVE Cloudflare database
        wrangler d1 migrations apply glassygaia-db --remote
        ```

### Creating a New Migration

Add a sequential file (do not skip numbers), e.g., `migrations/002_add_indexes.sql`:
```sql
-- Example safe additive migration
ALTER TABLE cards ADD COLUMN difficulty INTEGER;
CREATE INDEX IF NOT EXISTS idx_cards_difficulty ON cards(difficulty);
```
Then, apply it to the remote database:
```powershell
wrangler d1 migrations apply glassygaia-db --remote
```

### Safe Migration Guidelines

-   **Prefer additive changes:** `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`.
-   **Avoid destructive ops** (`DROP TABLE`, `DROP COLUMN`) in production. If required, back up first.
-   **Backup before any risky change:**
    ```powershell
    # Dumps the entire remote database to a local file
    wrangler d1 execute glassygaia-db --remote --command ".dump" > backup.sql
    ```
    This writes a SQLite dump you can restore from.
-   **Test migrations locally first**, then apply to production with `--remote`.

### Verifying Schema

You can inspect the schema of either the local or remote database.

-   **Verify remote (live) schema:**
    ```powershell
    wrangler d1 execute glassygaia-db --remote --command "SELECT name, sql FROM sqlite_master WHERE type='table';"
    ```
-   **Verify local schema:**
    ```powershell
    wrangler d1 execute glassygaia-db --command "SELECT name, sql FROM sqlite_master WHERE type='table';"
    ```

### Rolling Back (Manual)

D1 has no automatic rollback. Options:
1.  Re-deploy a worker compatible with the previous schema.
2.  Restore from a backup: create a new D1 DB → import the dump → point `wrangler.toml` to it and re-deploy.

## R2 Media Layout
Objects are stored at:
```
{filmId}/{episodeFolder}/{type}/{filmId_normalized}_{cardId}.ext
```
Where:
- `episodeFolder` is zero‑padded (001, 002, ...).
- `filmId_normalized` replaces dashes with underscores.
- `type` is `image` or `audio`.
- `cardId` is zero‑padded to the configured digits (default 3).

## Import Endpoint Field Support
`POST /import` accepts cards with optional fields: `sentence`, `card_type` (or `type`), `cefr_level`, plus a `subtitle` map of language → text.

## Hardening Recommendations
-   Add origin checks and a bearer token/HMAC signature for import & upload routes.
-   Limit file size (check `Content-Length` before reading body).
-   Rate-limit with Durable Objects or KV if necessary.
-   Add request logging with correlation IDs.

## Notes
-   The `import` endpoint assumes the SQL schema has been successfully migrated on the D1 database.
-   Media keys saved for cards will strip the domain, storing relative keys suitable for an R2 public base URL.
-   For production, restrict upload access: add a secret/token check in `/r2/sign-upload` and `/r2/upload`.