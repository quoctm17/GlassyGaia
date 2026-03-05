# GlassyGaia – Multilingual Subtitle Card Explorer

**What this file is for:** Introduces the GlassyGaia app, describes its features, and provides usage guidance and demos for end users. This is the main entry point to understand what the app does and how to use it.

---

## Documentation in this repo

| File | Short description | Link |
|------|-------------------|------|
| **README.md** | App overview, features, and usage guide (this file). | [README.md](./README.md) |
| **CHANGELOG.md** | Version history (Added / Changed / Fixed per release). | [CHANGELOG.md](./CHANGELOG.md) |
| **CONTRIBUTING.md** | Branch rules, Pull Request guidelines, and release process for contributors. | [CONTRIBUTING.md](./CONTRIBUTING.md) |

---

An app to search and learn words/sentences from subtitles of multimedia content (movies, series, books, audio). For users who want to search by language, view cards with images and audio, practice, and track progress.

**Try it:** [https://lingua-search.vercel.app](https://lingua-search.vercel.app)

---

## What can GlassyGaia do?

- **Search** content by primary language (Japanese, English, Korean, etc.) and filter by level (CEFR, JLPT, HSK, TOPIK…).
- **View cards** per sentence: snapshot image, audio playback, and multiple subtitle languages (Vietnamese, English, Chinese, Japanese, Korean…).
- **Save favorite cards** and revisit them in Saved (requires Google sign-in).
- **Portfolio & stats**: view streak, XP, and an overview of learned cards in the navbar.
- **Practice**: modes such as word-by-word matching to review vocabulary and grammar.

*(Screenshot: Search screen and card list — you can add images here.)*

---

## Main features

### 1. Search

- Enter keywords and choose the content’s main language.
- Results are shown as cards; the matched sentence is highlighted.
- Filter by level: CEFR (English), JLPT (Japanese), HSK (Chinese), TOPIK (Korean), etc.
- On the Search page you can also choose subtitle languages for multilingual viewing.

**Quick guide:** Go to Search → choose language → enter word/sentence → view results and click a card to hear audio and see subtitles.

*(Screenshot: search box, filters, and card list.)*

### 2. Media & Cards

- Each card has: a snapshot image, audio for that sentence, and the main sentence plus subtitles (if available).
- You can browse by content (movie/series/book) and by episode.

**Quick guide:** From Search click a card, or go to Media → pick content → pick episode → view/listen to each card.

*(Screenshot: card view with image, audio, and subtitles.)*

### 3. Portfolio & Stats

- When signed in, the navbar shows your streak (consecutive days) and total XP.
- The Portfolio page summarizes learned cards and progress over time.

**Quick guide:** Sign in with Google → see streak/XP in the navbar → open Portfolio for details.

*(Screenshot: navbar with streak/XP and Portfolio page.)*

### 4. Saved cards & Practice

- Save favorite cards to Saved for quick access.
- The Practice page offers exercises (e.g. word-by-word matching) to review words and sentences.

**Quick guide:** Save from a card → view in Saved; go to Practice to pick a practice mode.

*(Screenshot: Saved list and Practice screen.)*

### 5. Admin (Content management)

- For administrators: add/edit content (content, episodes, cards), upload images/audio, import data (CSV), manage levels, categories, reward config, etc.
- Access via the Admin area after signing in with an authorized account.

*(Screenshot: Admin screen for creating/updating content — optional.)*

---

## Sign-in & permissions

- **Regular users:** Sign in with Google to save cards, view Portfolio, and use Practice.
- **Admin:** Only accounts configured in the system can access the Admin area.

---

## UI

- Dark theme with readable typography.
- Navbar with GlassyGaia logo, stats (streak/XP), language and theme switchers.
- Responsive layout for desktop, tablet, and mobile.

---

## Roadmap

- Playlists / Collections, Study history
- Export to Anki / CSV
- Learning progress analytics
- Fuzzy search, accent-insensitive
- UI internationalization (i18n)

---

## License

Internal MVP for client demo (update as needed).
