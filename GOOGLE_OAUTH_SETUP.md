# Hướng dẫn thiết lập Google OAuth2 (thay thế Firebase)

## Bước 1: Tạo Google Cloud Project mới

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Click vào dropdown project ở trên cùng (hoặc tạo project mới)
3. Click "New Project"
4. Đặt tên project (ví dụ: "GlassyGaia OAuth")
5. Click "Create"

## Bước 2: Tạo OAuth 2.0 Credentials

**Lưu ý**: Bạn KHÔNG cần bật API nào cả! Google OAuth2 hoạt động tự động thông qua Google Identity Services.

1. Vào **APIs & Services** > **Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. Nếu chưa có OAuth consent screen, bạn sẽ được yêu cầu cấu hình:
   - **User Type**: Chọn "External" (hoặc Internal nếu dùng Google Workspace)
   - **App name**: Đặt tên app (ví dụ: "GlassyGaia")
   - **User support email**: Email của bạn
   - **Developer contact information**: Email của bạn
   - Click "Save and Continue"
   - **Scopes**: Thêm `email` và `profile`
   - Click "Save and Continue"
   - **Test users**: Thêm email của bạn để test (nếu app ở chế độ Testing)
   - Click "Save and Continue"
   - Review và quay lại

4. Tạo OAuth Client ID:
   - **Application type**: Chọn "Web application"
   - **Name**: Đặt tên (ví dụ: "GlassyGaia Web Client")
   - **Authorized JavaScript origins**: 
     - `http://localhost:5173` (cho development - Vite default port)
     - `http://localhost:3000` (nếu bạn dùng port khác)
     - `https://yourdomain.com` (cho production - thay bằng domain thực của bạn)
     - **QUAN TRỌNG**: Phải thêm CHÍNH XÁC origin mà bạn đang dùng (không có trailing slash `/`)
   - **Authorized redirect URIs**:
     - `http://localhost:5173` (cho development)
     - `http://localhost:3000` (nếu bạn dùng port khác)
     - `https://yourdomain.com` (cho production)
     - **Lưu ý**: Với Google Identity Services, redirect URI có thể không cần thiết, nhưng nên thêm để đảm bảo
   - Click "Create"

5. **Lưu lại Client ID và Client Secret** - bạn sẽ cần chúng!

## Bước 3: Cấu hình Environment Variables

Thêm vào file `.env` hoặc `.env.local`:

VITE_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com**Lưu ý**: Client Secret chỉ cần ở backend (Cloudflare Worker), KHÔNG thêm vào frontend `.env`.

## Bước 4: Cấu hình Cloudflare Worker

Thêm vào `wrangler.toml`:

[vars]
GOOGLE_CLIENT_ID = "your-client-id-here.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "your-client-secret-here"Hoặc thêm vào Cloudflare Dashboard > Workers > Settings > Environment Variables

## Bước 5: Test

1. Khởi động dev server: `npm run dev`
2. Thử đăng nhập với Google
3. Kiểm tra xem có nhận được user info không

## Bước 6: Xóa Firebase dependencies (tùy chọn)

Sau khi đã test và xác nhận Google OAuth hoạt động tốt, bạn có thể xóa Firebase:

npm uninstall firebase
Và xóa các biến môi trường Firebase cũ:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`

## Troubleshooting

### Lỗi: "The given origin is not allowed for the given client ID"

**Nguyên nhân**: Origin (URL) mà bạn đang dùng không được thêm vào "Authorized JavaScript origins" trong Google Cloud Console.

**Cách sửa**:
1. Mở Google Cloud Console > APIs & Services > Credentials
2. Click vào OAuth 2.0 Client ID của bạn
3. Kiểm tra "Authorized JavaScript origins"
4. Thêm origin CHÍNH XÁC mà bạn đang dùng:
   - Nếu đang chạy local: `http://localhost:5173` (hoặc port khác)
   - Nếu đang ở production: `https://yourdomain.com` (không có trailing slash)
5. Click "Save"
6. Đợi vài phút để Google cập nhật
7. Refresh trang và thử lại

**Cách kiểm tra origin hiện tại**:
- Mở Developer Console (F12)
- Xem URL trong address bar
- Origin = protocol + hostname + port (nếu có)
- Ví dụ: `http://localhost:5173` hoặc `https://glassygaia.com`

### Lỗi: "POST /auth/google 404 (Not Found)"

**Nguyên nhân**: Worker chưa được deploy với code mới hoặc endpoint chưa được thêm.

**Cách sửa**:
1. Đảm bảo code trong `cloudflare-worker/src/worker.js` có endpoint `/auth/google`
2. Deploy lại worker:
   ```bash
   cd cloudflare-worker
   npx wrangler deploy
   ```
3. Kiểm tra lại sau khi deploy xong

### Lỗi: "Google OAuth not configured"

**Nguyên nhân**: Environment variables chưa được set.

**Cách sửa**:
1. Kiểm tra `wrangler.toml` có `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET`
2. Hoặc thêm vào Cloudflare Dashboard > Workers > Settings > Environment Variables
3. Deploy lại worker sau khi thêm variables

## Lưu ý bảo mật

- **KHÔNG** commit Client Secret vào Git
- Chỉ expose Client ID ở frontend
- Client Secret chỉ dùng ở backend để verify token
- Sử dụng HTTPS trong production