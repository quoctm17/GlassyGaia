# GlassyGaia – Multilingual Subtitle Card Explorer

Ứng dụng tra cứu và học từ/câu dựa trên phụ đề nội dung đa phương tiện (Movie/Series/Book/Audio). Tìm kiếm theo ngôn ngữ chính của nội dung, xem snapshot, nghe audio, hiển thị nhiều phụ đề phụ, đánh dấu yêu thích, và có khu vực Admin để ingest nội dung + media nhanh chóng.

- Live (Vercel): https://lingua-search.vercel.app
- Hạ tầng: Cloudflare Worker + D1 (DB) + R2 (media) & Firebase Auth

## ✨ Tính năng

- Search theo ngôn ngữ chính (per content primary language) với highlight kết quả
- Subtitles phụ: en, vi, zh, zh_trad, yue, ja, ko, id, th, ms (thứ tự ổn định; yue = Cantonese)
- Snapshot image + audio cho mỗi card
- Favorites (yêu cầu đăng nhập Google)
- Admin ingest/update với toast feedback:
  - Upload cover, images, audio theo đúng cấu trúc R2 (items/<slug>/...)
  - Import CSV để tạo content metadata + cards
  - Tự đồng bộ ID giữa Media & Cards thông qua Infer IDs
  - Cho phép cập nhật meta (title, description, type, release_year, total_episodes, full_audio_url, full_video_url)
- Dark UI (TailwindCSS), flag-icons và lucide-react icons

## 🧱 Tech Stack

- React 19 + React Router
- Vite 7 + TypeScript 5
- TailwindCSS 3
- Cloudflare Worker (API) + D1 (SQL) + R2 (object storage)
- Firebase Auth (Google Sign-In)
- Libraries: papaparse (CSV), react-hot-toast, lucide-react, uuid, flag-icons

## 📦 Data Model (Cloudflare D1)

Nền tảng nội dung tổng quát hóa (movie, series, book, audio):

```sql
CREATE TABLE content_items (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  main_language TEXT NOT NULL,
  type TEXT NOT NULL,          -- 'movie' | 'series' | 'book' | 'audio'
  description TEXT,
  cover_key TEXT,
  full_audio_key TEXT,
  full_video_key TEXT,
  release_year INTEGER,
  total_episodes INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE episodes (
  id TEXT PRIMARY KEY NOT NULL,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  slug TEXT,
  title TEXT,
  full_audio_key TEXT,
  full_video_key TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  image_key TEXT,
  audio_key TEXT,
  difficulty_score REAL,  -- 0–100
  sentence TEXT,
  card_type TEXT,
  length INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE card_subtitles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(card_id, language)
);

CREATE TABLE card_difficulty_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  framework TEXT NOT NULL,  -- 'CEFR', 'JLPT', 'HSK', ...
  level TEXT NOT NULL,      -- 'A2', 'N5', 'HSK 3', ...
  language TEXT,            -- optional
  UNIQUE(card_id, framework, language)
);
```

## 🗂 R2 Storage Layout

```
items/{slug}/cover_image/cover.jpg
items/{slug}/episodes/{slug}_{N}/image/{slug_normalized}_{cardId}.jpg
items/{slug}/episodes/{slug}_{N}/audio/{slug_normalized}_{cardId}.mp3
```

`slug_normalized`: slug thay dấu gạch ngang bằng gạch dưới.  
`cardId`: số zero-padded (000, 001, …) hoặc lấy từ tên file khi bật Infer IDs.

## 🔢 Quy tắc ID Media & Cards

- Infer IDs = ON:
  - Lấy số cuối trong tên file media (image_007.jpg → 007) và dùng chung cho cả Media & Cards
  - Pad nếu số ngắn hơn `Pad Digits` (ví dụ 7 → 007 khi padDigits=3)
  - Start Index và Pad Digits inputs sẽ bị disable trong UI
- Infer IDs = OFF:
  - Dùng Start Index (mặc định 0) + tăng dần cho cả Media & Cards
  - `Pad Digits` xác định độ dài hiển thị (001, 002, …)
- Cover luôn tại: `items/{filmId}/cover_image/cover.jpg`

## 📑 CSV Import (chuẩn hóa + cảnh báo)

Bắt buộc: `start`, `end` (float; tự chuyển dấu phẩy thành chấm), `sentence` khuyến nghị.  
Phụ đề: yêu cầu có cột phụ đề của ngôn ngữ chính đã chọn (ví dụ main=ja thì cần có cột Japanese).  
Tùy chọn: `type` (card type), `cefr_level` hoặc aliases, các cột phụ đề phụ khác.

Chuẩn hóa & cảnh báo:
- Map tên cột phụ đề về canonical: en, vi, zh, zh_trad, yue, ja, ko, id, th, ms.
- Cảnh báo khi phụ đề tiếng Anh không phù hợp với ký tự CJK/Hangul (heuristic).
- Scale độ khó từ nhiều thang (1–5, 0–10, …) về 0–100. Hỗ trợ nhiều alias tên cột.
- Fallback tính `length` nếu cột không có.
- Highlight ô trống bắt buộc ngay khi parse.

Template CSV có thể tải xuống từ trang Admin Create, phụ thuộc main language và bao gồm cột difficulty chuẩn.

## 🔐 Auth & Admin Access

- Firebase Auth (Google). Cần cấu hình API key, auth domain, project/app IDs.
- Khu vực Admin (route) yêu cầu email nằm trong `VITE_IMPORT_ADMIN_EMAILS`.
- Các thao tác ingest (upload/import) yêu cầu: email hợp lệ và (nếu cấu hình) đúng `VITE_IMPORT_KEY`.
- Nếu thiếu quyền: toast thông báo và điều hướng ra ngoài.

Routes Admin mới (chuẩn hóa theo content):
- Public: `/content` (tab “Movie” trong navbar vẫn trỏ tới `/content`), `/content/:slug` (cards)
- Admin List/Detail/Card: `/admin/content`, `/admin/content/:slug`, `/admin/content/:slug/:episodeId/:cardId`
- Admin Create/Update: `/admin/create`, `/admin/update`
- Back-compat: các route cũ `/movie` và `/admin/films...` sẽ redirect về route mới

## ⚙️ Environment Variables (.env)

```
VITE_CF_API_BASE=https://<your-worker>.<subdomain>.workers.dev   # Base URL Worker API
VITE_R2_PUBLIC_BASE=https://media.your-domain.com                # Public R2 base (no trailing slash)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_IMPORT_ADMIN_EMAILS=you@example.com,other@example.com
VITE_IMPORT_KEY=optional-admin-secret
```

## 🧑‍💻 Local Development

```powershell
git clone <new-repo-url> glassygaia
cd glassygaia
npm install
# Tạo file .env và điền các biến VITE_* như trên
npm run dev
```

## 🛠 Cloudflare Setup (Worker + D1 + R2)

1) Tạo D1 DB & apply migrations (xem thư mục `cloudflare-worker/migrations/`).  
2) Tạo R2 bucket và public domain (hoặc serve qua Worker).  
3) Đặt Worker vars (trong `wrangler.toml`):
```
[vars]
R2_PUBLIC_BASE = "https://media.your-domain.com"
```
4) Deploy Worker:
```powershell
wrangler deploy
```

## 🌐 Deploy lên Vercel

1) Import repository → Project settings:
   - Install: `npm ci`
   - Build: `npm run build`
   - Output: `dist`
2) Thêm toàn bộ env `VITE_*` ở Vercel Project.  
3) Đảm bảo file `vercel.json` có SPA rewrites (đã có sẵn trong repo).  
4) Thêm domain Vercel vào Firebase Auth → Authorized domains.  
5) Redeploy & test Google Sign-In + Admin ingest.

## ✅ Toast Events

- Cover uploaded / Images uploaded / Audio uploaded
- Thiếu quyền: chưa sign-in, không trong allowlist, thiếu Admin Key, thiếu CSV/Slug
- Thành công: Content + media + cards created

## 🧪 Common Issues

| Vấn đề | Nguyên nhân | Cách xử lý |
|-------|-------------|------------|
| Login Firebase blocked | Domain chưa được add | Thêm vào Authorized domains |
| 404 khi refresh route | Thiếu SPA rewrite | Kiểm tra `vercel.json` rewrites |
| Media không hiển thị | Sai R2 public base/path | Kiểm tra `VITE_R2_PUBLIC_BASE` & vars của Worker |
| ID lệch giữa Media & Cards | Tắt Infer IDs nhưng mong đợi theo filename | Bật Infer IDs hoặc chỉnh Start Index + Pad |
| Không thấy toast | Chưa mount `<Toaster />` | Đảm bảo Toaster trong `App.tsx` |

## 🔮 Roadmap

- Playlists/Collections, Study history
- Export Anki/CSV
- Analytics & learning progress
- Fuzzy search & accent-insensitive
- UI i18n
- Worker-side Firebase token verification (optional hardening)

## 📄 License

Internal MVP for client demo (update as needed).