# Quick Guide: Accessing Admin User Management

## Đường Dẫn
- **Danh sách users**: `http://localhost:5173/admin/users`
- **Chi tiết user**: `http://localhost:5173/admin/users/{userId}`

## Ví Dụ
- Local guest user: `http://localhost:5173/admin/users/local`
- Real user (sau khi sign in): `http://localhost:5173/admin/users/{firebase-uid}`

## Navigation
1. Vào Admin Panel (cần đăng nhập với quyền admin)
2. Click menu "Users" hoặc navigate đến `/admin/users`
3. Tìm kiếm/filter users theo nhu cầu
4. Click "View" để xem chi tiết user

## API Endpoints Available
```
GET /api/users                      → List all users
GET /api/users/:id                  → Get user profile
GET /api/users/:id/progress         → Get user progress data
GET /api/users/:id/stats            → Get user statistics
GET /api/users/:id/preferences      → Get user preferences
GET /api/users/:id/favorites        → Get user favorites
```

## Thông Tin Hiển Thị

### User List Page
- Avatar (nếu có)
- Display Name
- Email
- Auth Provider (google, local, etc.)
- Role (Admin/User badge)
- Status (Active/Inactive badge)
- Join Date (absolute + relative time)
- Last Login
- Search box
- Filters (Status, Role, Page Size)
- Pagination

### User Detail Page
- **Profile Section**
  - Large avatar
  - Name, Email, User ID
  - Provider, Join date, Last login
  - Role and Status badges

- **Preferences Section**
  - Main Language
  - Subtitle Languages
  - Require All Languages
  - Difficulty Range
  - Auto Play
  - Playback Speed
  - Theme
  - Show Romanization

- **Statistics Section**
  - Films Studied
  - Episodes Studied
  - Cards Completed
  - Favorites Count
  - First Study Date
  - Last Study Date
  - Study Days Span

- **Episode Progress Section**
  - List of all episodes studied
  - Progress bar per episode
  - Completion percentage
  - Cards completed / Total cards
  - Last card index
  - Last study date

- **Recent Cards Section**
  - Table of last 20 cards completed
  - Film ID, Episode ID, Card Index
  - Card ID, Completion timestamp

## Styles
- Separated CSS files (không làm loãng admin.css):
  - `src/styles/admin/admin-user-list.css`
  - `src/styles/admin/admin-user-detail.css`
- Responsive design for mobile/tablet
- Consistent with AdminContentListPage design
- Color-coded badges and progress indicators

## Testing
Để test với real users:
1. Sign in qua NavBar với Google
2. Auto-registration sẽ tạo user trong DB
3. Navigate to `/admin/users`
4. Sẽ thấy user mới trong danh sách
5. Click "View" để xem chi tiết
6. Study một vài cards trong WatchPage
7. Refresh detail page để thấy progress cập nhật
