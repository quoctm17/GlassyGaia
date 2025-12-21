# Hướng dẫn sửa lỗi Google OAuth

## Lỗi 1: "The given origin is not allowed for the given client ID"

### Cách sửa:

1. **Xác định origin hiện tại của bạn:**
   - Mở browser, xem URL trong address bar
   - Origin = protocol + hostname + port (nếu có)
   - Ví dụ: 
     - `http://localhost:5173` (development với Vite)
     - `http://localhost:3000` (nếu dùng port khác)
     - `https://yourdomain.com` (production)

2. **Thêm origin vào Google Cloud Console:**
   - Truy cập: https://console.cloud.google.com/apis/credentials
   - Click vào OAuth 2.0 Client ID của bạn (Client ID: `338686084012-nh3l4gt1vsg45s19nvea6jf2q9ukdh5k`)
   - Scroll xuống phần **"Authorized JavaScript origins"**
   - Click **"+ ADD URI"**
   - Thêm origin CHÍNH XÁC (không có trailing slash `/`):
     - Nếu đang chạy local: `http://localhost:5173`
     - Nếu đang ở production: `https://yourdomain.com`
   - Click **"SAVE"**
   - **Đợi 1-2 phút** để Google cập nhật

3. **Refresh trang và thử lại**

## Lỗi 2: "POST /auth/google 404 (Not Found)"

### Cách sửa:

Endpoint `/auth/google` đã có trong code nhưng worker chưa được deploy. Cần deploy lại:

```bash
cd cloudflare-worker
npx wrangler deploy
```

Sau khi deploy xong, endpoint sẽ hoạt động.

## Kiểm tra nhanh:

1. **Kiểm tra origin trong browser console:**
   - Mở Developer Tools (F12)
   - Vào tab Console
   - Gõ: `window.location.origin`
   - Copy giá trị và thêm vào Google Cloud Console

2. **Kiểm tra endpoint có hoạt động:**
   - Sau khi deploy, thử gọi:
   ```bash
   curl -X POST https://glassygaia-worker.phungnguyeniufintechclub.workers.dev/auth/google \
     -H "Content-Type: application/json" \
     -d '{"id_token":"test"}'
   ```
   - Nếu trả về lỗi về token (không phải 404) = endpoint đã hoạt động

## Checklist:

- [ ] Đã thêm origin vào Google Cloud Console
- [ ] Đã đợi 1-2 phút sau khi save
- [ ] Đã deploy worker với `npx wrangler deploy`
- [ ] Đã refresh trang và thử lại
