# Migration 004: Remove Episode Landscape Cover Support

## Summary
Successfully removed `cover_landscape_key` column from the `episodes` table and removed all related code from the application. Episodes now only support portrait covers (`cover_key`), while content items retain both portrait and landscape cover support.

## Database Changes

### Migration File
- **File**: `cloudflare-worker/migrations/004_drop_episode_landscape_cover.sql`
- **Applied**: ✅ Successfully executed on remote D1 database `glassygaia-db`
- **Execution**: 6 queries, 2280302 rows read, 691325 rows written, 23.4s

### Schema Changes
Removed from `episodes` table:
- `cover_landscape_key TEXT` column

Retained in `episodes` table:
- `cover_key TEXT` (portrait cover)
- `full_audio_key TEXT`
- `full_video_key TEXT`

## Code Changes

### Backend (Worker)
**File**: `cloudflare-worker/src/worker.js`

Removed `cover_landscape_key` handling from:
1. ✅ Item detail endpoint (GET `/items/:slug`) - SELECT query
2. ✅ Episodes list endpoint (GET `/items/:slug/episodes`)
3. ✅ Episode meta endpoints (GET/PATCH `/items/:slug/episodes/:episode`)
4. ✅ Delete item endpoint (DELETE `/items/:slug`) - media collection
5. ✅ Delete episode endpoint (DELETE `/items/:slug/episodes/:episode`) - media collection

### Frontend API Layer
**File**: `src/services/cfApi.ts`

Removed from `apiUpdateEpisodeMeta` parameters:
- ✅ `cover_landscape_url?: string`
- ✅ `cover_landscape_key?: string`

### TypeScript Types
**File**: `src/types/index.ts`

Removed from `EpisodeDetailDoc` interface:
- ✅ `cover_landscape_url?: string | null`

### Admin Pages

#### AdminContentIngestPage.tsx
Removed:
- ✅ State: `addEpCoverLandscape`, `epCoverLandscapeDone`, `hasEpCoverLandscapeFile`
- ✅ Function: `doUploadEpisodeCoverLandscape()`
- ✅ UI: Episode landscape cover checkbox and file input
- ✅ Progress tracking: "7. Episode Cover Landscape" item
- ✅ API calls with `cover_landscape_key` and `cover_landscape_url`

**Preserved**: Content-level landscape cover support (`addCoverLandscape`, `coverLandscapeDone`)

#### AdminAddEpisodePage.tsx
Removed:
- ✅ State: `addEpCoverLandscape`, `epCoverLandscapeDone`, `hasEpCoverLandscapeFile`
- ✅ Upload logic in `doUploadEpisodeCover()` function
- ✅ UI: Episode landscape cover checkbox and file input
- ✅ Progress tracking in useEffect and progress bar
- ✅ API calls with `cover_landscape_key`

#### AdminEpisodeUpdatePage.tsx
Removed:
- ✅ State: `coverLandscapeFile`, `uploadingCoverLandscape`, `epCoverLandscapeDone`
- ✅ Upload logic in `handleSave()` and `handleReimportEpisodeMedia()`
- ✅ UI: Cover Landscape section with file input and display
- ✅ Progress tracking: "6. Episode Cover Landscape" item
- ✅ API calls with `cover_landscape_key` and `cover_landscape_url`

#### AdminEpisodeDetailPage.tsx
Removed:
- ✅ `coverLandscapeDisplayUrl` useMemo hook
- ✅ Landscape cover display UI (grid layout reverted to single cover)
- ✅ References to `ep.cover_landscape_url`

## Verification

### Database Schema
```sql
PRAGMA table_info(episodes);
```
✅ Confirmed: `cover_landscape_key` column successfully removed
✅ Confirmed: 13 columns remain (no landscape cover field)

### Build Status
```bash
npm run build
```
✅ No TypeScript errors
✅ No compilation warnings (except standard chunk size warning)

### Remaining Support
✅ Content items (`content_items` table) retain both:
   - `cover_key` (portrait)
   - `cover_landscape_key` (landscape)

✅ Episodes (`episodes` table) now only have:
   - `cover_key` (portrait)
   - `full_audio_key`
   - `full_video_key`

## Impact
- **Breaking Change**: Any existing episode landscape covers in R2 storage are no longer referenced by the database
- **UI Impact**: Admin users can no longer upload landscape covers for episodes (only for content items)
- **Data Preserved**: Episode portrait covers, full audio/video remain fully functional
- **Content Items**: Landscape cover support unchanged for films/series/books at the content level

## Migration Date
November 26, 2025

## Database
- **Name**: glassygaia-db
- **ID**: a60ee761-1d16-4dff-9ba0-fa7abdd11320
- **Database Size After Migration**: 209.38 MB
