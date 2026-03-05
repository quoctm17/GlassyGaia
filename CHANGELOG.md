# Changelog

**What this file is for:** Records the project’s change history by release. Each release section lists **Added** / **Changed** / **Fixed** so readers (clients, PMs, users) can see what changed without reading git log. When preparing a production deploy, update this file then create a tag and GitHub Release (steps below).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Versioning rules (for devs)

- **SemVer:** `MAJOR.MINOR.PATCH` (e.g. `1.2.0`).
  - **MAJOR:** Breaking changes (API, behaviour, or config that require migration or coordination).
  - **MINOR:** New features or notable improvements, backward compatible.
  - **PATCH:** Bug fixes and small changes, backward compatible.
- **When to release:** Merge to `main` auto-deploys (e.g. Vercel). Create a **version tag and GitHub Release** when you want to mark a milestone (e.g. end of sprint, handover to client). You don’t have to tag every merge.
- **How to create a Release:**
  1. Update this file: move items from `[Unreleased]` into a new section `## [vX.Y.Z] - YYYY-MM-DD` (use today or the merge date).
  2. Commit and push to `main`.
  3. Create and push the tag:  
     `git tag vX.Y.Z`  
     `git push origin vX.Y.Z`
  4. On GitHub: **Releases** → **Draft a new release** → choose tag `vX.Y.Z`, paste the release notes from this changelog, publish.

---

## [Unreleased]

*(Nothing yet.)*

---

## [v1.3.0] - 2026-03-05

### Added
- Refresh search navbar and search page UI/UX, including new logo, icons, and inline search statistics.
- Cursor rule for push-to-GitHub workflow (CONTRIBUTING, README, CHANGELOG). Docs: CONTRIBUTING.md, README (EN), CHANGELOG backfill and versioning rules.

### Changed
- Improve layout of search stats area and subtitle language selector on the search page.

---

## [v1.2.0] - 2026-02-26

### Changed
- Refactor Cloudflare worker routing to use `itty-router` and clean up search/autocomplete endpoints. (PR #90)

---

## [v1.1.0] - 2026-02-09

### Changed
- Optimize direct DB operations and autocomplete in Cloudflare worker. (PR #88, #89)
- Search and worker updates (SearchPage logic, worker fixes).

---

## [v1.0.0] - 2026-01-28

### Added
- Practice: word-by-word matching with color feedback. (PR #87)
- Practice components: writing/listening logic, speech-to-text, autocomplete search with `search_terms` table, strict inverted-index search. (PR #83–86)
- TOPIK support for Korean and explicit English→CEFR mapping in level framework.
- JWT-based role authorization and listening session tracking.
- Admin reward config page; metrics dropdown; XP and cover metadata fixes.
- Portfolio: save modal with backend filter, multi-select unsave, language filter; table UI improvements; AVIF image conversion (replacing WebP).

### Changed
- Remove FTS5; improve secrets management; integrate Cloudflare API for DB size. (PR #86)
- Portfolio and practice page improvements across multiple merges. (PR #72–82)

### Fixed
- TypeScript build errors; duplicate framework variable in `compareLevels`; description null handling in AdminRewardConfigPage; XP tracking and Worker config sync.

---

## [v0.9.0] - 2026-01-05

### Added
- Categories loaded from database instead of hardcoded; displayed in content views. (PR #70, #71)
- Meilisearch integration and Google Auth improvements. (PR #70)

### Fixed
- TypeScript build errors in Google Auth.

---

## [v0.8.0] - 2025-12-29

### Added
- IMDB Score and Categories features. (PR #69)
- Support for 9 new languages (kk, sk, uz, be, bs, mr, mn, et, hy). (PR #67)
- Difficulty sorting and content distribution; filter unavailable/empty subtitle cards at API level. (PR #63–66)
- Subtitle typography updated to Noto Sans fonts. (PR #61–69)

### Changed
- WatchPage styling and performance; level badge display.

### Fixed
- SavedCardsPage bug; various small fixes.

---

## [v0.7.0] - 2025-12-23

### Added
- Mobile UI improvements and audio volume system fix. (PR #60)
- Admin: image placeholders and navigation improvements. (PR #59)
- Admin UI improvements (video_has_images, style tweaks). (PR #52–58)
- Search filters and UI: Urdu, Albanian, Lithuanian; main language filtering; CJK text rendering. (PR #45–52)

### Changed
- Search performance and filter logic.

---

## [v0.6.0] - 2025-12-21

### Added
- Admin migration tools and related fixes. (PR #34–44)
- Japanese search, watch UI, and theme system improvements. (PR #30, #31)

*Earlier history is summarized above; for full commit history see git log.*
