# Admin Migration Tools Guide

This guide covers the four migration tools available in the GlassyGaia admin panel for managing media files and database paths.

## Overview

All migration tools are located under `/admin/*-migration` and `/admin/media-cleanup` routes in the admin panel. They help maintain consistency between R2 storage files and D1 database records.

---

## 1. Path Migration (`/admin/path-migration`)

### Purpose
Bulk update all database paths from legacy `.jpg`/`.mp3` extensions to modern `.webp`/`.opus` extensions.

### When to Use
- After converting media files to new formats but before updating database records
- When you need to fix database paths that don't match actual file extensions in R2 storage
- **Use this BEFORE running Image Migration** to ensure database consistency

### How It Works
Updates the following database columns:
- `content_items.cover_key`: .jpg → .webp
- `content_items.cover_landscape_key`: .jpg → .webp
- `episodes.cover_key`: .jpg → .webp
- `cards.image_key`: .jpg → .webp
- `cards.audio_key`: .mp3 → .opus

### Usage Steps

1. **Preview Mode (Recommended First)**
   - Check "Preview Mode (Dry Run)" checkbox
   - Click "Preview Changes"
   - Review statistics showing how many paths would be updated
   - No actual changes are made in this mode

2. **Live Migration**
   - Uncheck "Preview Mode (Dry Run)"
   - Click "Run Migration"
   - Confirm the warning prompt
   - Monitor progress in the logs panel

3. **Review Results**
   - Check statistics panel for update counts
   - Review logs for any warnings or errors
   - Verify total paths updated matches expectations

### Important Notes
- ⚠️ This updates DATABASE ONLY, not files in R2 storage
- ✅ Transaction-safe with automatic rollback on errors
- ✅ Idempotent - can run multiple times safely
- ✅ Paths already using .webp/.opus won't be changed

### Example Workflow
```
1. Upload .webp and .opus files to R2 (files exist)
2. Run Path Migration to update database paths (DB updated)
3. Now database and R2 are in sync!
```

---

## 2. Image Migration (`/admin/image-migration`)

### Purpose
Convert JPG/JPEG images in R2 storage to WebP format and update corresponding database paths.

### When to Use
- Converting legacy JPG images to WebP for better performance
- After running Path Migration to update remaining unconverted files
- Batch converting all images in a specific content folder

### Features
- **Folder Browser**: Select specific content folders or scan entire `items/` directory
- **Parallel Processing**: Configurable concurrency (1-100 files at a time)
- **Quality Control**: Adjustable WebP quality (50-100%)
- **Database Updates**: Automatically updates image_key, cover_key paths
- **Optional Cleanup**: Delete original JPG files after conversion

### Usage Steps

1. **Scan for Images**
   - Enter scan folder path (e.g., `items/` or `items/my-content/`)
   - Or click "Browse" to visually select a folder
   - Click "Scan for Images"
   - Review found images count and breakdown

2. **Configure Settings**
   - Set "Parallel Processing" (recommended: 50-100 for speed)
   - Set "WebP Quality" (recommended: 80-90)
   - Enable "Preview Mode (Dry Run)" for testing
   - Optional: Enable "Delete original JPG files after conversion"
   - Optional: Enable "Skip Database Update" for faster processing

3. **Run Migration**
   - Click "Start Preview" (dry run) or "Start Migration" (live)
   - Monitor progress bar and logs
   - Stop anytime with "Stop" button if needed

4. **Review Results**
   - Check statistics: Total, Processed, Converted, Failed
   - Review logs for detailed per-file results
   - Verify file size savings percentages

### Configuration Options

| Option | Default | Recommended | Description |
|--------|---------|-------------|-------------|
| Parallel Processing | 50 | 50-100 | Higher = faster but more CPU/network |
| WebP Quality | 85 | 80-90 | Higher = better quality, larger files |
| Dry Run | ON | Test first | Preview changes without making them |
| Delete Originals | OFF | Use carefully | Removes JPG files after conversion |
| Skip DB Update | OFF | Leave OFF | Only for file-only migrations |

### Path Structure Support
Handles multiple path patterns:
- **New structure**: `items/{slug}/episodes/{slug}_{episode}/image/{slug}_{episode}_{cardId}.jpg`
- **Content covers**: `items/{slug}/cover_image/cover.jpg`
- **Episode covers**: `items/{slug}/episodes/{slug}_{episode}/cover/cover.jpg`
- **Legacy structure**: `items/{slug}/episodes/{folder}/cards/{number}_image.jpg`

### Database Updates
Automatically updates:
- `content_items.cover_key` and `cover_landscape_key`
- `episodes.cover_key`
- `cards.image_key`

### Important Notes
- ⚠️ Always run with Dry Run first to preview changes
- ⚠️ Ensure sufficient R2 storage before running
- ✅ Browser-based conversion (no server processing needed)
- ✅ Automatic database path updates
- ✅ Transaction-safe with rollback on errors

---

## 3. Audio Migration (`/admin/audio-migration`)

### Purpose
Convert MP3 audio files in R2 storage to Opus format and update corresponding database paths.

### When to Use
- Converting legacy MP3 audio to Opus for better compression
- After running Path Migration to update remaining unconverted audio files
- Batch converting all audio in a specific content folder

### Features
- **Folder Browser**: Select specific content folders
- **Parallel Processing**: Configurable concurrency
- **Bitrate Control**: Adjustable Opus bitrate (32-128 kbps)
- **Database Updates**: Automatically updates audio_key paths
- **Optional Cleanup**: Delete original MP3 files after conversion

### Usage Steps

1. **Scan for Audio**
   - Enter scan folder path or browse to select
   - Click "Scan for Audio Files"
   - Review found MP3 files count

2. **Configure Settings**
   - Set "Parallel Processing" (recommended: 20-50)
   - Set "Opus Bitrate" (recommended: 64 kbps for speech)
   - Enable "Preview Mode (Dry Run)" for testing
   - Optional: Enable "Delete original MP3 files"

3. **Run Migration**
   - Click "Start Preview" or "Start Migration"
   - Monitor progress and logs
   - Review file size savings

### Configuration Options

| Option | Default | Recommended | Description |
|--------|---------|-------------|-------------|
| Parallel Processing | 20 | 20-50 | Audio encoding is CPU-intensive |
| Opus Bitrate | 64 kbps | 48-64 kbps | Lower for speech, higher for music |
| Dry Run | ON | Test first | Preview changes |
| Delete Originals | OFF | Use carefully | Removes MP3 files |

### Audio Quality Guidelines
- **Speech/Dialogue**: 32-48 kbps (excellent quality, great savings)
- **Balanced**: 64 kbps (default, good for most content)
- **High Quality**: 96-128 kbps (for music or high-fidelity needs)

### Database Updates
Automatically updates:
- `cards.audio_key`

### Important Notes
- ⚠️ Audio conversion is CPU-intensive (use lower concurrency than images)
- ⚠️ Opus files are typically 40-60% smaller than MP3
- ✅ Browser-based conversion using Web Audio API
- ✅ Supports all MP3 files in card audio paths

---

## 4. Media Cleanup (`/admin/media-cleanup`)

### Purpose
Find and remove orphaned media files in R2 storage that have no corresponding database records.

### When to Use
- After deleting content/episodes/cards from database
- Cleaning up failed uploads or test files
- Reclaiming R2 storage space
- Auditing storage vs database consistency

### Features
- **Smart Detection**: Identifies orphaned files by checking database
- **Safe Scanning**: Read-only scan mode to preview cleanup
- **Batch Deletion**: Remove multiple orphaned files at once
- **Storage Stats**: Shows total size of orphaned files
- **Detailed Logs**: Per-file deletion results

### Usage Steps

1. **Scan for Orphans**
   - Enter folder to scan (e.g., `items/`)
   - Click "Scan for Orphaned Files"
   - Review list of files without database records
   - Check total storage used by orphans

2. **Review Orphaned Files**
   - Expand file list to see details
   - Verify these are truly orphaned (not recent uploads)
   - Note total count and storage size

3. **Delete Orphans**
   - Enable "Dry Run" to preview deletion
   - Click "Delete Orphaned Files"
   - Confirm deletion in prompt
   - Monitor deletion progress and logs

4. **Verify Cleanup**
   - Check statistics for deleted count
   - Review logs for any errors
   - Re-scan to verify all orphans removed

### What Gets Cleaned

Detects orphans in these paths:
- Content covers: `items/{slug}/cover_image/`
- Episode covers: `items/{slug}/episodes/{folder}/cover/`
- Card images: `items/{slug}/episodes/{folder}/image/`
- Card audio: `items/{slug}/episodes/{folder}/audio/`

### Safety Features
- ✅ Only deletes files not referenced in database
- ✅ Dry run mode to preview before deletion
- ✅ Confirmation prompt before live deletion
- ✅ Detailed logging of all deletions
- ✅ Checks content_items, episodes, and cards tables

### Important Notes
- ⚠️ Always run Scan first to see what will be deleted
- ⚠️ Recent uploads may not be in database yet (wait a few minutes)
- ⚠️ Deletion is permanent and cannot be undone
- ✅ Safe to run multiple times
- ✅ Does not affect database records

---

## Recommended Migration Workflow

### Full Migration from JPG/MP3 to WebP/Opus

1. **Preparation**
   ```
   ✓ Backup database and R2 storage
   ✓ Ensure sufficient R2 storage space
   ✓ Plan migration during low-traffic period
   ```

2. **Step 1: Path Migration (Database)**
   ```
   → /admin/path-migration
   ✓ Run in Dry Run mode first
   ✓ Review statistics
   ✓ Run live migration to update all DB paths
   ✓ Verify: Database now expects .webp/.opus files
   ```

3. **Step 2: Image Migration (Files)**
   ```
   → /admin/image-migration
   ✓ Scan for JPG images
   ✓ Test with Dry Run on small folder
   ✓ Run live migration with quality 85%
   ✓ Keep "Delete originals" OFF initially
   ✓ Verify converted images display correctly
   ```

4. **Step 3: Audio Migration (Files)**
   ```
   → /admin/audio-migration
   ✓ Scan for MP3 files
   ✓ Test with Dry Run
   ✓ Run live migration with 64 kbps
   ✓ Keep "Delete originals" OFF initially
   ✓ Test audio playback
   ```

5. **Step 4: Cleanup (Optional)**
   ```
   → /admin/image-migration (Delete originals: ON)
   → /admin/audio-migration (Delete originals: ON)
   → /admin/media-cleanup (Remove orphaned JPG/MP3)
   ✓ Scan for orphaned files
   ✓ Review and delete orphans
   ✓ Reclaim storage space
   ```

### Quick Reference: Which Tool When?

| Scenario | Tool | Action |
|----------|------|--------|
| Database paths are .jpg but files are .webp | Path Migration | Update DB paths |
| Have JPG files, want WebP | Image Migration | Convert + Update DB |
| Have MP3 files, want Opus | Audio Migration | Convert + Update DB |
| Deleted content but files remain | Media Cleanup | Remove orphans |
| Mixed extensions in database | Path Migration first | Standardize paths |
| Want to test migration | All tools | Use Dry Run mode |

---

## Troubleshooting

### "Could not parse card image path"
- **Issue**: Regex pattern doesn't match file path structure
- **Fix**: Ensure path follows format: `items/{slug}/episodes/{slug}_{episode}/image/{filename}_{cardId}.ext`
- **Fixed in**: Latest version supports complex slugs with underscores

### "No such column: cover_landscape_key"
- **Issue**: Database schema missing column
- **Fix**: Run migrations to ensure schema is up to date
- **Note**: `episodes.cover_landscape_key` was removed in migration 015

### "Database update failed"
- **Issue**: Worker endpoint error or schema mismatch
- **Check**: Browser console for detailed error message
- **Verify**: Worker is deployed and database is accessible

### "Files converted but database not updated"
- **Issue**: Skip DB Update was enabled
- **Fix**: Re-run migration without Skip DB Update
- **Or**: Use Path Migration to bulk update paths

### Migration is very slow
- **Image Migration**: Increase Parallel Processing to 80-100
- **Audio Migration**: Keep at 20-50 (CPU-intensive)
- **Large batches**: Consider migrating folder-by-folder

### Orphaned files keep appearing
- **Check**: Recent uploads may not be in database yet
- **Wait**: Give imports 5-10 minutes to complete
- **Verify**: Database records exist for content/episodes/cards

---

## Performance Tips

### Image Migration
- **Fastest**: Parallel 100, Quality 80, Skip DB Update
- **Balanced**: Parallel 50, Quality 85, Enable DB Update
- **Safest**: Parallel 20, Quality 90, Dry Run first

### Audio Migration
- **Fastest**: Parallel 50, 48 kbps (speech only)
- **Balanced**: Parallel 30, 64 kbps
- **Best Quality**: Parallel 20, 96 kbps

### General Tips
- Use folder browser to migrate content-by-content
- Run during off-peak hours for large migrations
- Monitor browser memory usage (close other tabs)
- Check logs every 100 files for errors
- Keep Dry Run ON for first test on each folder

---

## Security & Access

All migration tools require:
- ✅ Admin authentication
- ✅ Valid session token
- ✅ Admin role in user profile

Database operations use:
- ✅ Transaction-safe updates with rollback
- ✅ Prepared statements (SQL injection safe)
- ✅ Validation of slugs, episode numbers, card IDs

R2 operations use:
- ✅ Signed URLs with expiration
- ✅ Content-type validation
- ✅ Path sanitization

---

## FAQ

**Q: Can I run migrations in parallel?**
A: No, run one migration tool at a time to avoid conflicts.

**Q: What happens if browser crashes during migration?**
A: Files already uploaded remain. Database updates are transaction-safe. Re-run migration to complete.

**Q: Can I undo a migration?**
A: Database changes can be rolled back manually. File deletions are permanent. Always test with Dry Run first.

**Q: How long does migration take?**
A: Depends on file count and size. Estimate: ~10-20 images/sec, ~5-10 audio files/sec with default settings.

**Q: Will users see broken images during migration?**
A: If you run Path Migration first, yes temporarily. Run Image Migration immediately after to convert files.

**Q: Should I delete original files?**
A: Only after verifying converted files work correctly. Keep originals initially as backup.

**Q: What's the difference between Path Migration and Image Migration?**
A: Path Migration updates database only. Image Migration converts actual files AND updates database.

---

## Support

For issues or questions:
1. Check browser console for detailed error messages
2. Review migration logs panel for warnings
3. Verify database schema is up to date with migrations
4. Check Worker deployment status and logs
5. Ensure R2 storage has sufficient space

---

*Last updated: December 9, 2025*
