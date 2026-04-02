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

---

## [v1.6.0] - 2026-04-02

### Changed
- SubtitleLanguageSelector dropdown: full restyle with new layout (search bar → selection count → options list → footer), Done button with blur pink background + check icon, Clear button as plain text, flag images with no border-radius, reduced dropdown width to 260px, removed browser default focus tint on search input, reduced toggle offset spacing.
- Subtitle dropdown: added dedicated CSS variables (`--lang-dropdown-*`) and typography classes for consistent theming.
- ContentSelector search input styling matched across components.

### Fixed
- Search bar: ensure icon click targets are not obscured on smaller screens.
- SearchResultCard: improved layout and sizing consistency.

---

## [Unreleased]

### Fixed
- Admin Level Management: fix Single Card Assessment debug dropdowns (searchable Content/Episode/Card) and ensure debug assessment resolves card UUID correctly.
- Worker level assessment: align tokenization with stopword/noise filtering and OOV rank handling to prevent under-estimating difficulty.

---

## [v1.5.0] - 2026-03-18

### Added
- `level_frequency_ranks` column on cards, episodes, and content items — stores computed frequency rank per framework/language from the level assessment formula.
- Frequency rank badge displayed on `SearchResultCard` level badge (shows rounded `overallFreqRank` value).
- `aggregateFrequencyRanks` utility in worker to average frequency ranks when rolling up from cards → episodes → content items.
- Admin page to list and manage unavailable cards (`AdminUnavailableCardsPage`): view cards with unavailable flag, zero length, or invalid data, and mark them as available.
- Admin sidebar reorganized into sections (Content Management, Migration, System) with section headers.
- Select All / Deselect All buttons in the level assessment content dropdown.
- Back-to-top button on the Search page.
- Search bar loader spin animation.

### Changed
- CJK subtitle font sizes increased from 14 → 20 px (Chinese SC, Chinese TC, Japanese) for better readability.
- Ruby annotation font size increased from 0.5 em → 0.8 em.
- Search page grid `grid-auto-rows` changed to `1fr` for uniform card heights.
- Autocomplete endpoint no longer hardcodes `main_language = 'en'` — supports all languages.
- Populate search words endpoint no longer filters by `main_language = 'en'`.
- Worker batch inserts for search words use `DB.batch()` with 90-row batches (was single large INSERT with 100-row batches) to stay within D1 parameter limits.
- FTS insert statements removed from import handler (FTS5 table was already dropped).
- Admin CSV preview panel tooltips and legend labels switched from Vietnamese to English.

### Fixed
- Card save status now persists across page refresh and new searches (stored in sessionStorage, merged with API response instead of cleared).
- Save card API retries with exponential backoff on DB overload (500 errors) instead of failing immediately.
- SRS dropdown button no longer shows box-shadow or zoom effect on hover.
- TypeScript build errors in `AdminUnavailableCardsPage`: `is_available` compared as boolean (not number), `film_id` fallback to empty string.
- TypeScript strict errors in `AdminLevelManagementPage`: replaced `error: any` with `error: unknown`, removed `as any` casts in favor of proper types.
- Removed stray `console.log` for content_meta titles in SearchPage browse mode.

---

## [v1.4.0] - 2026-03-13

### Added
- Inline **Speaking** practice mode on the Search page: click Speak → Web Speech API records user voice → transcript compared against primary subtitle → percentage score + XP awarded.
- Inline **Reading** practice mode: subtitles hidden by default, Show/Hide toggle reveals them and awards XP (limited to 1 XP per card per day via `xp_transactions` deduplication to prevent spam).
- Inline **Writing** practice mode: all words from the primary subtitle shown as draggable tiles in shuffled order; user drags to correct position then clicks Check → correct/incorrect tile colors + full correct sentence + score + XP.
- Inline **Listening** practice mode (from previous sprint): blank fill-in-the-gap directly in `SearchResultCard` with Check button, percentage score, and XP + diamond display.
- New Cloudflare D1 reward config entries for `speaking_attempt` (ID 6), `writing_attempt` (ID 7), `listening_attempt` (ID 8), `reading_attempt` (ID 9) wired into `trackAttempt`.
- NavBar now listens for `xp-awarded` custom events to refresh portfolio XP in real time after any practice attempt.
- Improved episode navigation and keyboard shortcuts (A/D/C/S/Shift/Enter) in `SearchResultCard` for smoother review on the Search page.

### Changed
- Writing practice tiles use the same correct/incorrect color system (`--practice-blank-input-correct-*` / `--practice-blank-input-incorrect-*`) as Listening blanks for visual consistency.
- Writing footer after Check shows the full correct sentence alongside score and XP (matching Listening UX).
- Listening blank inputs now always display the full typed text: `min-width: 6ch`, dynamic width grows with content.
- Search result card layout so preview images always fill the left column width responsively, and bottom controls stay on a single row.
- Search page grid margins for viewports ≤1300px to keep results closer to the left while preserving the existing percentage offsets.
- Content selector and `/items` backend so only content with available cards (count > 0) is shown, ordered by card count and title.
- Search feedback like/dislike state now resets whenever a new search is performed.
- Added `--practice-writing-bg` and `--practice-writing-border` CSS variables to the theme system (light/dark).

### Fixed
- Dropdown menu z-index: `.card-bottom-section` overflow changed to `visible` so the SRS dropdown renders above the card.
- ESLint errors in `SearchResultCard.tsx`: replaced `any` types with proper interfaces (`SpeechRecognitionCtor`, `audioPlayHandlerRef` WeakMap pattern, `| null` union on `shortcutHandlersRef`), removed unnecessary regex escape `\[`.
- Writing practice tiles now appear immediately when Writing mode is selected (fixed effect ordering bug where reset effect was clearing words after init effect).

### Removed
- Legacy Practice flow (separate Practice page, modal, and dedicated `PracticeListening`, `PracticeReading`, `PracticeSpeaking`, `PracticeWriting` components and their CSS) in favour of the new inline practice experience on the Search page.

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
