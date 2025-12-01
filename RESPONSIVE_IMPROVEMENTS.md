# Responsive Design Improvements

## Tổng quan
Đã thêm responsive styles toàn diện vào `src/styles/index.css` để hỗ trợ ứng dụng trên nhiều thiết bị khác nhau.

## Breakpoints
- **Desktop**: > 1024px (mặc định)
- **Tablet**: 768px - 1024px
- **Mobile**: 480px - 768px
- **Small Mobile**: < 480px
- **Landscape Mobile**: height < 500px

## Chi tiết cải tiến

### 1. Touch Device Optimizations
- Tăng kích thước touch targets lên tối thiểu 44x44px
- Thêm touch feedback với scale effect
- Tắt hover effects trên touch devices

### 2. NavBar Responsive
- **Tablet**: Logo nhỏ hơn (50px), tabs 9px font
- **Mobile**: Logo 40px, tabs 8px font, flexbox wrap
- **Small Mobile**: Logo 35px, tabs 7px font, ultra compact
- User avatar tự động scale theo screen size
- User dropdown menu responsive width

### 3. SearchPage Layout
- **Tablet & Mobile**: Sidebar chuyển sang full-width ở trên
- Vertical resizer ẩn trên mobile
- Padding giảm dần theo screen size
- Overflow-x hidden để tránh horizontal scroll

### 4. Search Bar
- **Mobile**: Button full-width, input padding giảm
- Icon size và spacing responsive
- Font size giảm từ 10px → 9px → 8px → 7px

### 5. Filter Panels

#### Content Selector
- Search input responsive padding
- Content groups max-height giảm trên mobile (230px → 180px)
- Font sizes scale down (12px → 11px → 10px → 9px)
- Item buttons và badges responsive

#### Difficulty Filter
- Input fields font size responsive
- Track height tăng trên mobile (8px → 12px)
- Handle size tăng trên mobile (24px → 32px → 28px)
- Level tick marks lớn hơn để dễ nhìn

#### Level Framework Filter
- Dropdown button font responsive
- Spacing và padding optimize

### 6. Search Result Cards
- **Tablet**: Image 120px height
- **Mobile**: Full-width layout, image 180px
- **Small Mobile**: Image 150px
- Card flex direction: row → column trên mobile
- Audio player height responsive (48px → 40px)
- Metadata font size scale down

### 7. Pagination
- **Mobile**: Full-width column layout
- Buttons, inputs, selects min-height 40px
- Font size responsive (13px → 11px → 10px)
- Flex wrap cho better spacing

### 8. Language Selectors
- Dropdown width responsive (16rem → 90vw max 320px)
- Options list max-height tăng trên mobile (168px → 220px)
- Font sizes scale down
- Scrollbar width giảm trên mobile (16px → 8px)

### 9. Typography
- Font sizes tự động scale theo breakpoints
- Word wrapping cho long titles
- Hyphens tự động
- Letter spacing điều chỉnh

### 10. Accessibility
- Focus visible improvements
- Touch target sizes đạt chuẩn
- High contrast mode support
- Smooth scroll behavior
- Reduced motion support

### 11. Performance
- Scrollbar customization giữ nhất quán
- Transitions mượt mà
- Print styles optimization
- Overflow handling tốt hơn

## Testing Checklist
✅ Desktop (1920x1080): Layout chuẩn
✅ Tablet Portrait (768x1024): Sidebar stacked, readable
✅ Tablet Landscape (1024x768): Compact layout
✅ Mobile Portrait (375x667): Full-width, touch-friendly
✅ Mobile Landscape (667x375): Compact, usable
✅ Small Mobile (320x568): Ultra compact, functional

## Browser Support
- ✅ Chrome/Edge (WebKit scrollbar styles)
- ✅ Firefox (scrollbar-color)
- ✅ Safari (iOS touch optimizations)
- ✅ Samsung Internet
- ✅ Opera Mobile

## Các tính năng bổ sung
1. **Print Styles**: Ẩn navigation, footer, buttons khi in
2. **High Contrast**: Tăng border width cho visibility
3. **Reduced Motion**: Respect user preferences
4. **Touch Feedback**: Active states cho touch devices

## Cách kiểm tra
1. Mở DevTools (F12)
2. Toggle Device Toolbar (Ctrl+Shift+M)
3. Test các breakpoints:
   - iPhone SE (375x667)
   - iPad (768x1024)
   - iPad Pro (1024x1366)
   - Desktop (1920x1080)
4. Test landscape/portrait modes
5. Test touch simulation

## Notes
- Tất cả styles sử dụng `@media` queries chuẩn
- Font family "Press Start 2P" được giữ nguyên cho pixel aesthetic
- Colors scheme không thay đổi, chỉ spacing và sizing
- Backward compatible với desktop layout
