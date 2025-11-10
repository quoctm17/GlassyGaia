# GlassyGaia – Multilingual Subtitle Card Explorer

Ứng dụng tra cứu và học từ/câu dựa trên phụ đề phim đa ngôn ngữ. Tìm kiếm theo ngôn ngữ chính của phim, xem ảnh snapshot, nghe audio, hiển thị nhiều phụ đề phụ, đánh dấu yêu thích, và có khu vực Admin để ingest phim + media nhanh chóng.

- Live (Vercel): https://lingua-search.vercel.app
- Hạ tầng: Cloudflare Worker + D1 (DB) + R2 (media) & Firebase Auth

## ✨ Tính năng

- Search theo ngôn ngữ chính (per film primary language) với highlight kết quả
- Subtitles phụ: en, vi, zh, zh_trad, ja, ko, id, th, ms (thứ tự ổn định)
- Snapshot image + audio cho mỗi card
- Favorites (yêu cầu đăng nhập Google)
- Admin ingest với toast feedback:
  - Upload cover, images, audio theo đúng cấu trúc R2
  - Import CSV để tạo film metadata + cards
  - Tự đồng bộ ID giữa Media & Cards thông qua Infer IDs
- Dark UI (TailwindCSS), flag-icons và lucide-react icons

## 🧱 Tech Stack

- React 19 + React Router
- Vite 7 + TypeScript 5
- TailwindCSS 3
- Cloudflare Worker (API) + D1 (SQL) + R2 (object storage)
- Firebase Auth (Google Sign-In)
- Libraries: papaparse (CSV), react-hot-toast, lucide-react, uuid, flag-icons

## 📦 Data Model (Cloudflare D1)

Films (rút gọn):
```sql
CREATE TABLE films (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  language TEXT,
  available_subs TEXT,   -- JSON array
  episodes INTEGER,
  cover_url TEXT,
  total_cards INTEGER,
  description TEXT
);
```

Cards:
```sql
CREATE TABLE cards (
  id TEXT,                -- UUID
  film_id TEXT,
  episode_id TEXT,        -- e1, e2...
  card_number INTEGER,    -- numeric sequence
  start REAL,
  end REAL,
  sentence TEXT,
  CEFR_Level TEXT,
  subtitle TEXT,          -- JSON: {"en":"Hello", "vi":"Xin chào", ...}
  image_url TEXT,
  audio_url TEXT,
  PRIMARY KEY (film_id, episode_id, id)
);
```

## 🗂 R2 Storage Layout

```
items/{filmId}/cover_image/cover.jpg
items/{filmId}/episodes/e{N}/image/{filmId_normalized}_{cardId}.jpg
items/{filmId}/episodes/e{N}/audio/{filmId_normalized}_{cardId}.mp3
```

`filmId_normalized`: slug thay dấu gạch ngang bằng gạch dưới.  
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

## 📑 CSV Import

Bắt buộc: `start`, `end` (float; tự chuyển dấu phẩy thành chấm).  
Tuỳ chọn: `sentence`, `type`, `cefr_level`.  
Subtitles: cột tên ngôn ngữ (English, Vietnamese, Chinese (Simplified), Chinese (Traditional), Japanese, Korean, Indonesian, Thai, Malay). Hệ thống tự canonical hoá về: en, vi, zh, zh_trad, ja, ko, id, th, ms.

Ví dụ header:
```
start,end,sentence,English,Vietnamese,Chinese (Simplified),Chinese (Traditional),Japanese
```

## 🔐 Auth & Admin Access

- Firebase Auth (Google). Cần cấu hình API key, auth domain, project/app IDs.
- Khu vực Admin (route) yêu cầu email nằm trong `VITE_IMPORT_ADMIN_EMAILS`.
- Các thao tác ingest (upload/import) yêu cầu: email hợp lệ và (nếu cấu hình) đúng `VITE_IMPORT_KEY`.
- Nếu thiếu quyền: toast thông báo và điều hướng ra ngoài.

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
- Thiếu quyền: chưa sign-in, không trong allowlist, thiếu Admin Key, thiếu CSV/Film ID
- Thành công: Film + media + cards created

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