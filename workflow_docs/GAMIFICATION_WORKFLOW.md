# Gamification System Workflow Documentation

## Tổng quan hệ thống

Hệ thống gamification bao gồm:
- **XP (Experience Points)**: Điểm kinh nghiệm
- **Coins**: Tiền ảo
- **Streak**: Chuỗi ngày học liên tiếp
- **Time Tracking**: Theo dõi thời gian nghe và đọc

---

## 1. WORKFLOW: Lưu XP và Coin

### 1.1. SRS State Change → +1 XP

**Luồng hoạt động:**
```
User thay đổi SRS state của card
  ↓
Frontend: SearchResultCard.tsx → handleSRSStateChange()
  ↓
API: POST /api/card/srs-state
  ↓
Worker: worker.js → /api/card/srs-state handler
  ↓
1. Kiểm tra oldState vs newState
2. Nếu thay đổi (không phải 'none' → 'none'):
   → Gọi awardXP(env, userId, 1, rewardConfigId, 'SRS state change', cardId, filmId)
  ↓
awardXP() function:
  - getOrCreateUserScores() → Tạo user_scores nếu chưa có
  - UPDATE user_scores SET total_xp = total_xp + 1, level = (total_xp + 1) / 100 + 1
  - INSERT vào xp_transactions (ghi lại transaction)
  - UPDATE user_daily_activity SET daily_xp = daily_xp + 1
  - checkAndUpdateStreak() → Kiểm tra streak nếu daily_xp >= 20
```

**Code Location:**
- Frontend: `src/components/SearchResultCard.tsx` (line ~177)
- API: `cloudflare-worker/src/worker.js` (line ~6015-6040)
- Helper: `cloudflare-worker/src/worker.js` (line ~5457-5492)

**Database:**
- **Bảng**: `user_scores`
  - `total_xp` (INTEGER): Tổng XP tích lũy (lifetime)
  - `level` (INTEGER): Level = (total_xp / 100) + 1
- **Bảng**: `xp_transactions`
  - `xp_amount` (INTEGER): Số XP được trao (1)
  - `reward_config_id` (INTEGER): FK đến `rewards_config` (action_type = 'srs_state_change')
  - `card_id`, `film_id`: Context của transaction
- **Bảng**: `user_daily_activity`
  - `daily_xp` (INTEGER): XP tích lũy trong ngày (reset mỗi ngày)

---

### 1.2. Listening Time → +1 XP mỗi 5 giây

**Luồng hoạt động:**
```
User click ảnh hoặc nhấn Space để play audio
  ↓
Frontend: SearchResultCard.tsx → handleImageClick()
  ↓
Bắt đầu tracking:
  - listeningStartTimeRef = Date.now()
  - setInterval mỗi 5 giây → onTrackListening(5)
  ↓
Frontend: SearchPage.tsx → handleTrackListening()
  ↓
Debounce và accumulate:
  - listeningTimeAccumulatorRef += seconds
  - setTimeout 5 giây → Gọi API
  ↓
API: POST /api/user/track-time
  Body: { user_id, time_seconds, type: 'listening' }
  ↓
Worker: worker.js → trackTime(env, userId, timeSeconds, 'listening')
  ↓
trackTime() function:
  1. getOrCreateDailyActivity() → Tạo daily_activity nếu chưa có
  2. getOrCreateUserScores() → Tạo user_scores nếu chưa có
  3. Lấy reward_config (action_type = 'listening_5s')
  4. Tính checkpoint:
     - currentCheckpoint = daily_listening_checkpoint (giây đã được trao XP)
     - newTime = daily_listening_time + timeSeconds
     - newCheckpoint = Math.floor(newTime / 5) * 5
     - intervalsCompleted = (newCheckpoint - currentCheckpoint) / 5
  5. Nếu intervalsCompleted > 0:
     → awardXP(env, userId, intervalsCompleted * 1, rewardConfigId, 'listening time tracking')
  6. UPDATE user_daily_activity:
     - daily_listening_time = newTime
     - daily_listening_checkpoint = newCheckpoint
  7. UPDATE user_scores:
     - total_listening_time = total_listening_time + timeSeconds
  8. UPDATE user_daily_stats (historical):
     - listening_time = listening_time + timeSeconds
```

**Code Location:**
- Frontend: `src/components/SearchResultCard.tsx` (line ~900-932, ~1050-1070)
- Frontend: `src/pages/SearchPage.tsx` (line ~380-420)
- API: `cloudflare-worker/src/worker.js` (line ~6195-6210)
- Helper: `cloudflare-worker/src/worker.js` (line ~5631-5770)

**Database:**
- **Bảng**: `user_daily_activity`
  - `daily_listening_time` (INTEGER): Tổng giây nghe trong ngày (reset mỗi ngày)
  - `daily_listening_checkpoint` (INTEGER): Giây đã được trao XP (ví dụ: 0, 5, 10, 15...)
- **Bảng**: `user_scores`
  - `total_listening_time` (INTEGER): Tổng giây nghe (lifetime, không reset)
- **Bảng**: `user_daily_stats`
  - `listening_time` (INTEGER): Giây nghe trong ngày (historical, không reset)

**Đơn vị:**
- Lưu trữ: **giây (seconds)** - INTEGER
- Hiển thị: **phút (minutes)** - `Math.round(total_listening_time / 60)`

---

### 1.3. Reading Time → +1 XP mỗi 8 giây

**Luồng hoạt động:**
```
User hover vào card
  ↓
Frontend: SearchResultCard.tsx → handleMouseEnter()
  ↓
Bắt đầu tracking:
  - readingStartTimeRef = Date.now()
  - setInterval mỗi 8 giây → onTrackReading(8)
  ↓
Frontend: SearchPage.tsx → handleTrackReading()
  ↓
Debounce và accumulate:
  - readingTimeAccumulatorRef += seconds
  - setTimeout 8 giây → Gọi API
  ↓
API: POST /api/user/track-time
  Body: { user_id, time_seconds, type: 'reading' }
  ↓
Worker: worker.js → trackTime(env, userId, timeSeconds, 'reading')
  ↓
trackTime() function (tương tự listening nhưng):
  - intervalSeconds = 8 (thay vì 5)
  - reward_config (action_type = 'reading_8s')
  - Update daily_reading_time, daily_reading_checkpoint
  - Update total_reading_time
```

**Code Location:**
- Frontend: `src/components/SearchResultCard.tsx` (line ~238-249)
- Frontend: `src/pages/SearchPage.tsx` (line ~367-395)
- Helper: `cloudflare-worker/src/worker.js` (line ~5631-5770)

**Database:**
- **Bảng**: `user_daily_activity`
  - `daily_reading_time` (INTEGER): Tổng giây đọc trong ngày
  - `daily_reading_checkpoint` (INTEGER): Giây đã được trao XP (0, 8, 16, 24...)
- **Bảng**: `user_scores`
  - `total_reading_time` (INTEGER): Tổng giây đọc (lifetime)
- **Bảng**: `user_daily_stats`
  - `reading_time` (INTEGER): Giây đọc trong ngày (historical)

**Đơn vị:**
- Lưu trữ: **giây (seconds)** - INTEGER
- Hiển thị: **phút (minutes)** - `Math.round(total_reading_time / 60)`

---

### 1.4. Daily Streak → +1 Streak khi đạt +20 XP trong ngày

**Luồng hoạt động:**
```
Mỗi khi awardXP() được gọi:
  ↓
awardXP() → checkAndUpdateStreak(env, userId)
  ↓
checkAndUpdateStreak() function:
  1. Lấy user_daily_activity của hôm nay
  2. Nếu daily_xp >= 20:
     a. Lấy user_scores.last_study_date
     b. Nếu last_study_date != today:
        - Nếu last_study_date == yesterday:
           → current_streak = current_streak + 1 (tiếp tục streak)
        - Nếu không:
           → current_streak = 1 (streak mới)
        - longest_streak = MAX(longest_streak, current_streak)
        - UPDATE user_scores:
           * current_streak
           * longest_streak
           * last_study_date = today
        - INSERT vào user_streak_history
```

**Code Location:**
- Helper: `cloudflare-worker/src/worker.js` (line ~5518-5628)

**Database:**
- **Bảng**: `user_scores`
  - `current_streak` (INTEGER): Chuỗi ngày học hiện tại
  - `longest_streak` (INTEGER): Chuỗi ngày học dài nhất (lifetime)
  - `last_study_date` (TEXT): Ngày học cuối cùng (YYYY-MM-DD)
- **Bảng**: `user_streak_history`
  - `streak_date` (TEXT): Ngày (YYYY-MM-DD)
  - `streak_achieved` (INTEGER): 1 = đạt streak, 0 = không đạt
  - `streak_count` (INTEGER): Số streak vào ngày đó

**Đơn vị:**
- Lưu trữ: **số ngày** - INTEGER
- Hiển thị: **số ngày** - `current_streak` days

---

## 2. WORKFLOW: Background Task (Reset Daily Tables)

**Luồng hoạt động:**
```
Cloudflare Scheduled Event (mỗi ngày lúc 00:00 UTC)
  ↓
Worker: worker.js → scheduled(event, env, ctx)
  ↓
resetDailyTables(env) function:
  1. today = YYYY-MM-DD (hôm nay)
  2. yesterday = YYYY-MM-DD (hôm qua)
  3. Lấy tất cả users có activity hôm qua
  4. Với mỗi user:
     a. Kiểm tra user_daily_stats đã có record cho yesterday chưa
     b. Nếu chưa có:
        → INSERT vào user_daily_stats:
           * xp_earned = daily_xp từ hôm qua
           * listening_time = daily_listening_time từ hôm qua
           * reading_time = daily_reading_time từ hôm qua
  5. DELETE tất cả user_daily_activity WHERE activity_date != today
     (Chỉ giữ lại record của hôm nay)
```

**Code Location:**
- Scheduled Handler: `cloudflare-worker/src/worker.js` (line ~7910-7915)
- Reset Function: `cloudflare-worker/src/worker.js` (line ~5370-5440)
- Config: `cloudflare-worker/wrangler.toml` (line ~29-32)

**Cron Schedule:**
- `"0 0 * * *"` - Chạy mỗi ngày lúc 00:00 UTC

**Database:**
- **Bảng**: `user_daily_activity` (RESET mỗi ngày)
  - Tất cả records cũ bị xóa, chỉ giữ lại hôm nay
  - Tự động tạo mới khi user có activity
- **Bảng**: `user_daily_stats` (KHÔNG RESET - historical)
  - Lưu trữ vĩnh viễn dữ liệu mỗi ngày
  - `xp_earned`, `listening_time`, `reading_time` của từng ngày

---

## 3. WORKFLOW: Hiển thị trong PortfolioPage

### 3.1. Lấy dữ liệu

**Luồng hoạt động:**
```
PortfolioPage.tsx → useEffect
  ↓
apiGetUserPortfolio(userId)
  ↓
API: GET /api/user/portfolio?user_id=xxx
  ↓
Worker: worker.js → /api/user/portfolio handler
  ↓
1. getOrCreateUserScores(env, userId) → Đảm bảo user_scores tồn tại
2. SELECT từ user_scores:
   - total_xp, level, coins
   - current_streak, longest_streak
   - total_listening_time, total_reading_time
3. SELECT COUNT từ user_card_states:
   - total_cards_saved (srs_state != 'none')
   - total_cards_reviewed (SUM review_count)
   - due_cards_count (next_review_at <= now)
  ↓
Return JSON response
```

**Code Location:**
- Frontend: `src/pages/PortfolioPage.tsx` (line ~44-72)
- Frontend Service: `src/services/portfolioApi.ts`
- API: `cloudflare-worker/src/worker.js` (line ~6290-6350)

### 3.2. Hiển thị Metrics

**PortfolioPage hiển thị:**

1. **Header Stats** (`portfolio-stat-item`):
   - `total_cards_saved` → "X cards"
   - `current_streak` → "X days"
   - `total_xp` → "Xxp"
   - `coins` → "X"

2. **Metrics Cards** (`portfolio-metric-card`):
   - `due_cards_count` → "# Due Cards"
   - `total_listening_time` → "Listening Time (min)"
     - **Xử lý**: `Math.round(portfolio.total_listening_time / 60)`
     - **Đơn vị**: giây → phút
   - `total_reading_time` → "Reading Time (min)"
     - **Xử lý**: `Math.round(portfolio.total_reading_time / 60)`
     - **Đơn vị**: giây → phút

3. **Stats Grid** (`portfolio-stat-card`):
   - `total_xp`, `level`, `coins`
   - `current_streak`, `longest_streak`
   - `total_cards_saved`, `total_cards_reviewed`
   - `total_listening_time` → `formatTime()` → "Xh Xm"
   - `total_reading_time` → `formatTime()` → "Xh Xm"

**Code Location:**
- `src/pages/PortfolioPage.tsx` (line ~632-693, ~1117-1165)

---

## 4. BẢNG DỮ LIỆU VÀ TRƯỜNG

### 4.1. `user_scores` (Lifetime Totals - KHÔNG RESET)

| Trường | Kiểu | Đơn vị | Mô tả |
|--------|------|--------|-------|
| `total_xp` | INTEGER | XP | Tổng XP tích lũy (lifetime) |
| `level` | INTEGER | Level | Level = (total_xp / 100) + 1 |
| `coins` | INTEGER | Coins | Số coins hiện tại |
| `total_coins_earned` | INTEGER | Coins | Tổng coins đã kiếm (lifetime) |
| `current_streak` | INTEGER | Ngày | Chuỗi ngày học hiện tại |
| `longest_streak` | INTEGER | Ngày | Chuỗi ngày học dài nhất |
| `last_study_date` | TEXT | YYYY-MM-DD | Ngày học cuối cùng |
| `total_listening_time` | INTEGER | Giây | Tổng thời gian nghe (lifetime) |
| `total_reading_time` | INTEGER | Giây | Tổng thời gian đọc (lifetime) |

**Hiển thị:**
- XP, Level, Coins, Streak: Hiển thị trực tiếp
- Listening/Reading Time: `Math.round(seconds / 60)` → phút

---

### 4.2. `user_daily_activity` (Daily Tracking - RESET mỗi ngày)

| Trường | Kiểu | Đơn vị | Mô tả |
|--------|------|--------|-------|
| `activity_date` | TEXT | YYYY-MM-DD | Ngày (unique per user) |
| `daily_xp` | INTEGER | XP | XP tích lũy trong ngày |
| `daily_listening_time` | INTEGER | Giây | Thời gian nghe trong ngày |
| `daily_reading_time` | INTEGER | Giây | Thời gian đọc trong ngày |
| `daily_listening_checkpoint` | INTEGER | Giây | Checkpoint đã trao XP (0, 5, 10, 15...) |
| `daily_reading_checkpoint` | INTEGER | Giây | Checkpoint đã trao XP (0, 8, 16, 24...) |

**Reset Logic:**
- Background task xóa tất cả records cũ (không phải hôm nay)
- Tự động tạo mới khi user có activity

---

### 4.3. `user_daily_stats` (Historical - KHÔNG RESET)

| Trường | Kiểu | Đơn vị | Mô tả |
|--------|------|--------|-------|
| `stats_date` | TEXT | YYYY-MM-DD | Ngày (unique per user) |
| `xp_earned` | INTEGER | XP | XP kiếm được trong ngày |
| `listening_time` | INTEGER | Giây | Thời gian nghe trong ngày |
| `reading_time` | INTEGER | Giây | Thời gian đọc trong ngày |
| `cards_reviewed` | INTEGER | Cards | Số cards review trong ngày |

**Lưu ý:**
- Lưu trữ vĩnh viễn, không bao giờ reset
- Background task archive dữ liệu từ `user_daily_activity` vào đây mỗi ngày

---

### 4.4. `xp_transactions` (Transaction Log)

| Trường | Kiểu | Đơn vị | Mô tả |
|--------|------|--------|-------|
| `xp_amount` | INTEGER | XP | Số XP được trao |
| `reward_config_id` | INTEGER | FK | FK đến `rewards_config` |
| `card_id`, `film_id` | TEXT | Context | Context của transaction |
| `description` | TEXT | - | Mô tả (ví dụ: "listening time tracking") |

**Mục đích:**
- Ghi lại lịch sử kiếm XP
- Transparency và audit trail

---

### 4.5. `coin_transactions` (Transaction Log)

| Trường | Kiểu | Đơn vị | Mô tả |
|--------|------|--------|-------|
| `coin_amount` | INTEGER | Coins | Số coins (dương = kiếm, âm = tiêu) |
| `transaction_type` | TEXT | - | 'earn' hoặc 'spend' |
| `reward_config_id` | INTEGER | FK | FK đến `rewards_config` |

---

### 4.6. `rewards_config` (Configuration)

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `action_type` | TEXT | 'srs_state_change', 'listening_5s', 'reading_8s', 'daily_challenge' |
| `xp_amount` | INTEGER | Số XP trao cho action này |
| `coin_amount` | INTEGER | Số coins trao cho action này |

**Default Values:**
- `srs_state_change`: 1 XP, 0 coins
- `listening_5s`: 1 XP mỗi 5 giây, 0 coins
- `reading_8s`: 1 XP mỗi 8 giây, 0 coins
- `daily_challenge`: 20 XP, 20 coins

---

## 5. TÓM TẮT CÁC ĐIỂM QUAN TRỌNG

### 5.1. Checkpoint System (Tránh duplicate XP)

**Listening:**
- Mỗi 5 giây = +1 XP
- `daily_listening_checkpoint` lưu giây đã được trao XP (0, 5, 10, 15...)
- Chỉ trao XP cho phần vượt quá checkpoint

**Reading:**
- Mỗi 8 giây = +1 XP
- `daily_reading_checkpoint` lưu giây đã được trao XP (0, 8, 16, 24...)
- Chỉ trao XP cho phần vượt quá checkpoint

### 5.2. Đơn vị và Conversion

| Dữ liệu | Lưu trữ (DB) | Hiển thị | Conversion |
|---------|--------------|----------|------------|
| Listening Time | Giây (INTEGER) | Phút | `Math.round(seconds / 60)` |
| Reading Time | Giây (INTEGER) | Phút | `Math.round(seconds / 60)` |
| XP | XP (INTEGER) | XP | Trực tiếp |
| Coins | Coins (INTEGER) | Coins | Trực tiếp |
| Streak | Ngày (INTEGER) | Ngày | Trực tiếp |

### 5.3. Reset Logic

**Reset mỗi ngày (Background Task):**
- `user_daily_activity` → Xóa records cũ, chỉ giữ hôm nay

**KHÔNG Reset (Lifetime):**
- `user_scores` → Tất cả totals
- `user_daily_stats` → Historical records
- `xp_transactions`, `coin_transactions` → Transaction logs

---

## 6. API ENDPOINTS

### 6.1. `POST /api/user/track-time`
- **Body**: `{ user_id, time_seconds, type: 'listening' | 'reading' }`
- **Response**: `{ success: true, xp_awarded: number }`
- **Chức năng**: Track time và trao XP theo checkpoint

### 6.2. `POST /api/card/srs-state`
- **Body**: `{ user_id, card_id, srs_state, film_id, episode_id }`
- **Response**: `{ success: true, srs_state: string }`
- **Chức năng**: Update SRS state và trao +1 XP nếu thay đổi

### 6.3. `GET /api/user/portfolio`
- **Query**: `?user_id=xxx`
- **Response**: `{ total_xp, level, coins, current_streak, longest_streak, total_listening_time, total_reading_time, due_cards_count, ... }`
- **Chức năng**: Lấy tất cả metrics để hiển thị trong PortfolioPage

---

## 7. FILES LIÊN QUAN

### Backend:
- `cloudflare-worker/src/worker.js`:
  - Helper functions: `getOrCreateUserScores`, `awardXP`, `trackTime`, `checkAndUpdateStreak`, `resetDailyTables`
  - API endpoints: `/api/user/track-time`, `/api/card/srs-state`, `/api/user/portfolio`
  - Scheduled handler: `scheduled(event, env, ctx)`

### Frontend:
- `src/services/userTracking.ts`: `apiTrackTime()`
- `src/services/portfolioApi.ts`: `apiGetUserPortfolio()`
- `src/components/SearchResultCard.tsx`: Tracking logic (hover, click audio)
- `src/pages/SearchPage.tsx`: Debounce và accumulate time tracking
- `src/pages/PortfolioPage.tsx`: Hiển thị metrics

### Database:
- `cloudflare-worker/migrations/018_add_srs_system.sql`: Schema definition

---

## 8. DEBUGGING TIPS

1. **Listening/Reading Time không hiển thị:**
   - Kiểm tra `user_scores.total_listening_time` và `total_reading_time` có giá trị không
   - Kiểm tra `trackTime()` có được gọi không (console.log)
   - Kiểm tra API `/api/user/track-time` có trả về success không

2. **XP không tăng:**
   - Kiểm tra `xp_transactions` có record mới không
   - Kiểm tra `user_daily_activity.daily_xp` có tăng không
   - Kiểm tra `user_scores.total_xp` có update không

3. **Streak không tăng:**
   - Kiểm tra `user_daily_activity.daily_xp >= 20` chưa
   - Kiểm tra `user_scores.last_study_date` có đúng không
   - Kiểm tra `user_streak_history` có record mới không
