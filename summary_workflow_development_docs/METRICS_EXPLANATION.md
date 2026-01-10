# Giải thích về Metrics và cách lưu trữ

## Tổng quan

Tài liệu này giải thích tại sao chỉ cần thêm cột `listening_sessions_count` vào `user_scores` mà các metrics khác không cần thêm cột mới.

## 1. Listening Count (`listening_sessions_count`)

### Tại sao cần thêm cột riêng?

**Listening Count** đếm số lần user click play audio (mỗi lần click = 1 session).

- **Đây là một sự kiện riêng biệt**: Không thể tính từ dữ liệu có sẵn
- **Khác với Listening XP**: 
  - Listening XP đếm số intervals hoàn thành (mỗi 5s = 1 XP transaction)
  - Listening Count đếm số lần click play (1 click = 1 session, bất kể nghe bao lâu)
- **Cần track real-time**: Mỗi lần user click play, cần increment ngay

### Cách sử dụng

1. **Khi nào increment**: 
   - Mỗi khi user click play audio (event 'play' được trigger)
   - Mỗi lần play = 1 session (không phải mỗi lần pause/resume)
   - Reset flag khi audio ends để lần play tiếp theo sẽ increment lại
   - Reset flag khi card thay đổi (navigate prev/next card)

2. **Endpoint**: `POST /api/user/increment-listening-session`
   - Authentication: JWT Bearer token (required)
   - Response: `{ success: boolean, listening_sessions_count: number }`
   - Side effects: Increment `user_scores.listening_sessions_count` và update `updated_at`

3. **Lưu trữ**: 
   - Column: `user_scores.listening_sessions_count` (INTEGER, NOT NULL, DEFAULT 0)
   - Migration: `030_add_interval_seconds_to_rewards.sql`
   - Unit: Số nguyên (count), không phải giây/phút

4. **Display**: 
   - PortfolioPage > Listening Metrics > Listening Count
   - Được tính từ `user_scores.listening_sessions_count`
   - Fallback: Nếu `listening_sessions_count = 0`, tính từ COUNT(*) của `xp_transactions` (backward compatibility)

### Logic trong code

```typescript
// Trong SearchResultCard.tsx

// 1. Setup event listener khi audio element được tạo
const setupAudioPlayListener = useCallback((audio: HTMLAudioElement) => {
  const handlePlay = () => {
    // Chỉ increment một lần mỗi play session
    if (!hasIncrementedListeningSession.current && user?.uid) {
      hasIncrementedListeningSession.current = true;
      // Fire and forget - không block audio play
      apiIncrementListeningSession().catch(err => console.warn(err));
    }
  };
  audio.addEventListener('play', handlePlay);
}, [user?.uid]);

// 2. Reset flag khi audio ends
audio.addEventListener('ended', () => {
  hasIncrementedListeningSession.current = false; // Cho phép increment lại lần play tiếp theo
});

// 3. Reset flag khi card thay đổi (prev/next card)
useEffect(() => {
  hasIncrementedListeningSession.current = false;
}, [card.id]);

// 4. Reset flag khi replay audio
const handleReplayAudio = () => {
  hasIncrementedListeningSession.current = false; // Reset để increment lại
  audioRef.current.currentTime = 0;
  audioRef.current.play();
};
```

### Flow hoàn chỉnh

1. User click play audio → `audio.play()` được gọi
2. Event 'play' được trigger → `handlePlay()` trong event listener chạy
3. Check `hasIncrementedListeningSession.current`:
   - Nếu `false` → Gọi `apiIncrementListeningSession()` → Set flag = `true`
   - Nếu `true` → Skip (đã increment cho session này)
4. API endpoint increment `listening_sessions_count` trong DB
5. Khi audio ends → Reset flag = `false` → Cho phép increment lại lần play tiếp theo

### Lý do thiết kế

- **Tách biệt với Listening XP**: 
  - Listening XP đếm số intervals hoàn thành (5s = 1 XP)
  - Listening Count đếm số lần click play (1 click = 1 session)
  - Ví dụ: User nghe 1 audio 30 giây:
    - Listening XP: 6 XP (30s / 5s = 6 intervals)
    - Listening Count: 1 session (chỉ click play 1 lần)

- **Không thể tính từ dữ liệu có sẵn**:
  - XP transactions không track số lần click play
  - Cần track real-time event (play button click)
  
- **Cần lưu trong DB**:
  - Đây là một metric tổng hợp (aggregated total)
  - Cần query nhanh cho PortfolioPage
  - Không thể tính lại từ lịch sử events (không có bảng events)

## 2. Review Count

### Tại sao KHÔNG cần thêm cột riêng?

**Review Count** = Tổng số lần user hover pointer lên card > 2 giây.

- **Đã có sẵn trong DB**: `user_card_states.review_count` (được increment qua `/api/card/increment-review`)
- **Tính tổng**: `SELECT SUM(review_count) FROM user_card_states WHERE user_id = ?`
- **Đã được track**: Mỗi lần hover > 2s, review_count của card đó được tăng lên

### Cách tính toán

```sql
SELECT COALESCE(SUM(review_count), 0) as total
FROM user_card_states
WHERE user_id = ?
```

## 3. Listening XP

### Tại sao KHÔNG cần thêm cột riêng?

**Listening XP** = Tổng XP từ listening activities (mỗi 5s listening = +1 XP, configurable).

- **Đã có sẵn trong DB**: `xp_transactions` với `reward_config_id` trỏ đến `rewards_config` có `action_type = 'listening_5s'`
- **Tính tổng**: `SELECT SUM(xp_amount) FROM xp_transactions WHERE reward_config_id = ?` (với id từ `rewards_config` có `action_type = 'listening_5s'`)
- **Đã được track**: Mỗi lần hoàn thành interval (5s default, configurable từ `rewards_config.interval_seconds`), một transaction được tạo với `reward_config_id`

### Cách tính toán

```sql
-- Lấy reward_config_id cho listening_5s
SELECT id FROM rewards_config WHERE action_type = 'listening_5s';

-- Tính tổng XP
SELECT COALESCE(SUM(xp_amount), 0) as total_xp
FROM xp_transactions
WHERE user_id = ? AND reward_config_id = ?
```

**Lưu ý**: Sử dụng `reward_config_id` thay vì `description` để đảm bảo tính chặt chẽ và tránh nhầm lẫn nếu description bị thay đổi.

## 4. Reading XP

### Tại sao KHÔNG cần thêm cột riêng?

**Reading XP** = Tổng XP từ reading activities (mỗi 8s reading = +1 XP, configurable).

- **Đã có sẵn trong DB**: `xp_transactions` với `reward_config_id` trỏ đến `rewards_config` có `action_type = 'reading_8s'`
- **Tính tổng**: `SELECT SUM(xp_amount) FROM xp_transactions WHERE reward_config_id = ?` (với id từ `rewards_config` có `action_type = 'reading_8s'`)
- **Đã được track**: Mỗi lần hoàn thành interval (8s default, configurable từ `rewards_config.interval_seconds`), một transaction được tạo với `reward_config_id`

### Cách tính toán

```sql
-- Lấy reward_config_id cho reading_8s
SELECT id FROM rewards_config WHERE action_type = 'reading_8s';

-- Tính tổng XP
SELECT COALESCE(SUM(xp_amount), 0) as total_xp
FROM xp_transactions
WHERE user_id = ? AND reward_config_id = ?
```

**Lưu ý**: Sử dụng `reward_config_id` thay vì `description` để đảm bảo tính chặt chẽ và tránh nhầm lẫn nếu description bị thay đổi.

## So sánh

| Metric | Cần thêm cột? | Lý do | Cách tính |
|--------|---------------|-------|-----------|
| **Listening Count** | ✅ CÓ | Event riêng biệt, không tính từ dữ liệu có sẵn | `user_scores.listening_sessions_count` |
| **Review Count** | ❌ KHÔNG | Đã có trong `user_card_states.review_count` | `SUM(review_count)` |
| **Listening XP** | ❌ KHÔNG | Đã có trong `xp_transactions` | `SUM(xp_amount) WHERE reward_config_id = (SELECT id FROM rewards_config WHERE action_type = 'listening_5s')` |
| **Reading XP** | ❌ KHÔNG | Đã có trong `xp_transactions` | `SUM(xp_amount) WHERE reward_config_id = (SELECT id FROM rewards_config WHERE action_type = 'reading_8s')` |

## Kết luận

### Tại sao chỉ Listening Count cần cột riêng?

1. **Event tracking riêng biệt**: 
   - Click play audio là một sự kiện độc lập, không thể tính từ dữ liệu có sẵn
   - Khác với XP (có thể tính từ transactions) và Review Count (có thể tính từ review_count)

2. **Không có transaction history**:
   - Không có bảng lưu lịch sử các lần click play audio
   - Nếu không lưu tổng, sẽ mất dữ liệu khi cần hiển thị

3. **Performance**:
   - Cần query nhanh cho PortfolioPage
   - Nếu tính từ events (nếu có), sẽ cần COUNT(*) mỗi lần load, tốn tài nguyên

### Tại sao các metrics khác KHÔNG cần cột riêng?

1. **Review Count**:
   - ✅ Đã có trong `user_card_states.review_count` (được increment qua `/api/card/increment-review`)
   - ✅ Tính tổng = `SUM(review_count)` (đơn giản, nhanh)
   - ✅ Có thể trace từng card (audit được)

2. **Listening XP**:
   - ✅ Đã có trong `xp_transactions` với `reward_config_id` trỏ đến `rewards_config` có `action_type = 'listening_5s'`
   - ✅ Tính tổng = `SUM(xp_amount) WHERE reward_config_id = ?` (chặt chẽ, dựa vào foreign key)
   - ✅ Có thể trace từng transaction (audit được)
   - ✅ Linh hoạt: Có thể query theo ngày, theo tháng, theo card, v.v.
   - ✅ **Sử dụng `reward_config_id` thay vì `description`** để đảm bảo tính chặt chẽ và tránh nhầm lẫn

3. **Reading XP**:
   - ✅ Đã có trong `xp_transactions` với `reward_config_id` trỏ đến `rewards_config` có `action_type = 'reading_8s'`
   - ✅ Tính tổng = `SUM(xp_amount) WHERE reward_config_id = ?` (chặt chẽ, dựa vào foreign key)
   - ✅ Có thể trace từng transaction (audit được)
   - ✅ Linh hoạt: Có thể query theo ngày, theo tháng, theo card, v.v.
   - ✅ **Sử dụng `reward_config_id` thay vì `description`** để đảm bảo tính chặt chẽ và tránh nhầm lẫn

### Lợi ích của cách tiếp cận này

1. **Tránh duplicate data** (normalization):
   - Không lưu trùng dữ liệu
   - Một nguồn dữ liệu, nhiều cách query

2. **Dễ audit**:
   - Có thể trace từng transaction/card
   - Có thể xem chi tiết lịch sử

3. **Linh hoạt**:
   - Có thể query theo nhiều cách khác nhau (theo ngày, theo tháng, theo card)
   - Không bị ràng buộc bởi một cột tổng hợp cố định

4. **Performance**:
   - Transaction tables đã có indexes
   - SUM() query nhanh với indexes
   - Không cần maintain thêm aggregated columns (trừ Listening Count - cần thiết)

### Khi nào nên thêm cột tổng hợp?

**Nên thêm khi:**
- ✅ Không thể tính từ dữ liệu có sẵn (như Listening Count)
- ✅ Cần query rất nhanh và không cần chi tiết (nhưng Listening Count không rơi vào case này)
- ✅ Tính toán quá phức tạp và tốn tài nguyên (nhưng SUM() rất nhanh)

**KHÔNG nên thêm khi:**
- ❌ Có thể tính từ dữ liệu có sẵn (như Review Count, XP)
- ❌ Cần audit/trace chi tiết (như XP transactions)
- ❌ Tính toán đơn giản (SUM() rất nhanh với indexes)
