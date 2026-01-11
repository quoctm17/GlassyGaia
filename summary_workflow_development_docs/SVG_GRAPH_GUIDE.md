# SVG Graph Implementation Guide

## Tổng quan

Tài liệu này giải thích chi tiết cách implement và làm việc với SVG Graph trong PortfolioPage. Graph này được sử dụng để hiển thị dữ liệu XP hàng tháng của user dưới dạng line chart.

## 1. Công nghệ sử dụng

- **SVG (Scalable Vector Graphics)**: HTML thuần, không dùng Tailwind hay Bootstrap
- **React/JavaScript**: Render động và xử lý tương tác
- **CSS thuần**: Styling (một số dùng CSS variables)

## 2. Cấu trúc cơ bản

### 2.1. Thẻ SVG chính

```jsx
<svg 
  width="100%"           // Chiều rộng = 100% container
  height="100%"          // Chiều cao = 100% container
  viewBox="40 -20 1000 270"  // Hệ tọa độ ảo (x y width height)
  preserveAspectRatio="none"  // Không giữ tỷ lệ, scale tự do
  style={{ position: 'absolute', top: 0, left: 0 }}
>
  {/* Các elements SVG */}
</svg>
```

#### Giải thích chi tiết các thuộc tính:

**`width="100%"`**
- **Mục đích**: Đặt chiều rộng của SVG = 100% container
- **Giá trị**: `"100%"` hoặc `"500px"` (pixel cụ thể)
- **Ví dụ thực tế**: 
  - Nếu container = 800px → SVG = 800px
  - Nếu container = 1200px → SVG = 1200px
- **Thay đổi**: `width="80%"` → SVG sẽ nhỏ hơn, có margin 2 bên

**`height="100%"`**
- **Mục đích**: Đặt chiều cao của SVG = 100% container
- **Giá trị**: `"100%"` hoặc `"250px"`
- **Ví dụ thực tế**:
  - Container height = 250px → SVG = 250px
- **Thay đổi**: `height="200px"` → SVG sẽ thấp hơn, có thể bị cắt

**`viewBox="40 -20 1000 270"`**
- **Mục đích**: Định nghĩa hệ tọa độ ảo bên trong SVG
- **Cú pháp**: `"x y width height"`
  - `x="40"`: Offset trái (padding trái trong hệ tọa độ ảo)
  - `y="-20"`: Offset trên (padding trên, số âm = lên trên)
  - `width="1000"`: Chiều rộng vùng vẽ trong hệ tọa độ ảo
  - `height="270"`: Chiều cao vùng vẽ trong hệ tọa độ ảo
- **Ví dụ thực tế**:
  - Tọa độ `(40, 200)` trong viewBox sẽ map vào góc dưới trái của vùng vẽ
  - Tọa độ `(1040, 200)` sẽ map vào góc dưới phải
  - Tọa độ `(540, 0)` sẽ map vào giữa trên
- **Thay đổi và tác động**:
  - `viewBox="60 -20 880 270"` → Graph thu hẹp hơn (padding trái tăng, width giảm)
  - `viewBox="40 -30 1000 280"` → Graph cao hơn (padding trên tăng, height tăng)
  - `viewBox="0 0 1000 270"` → Không có padding, graph sẽ sát 2 bên và trên

**`preserveAspectRatio="none"`**
- **Mục đích**: Cho phép SVG scale không giữ tỷ lệ
- **Giá trị có thể**:
  - `"none"`: Scale tự do, không giữ tỷ lệ
  - `"xMidYMid meet"`: Giữ tỷ lệ, fit vào container
  - `"xMidYMid slice"`: Giữ tỷ lệ, fill container (có thể cắt)
- **Ví dụ thực tế**:
  - `"none"`: Container 800x250 → SVG scale thành 800x250 (có thể méo)
  - `"xMidYMid meet"`: Container 800x250 → SVG giữ tỷ lệ, có thể có khoảng trống
- **Thay đổi**: Dùng `"xMidYMid meet"` nếu muốn graph không bị méo khi resize

**`style={{ position: 'absolute', top: 0, left: 0 }}`**
- **Mục đích**: Đặt SVG absolute để overlay lên container
- **Ví dụ thực tế**: SVG sẽ nằm chính xác ở góc trên trái của container

## 3. Các Elements SVG được sử dụng

### 3.1. `<line>` - Vẽ đường thẳng (Grid lines)

```jsx
<line 
  x1="40"        // Điểm bắt đầu X (trái)
  y1={y * 2}     // Điểm bắt đầu Y (trên)
  x2="1040"      // Điểm kết thúc X (phải)
  y2={y * 2}     // Điểm kết thúc Y (dưới)
  stroke="var(--neutral)"  // Màu đường
  strokeWidth="0.5"        // Độ dày
  opacity="0.3"            // Độ trong suốt
/>
```

#### Giải thích chi tiết:

**`x1="40"`**
- **Mục đích**: Tọa độ X của điểm bắt đầu
- **Giá trị**: Số trong hệ tọa độ viewBox
- **Ví dụ thực tế**: 
  - `x1="40"` → Đường bắt đầu từ padding trái (40px trong hệ tọa độ ảo)
  - `x1="0"` → Đường bắt đầu từ mép trái (sẽ bị cắt)
- **Thay đổi**: `x1="60"` → Đường sẽ bắt đầu xa mép trái hơn

**`y1={y * 2}`**
- **Mục đích**: Tọa độ Y của điểm bắt đầu
- **Giá trị**: Tính toán động
- **Ví dụ thực tế**:
  - `y = 0` → `y1 = 0` (đỉnh graph)
  - `y = 25` → `y1 = 50` (1/4 từ đỉnh)
  - `y = 50` → `y1 = 100` (giữa graph)
  - `y = 100` → `y1 = 200` (đáy graph)
- **Thay đổi**: `y1={y * 2.5}` → Khoảng cách giữa các đường grid lớn hơn

**`x2="1040"`**
- **Mục đích**: Tọa độ X của điểm kết thúc
- **Ví dụ thực tế**: 
  - `x2="1040"` → Đường kết thúc ở padding phải (40 + 1000 = 1040)
  - `x2="1000"` → Đường sẽ ngắn hơn, không đến mép phải
- **Thay đổi**: `x2="960"` → Đường ngắn hơn, có margin phải

**`y2={y * 2}`**
- **Mục đích**: Tọa độ Y của điểm kết thúc (thường = y1 cho đường ngang)
- **Ví dụ**: Giống y1

**`stroke="var(--neutral)"`**
- **Mục đích**: Màu của đường
- **Giá trị**: CSS color hoặc CSS variable
- **Ví dụ thực tế**:
  - `stroke="var(--neutral)"` → Màu xám (#9E9E9E)
  - `stroke="#FF0000"` → Màu đỏ
  - `stroke="rgba(0,0,0,0.3)"` → Đen với opacity
- **Thay đổi**: `stroke="var(--primary)"` → Đường sẽ có màu hồng

**`strokeWidth="0.5"`**
- **Mục đích**: Độ dày của đường
- **Giá trị**: Số (pixel trong hệ tọa độ ảo)
- **Ví dụ thực tế**:
  - `strokeWidth="0.5"` → Đường mỏng, nhẹ nhàng
  - `strokeWidth="1"` → Đường dày hơn, rõ hơn
  - `strokeWidth="2"` → Đường rất dày, nổi bật
- **Thay đổi**: `strokeWidth="1"` → Grid lines sẽ rõ hơn

**`opacity="0.3"`**
- **Mục đích**: Độ trong suốt (0 = trong suốt, 1 = đục)
- **Ví dụ thực tế**:
  - `opacity="0.3"` → 30% đục, 70% trong suốt (nhẹ nhàng)
  - `opacity="0.5"` → 50% đục (rõ hơn)
  - `opacity="1"` → Hoàn toàn đục (rất rõ)
- **Thay đổi**: `opacity="0.5"` → Grid lines sẽ rõ hơn, có thể làm graph rối

#### Ví dụ thực tế trong code:

```jsx
{[0, 25, 50, 75, 100].map((y) => (
  <line 
    key={y} 
    x1="40" 
    y1={y * 2}      // 0, 50, 100, 150, 200
    x2="1040" 
    y2={y * 2} 
    stroke="var(--neutral)" 
    strokeWidth="0.5" 
    opacity="0.3" 
  />
))}
```

**Kết quả**: Tạo 5 đường grid ngang ở các vị trí:
- Y = 0 (đỉnh)
- Y = 50 (1/4 từ đỉnh)
- Y = 100 (giữa)
- Y = 150 (3/4 từ đỉnh)
- Y = 200 (đáy)

### 3.2. `<polygon>` - Vẽ đa giác (Vùng tô màu dưới line)

```jsx
<polygon
  points={`40,200 ${xpProgressData.map((value, i) => {
    const x = 40 + (i / (dateLabels.length - 1)) * 1000;
    const y = 200 - (value * scaleFactor);
    return `${x},${y}`;
  }).join(' ')},1040,200`}
  fill="var(--primary)"
  opacity="0.2"
/>
```

#### Giải thích chi tiết:

**`points="..."`**
- **Mục đích**: Danh sách các điểm tạo thành đa giác
- **Cú pháp**: `"x1,y1 x2,y2 x3,y3 ..."`
- **Ví dụ thực tế**:
  - `points="40,200 540,100 1040,200"` → Tam giác
  - `points="40,200 100,150 200,100 300,120 400,180 1040,200"` → Đa giác phức tạp
- **Trong code**:
  - Bắt đầu: `40,200` (góc dưới trái)
  - Các điểm trên line: `540,100`, `640,80`, ... (từ data)
  - Kết thúc: `1040,200` (góc dưới phải)
- **Thay đổi**: Thêm điểm ở giữa sẽ tạo hình dạng phức tạp hơn

**`fill="var(--primary)"`**
- **Mục đích**: Màu tô bên trong đa giác
- **Ví dụ thực tế**:
  - `fill="var(--primary)"` → Màu hồng (#FDAAAA)
  - `fill="rgba(253, 170, 170, 0.2)"` → Tương đương với opacity
  - `fill="none"` → Không tô màu
- **Thay đổi**: `fill="var(--secondary)"` → Màu be (#F2EDE5)

**`opacity="0.2"`**
- **Mục đích**: Độ trong suốt của vùng tô
- **Ví dụ thực tế**:
  - `opacity="0.2"` → 20% đục, nhẹ nhàng
  - `opacity="0.5"` → 50% đục, rõ hơn
  - `opacity="1"` → Hoàn toàn đục, che mất line
- **Thay đổi**: `opacity="0.3"` → Vùng tô sẽ rõ hơn

#### Ví dụ thực tế với data:

Giả sử có 5 ngày với XP: `[0, 100, 500, 200, 0]`

```javascript
// Tính toán:
// Day 0: x = 40 + (0/4) * 1000 = 40, y = 200 - (0 * 0.4) = 200
// Day 1: x = 40 + (1/4) * 1000 = 290, y = 200 - (100 * 0.4) = 160
// Day 2: x = 40 + (2/4) * 1000 = 540, y = 200 - (500 * 0.4) = 0
// Day 3: x = 40 + (3/4) * 1000 = 790, y = 200 - (200 * 0.4) = 120
// Day 4: x = 40 + (4/4) * 1000 = 1040, y = 200 - (0 * 0.4) = 200

// points = "40,200 290,160 540,0 790,120 1040,200"
```

**Kết quả**: Tạo vùng tô màu hình dạng đồi, cao nhất ở giữa (ngày 2).

### 3.3. `<polyline>` - Vẽ đường gấp khúc (Line chính)

```jsx
<polyline
  points={xpProgressData.map((value, i) => {
    const x = 40 + (i / (dateLabels.length - 1)) * 1000;
    const y = 200 - (value * scaleFactor);
    return `${x},${y}`;
  }).join(' ')}
  fill="none"
  stroke="var(--primary)"
  strokeWidth="1.5"
/>
```

#### Giải thích chi tiết:

**`points={...}`**
- **Mục đích**: Danh sách các điểm tạo đường gấp khúc
- **Khác với polygon**: Không tự động đóng kín (không nối điểm cuối về điểm đầu)
- **Ví dụ thực tế**:
  - `points="40,200 290,160 540,0 790,120 1040,200"` → Đường nối 5 điểm
- **Thay đổi**: Thêm/bớt điểm sẽ thay đổi hình dạng đường

**`fill="none"`**
- **Mục đích**: Không tô màu bên trong (vì là đường, không phải hình)
- **Ví dụ**: `fill="red"` → Sẽ không có tác dụng với polyline

**`stroke="var(--primary)"`**
- **Mục đích**: Màu của đường
- **Ví dụ thực tế**:
  - `stroke="var(--primary)"` → Màu hồng (#FDAAAA)
  - `stroke="#000000"` → Màu đen
  - `stroke="rgba(0,0,0,0.5)"` → Đen 50% opacity
- **Thay đổi**: `stroke="var(--hover-select)"` → Màu đỏ đậm (#AA3F55)

**`strokeWidth="1.5"`**
- **Mục đích**: Độ dày của đường
- **Ví dụ thực tế**:
  - `strokeWidth="1.5"` → Đường vừa phải, rõ ràng
  - `strokeWidth="2"` → Đường dày hơn, nổi bật
  - `strokeWidth="1"` → Đường mỏng hơn, tinh tế
- **Thay đổi**: `strokeWidth="2"` → Line sẽ dày và nổi bật hơn

#### Ví dụ thực tế:

Với cùng data `[0, 100, 500, 200, 0]`:
- Tạo đường nối các điểm: (40,200) → (290,160) → (540,0) → (790,120) → (1040,200)
- Kết quả: Đường line có đỉnh ở giữa (ngày 2)

### 3.4. `<rect>` - Vẽ hình chữ nhật (Data points - Dots)

```jsx
<rect 
  x={x - 2.5}              // Vị trí X (trừ 2.5 để center)
  y={y - 2.5}              // Vị trí Y (trừ 2.5 để center)
  width="5"                // Chiều rộng
  height="5"               // Chiều cao
  fill="var(--chart-dot-fill)"      // Màu fill
  stroke="var(--chart-dot-stroke)"  // Màu viền
  strokeWidth="0.8"        // Độ dày viền
  style={{ cursor: 'pointer' }}
  onMouseEnter={...}
  onMouseMove={...}
  onMouseLeave={...}
/>
```

#### Giải thích chi tiết:

**`x={x - 2.5}`**
- **Mục đích**: Tọa độ X của góc trên trái hình chữ nhật
- **Tại sao trừ 2.5**: Để center dot tại điểm (x, y)
  - Nếu `width="5"` → center = `x - 5/2 = x - 2.5`
- **Ví dụ thực tế**:
  - Điểm data ở `(540, 0)` → `x = 540 - 2.5 = 537.5`
  - Dot sẽ có góc trên trái ở `(537.5, -2.5)`, center ở `(540, 0)`
- **Thay đổi**: 
  - `x={x - 3}` với `width="6"` → Dot lớn hơn, vẫn center
  - `x={x}` → Dot sẽ lệch sang phải

**`y={y - 2.5}`**
- **Mục đích**: Tọa độ Y của góc trên trái
- **Tương tự x**: Trừ để center
- **Ví dụ**: Điểm `(540, 0)` → `y = 0 - 2.5 = -2.5`

**`width="5"`**
- **Mục đích**: Chiều rộng của dot
- **Ví dụ thực tế**:
  - `width="5"` → Dot nhỏ, tinh tế
  - `width="8"` → Dot lớn hơn, dễ click hơn
  - `width="10"` → Dot rất lớn, có thể che mất line
- **Thay đổi**: `width="6"` → Dot lớn hơn, cần điều chỉnh `x={x - 3}`

**`height="5"`**
- **Mục đích**: Chiều cao của dot
- **Ví dụ**: Thường = width để tạo hình vuông
- **Thay đổi**: `height="8"` với `width="5"` → Tạo hình chữ nhật dọc

**`fill="var(--chart-dot-fill)"`**
- **Mục đích**: Màu tô bên trong
- **Giá trị**: `#F2EDE5` (màu be nhạt)
- **Ví dụ thực tế**:
  - `fill="var(--chart-dot-fill)"` → Màu be
  - `fill="var(--primary)"` → Màu hồng
  - `fill="transparent"` → Trong suốt, chỉ thấy viền
- **Thay đổi**: `fill="var(--primary)"` → Dot sẽ có màu hồng

**`stroke="var(--chart-dot-stroke)"`**
- **Mục đích**: Màu viền
- **Giá trị**: `#000000` (màu đen)
- **Ví dụ thực tế**:
  - `stroke="var(--chart-dot-stroke)"` → Viền đen
  - `stroke="var(--primary)"` → Viền hồng
  - `stroke="none"` → Không có viền
- **Thay đổi**: `stroke="var(--primary)"` → Viền sẽ có màu hồng

**`strokeWidth="0.8"`**
- **Mục đích**: Độ dày viền
- **Ví dụ thực tế**:
  - `strokeWidth="0.8"` → Viền mỏng, tinh tế
  - `strokeWidth="1.5"` → Viền dày hơn, rõ hơn
  - `strokeWidth="2"` → Viền rất dày, có thể làm dot trông lớn hơn
- **Thay đổi**: `strokeWidth="1.5"` → Viền sẽ rõ và dày hơn

**`style={{ cursor: 'pointer' }}`**
- **Mục đích**: Thay đổi con trỏ chuột khi hover
- **Ví dụ**: Con trỏ thành bàn tay, báo hiệu có thể click

**`onMouseEnter`, `onMouseMove`, `onMouseLeave`**
- **Mục đích**: Xử lý sự kiện hover để hiển thị tooltip
- **Ví dụ thực tế**:
  ```jsx
  onMouseEnter={(e) => {
    // e.clientX, e.clientY = vị trí chuột trên màn hình
    tooltip.style.left = `${e.clientX + 10}px`;  // Cách chuột 10px phải
    tooltip.style.top = `${e.clientY - 30}px`;   // Cách chuột 30px trên
    tooltip.style.display = 'block';
  }}
  ```

#### Ví dụ thực tế:

Với điểm data ở `(540, 0)` (giữa graph, đỉnh):
- `x = 540 - 2.5 = 537.5`
- `y = 0 - 2.5 = -2.5`
- Dot sẽ là hình vuông 5x5, center tại `(540, 0)`

### 3.5. `<line>` - Vẽ đường thẳng (Thanh Today)

```jsx
<line 
  x1={x}                   // X bắt đầu (cùng vị trí với ngày)
  y1="0"                   // Y bắt đầu (đỉnh)
  x2={x}                   // X kết thúc (cùng vị trí)
  y2="200"                 // Y kết thúc (đáy graph)
  stroke="var(--hover-select)"  // Màu
  strokeWidth="1.5"        // Độ dày
/>
```

#### Giải thích chi tiết:

**`x1={x}` và `x2={x}`**
- **Mục đích**: Cùng giá trị để tạo đường thẳng đứng
- **Ví dụ thực tế**:
  - Nếu `x = 540` (giữa tháng) → Đường thẳng đứng ở giữa
  - Nếu `x = 40` (đầu tháng) → Đường ở bên trái
  - Nếu `x = 1040` (cuối tháng) → Đường ở bên phải
- **Thay đổi**: `x1={x - 5}, x2={x + 5}` → Đường sẽ nghiêng

**`y1="0"`**
- **Mục đích**: Điểm bắt đầu ở đỉnh graph
- **Ví dụ**: Trong viewBox, `y=0` là đỉnh (sau khi trừ offset -20)

**`y2="200"`**
- **Mục đích**: Điểm kết thúc ở đáy graph
- **Ví dụ**: Trong viewBox, `y=200` là đáy của vùng vẽ

**`stroke="var(--hover-select)"`**
- **Mục đích**: Màu đỏ đậm (#AA3F55) để nổi bật
- **Thay đổi**: `stroke="var(--primary)"` → Màu hồng nhạt hơn

**`strokeWidth="1.5"`**
- **Mục đích**: Độ dày vừa phải, rõ ràng
- **Thay đổi**: `strokeWidth="2"` → Đường dày hơn, nổi bật hơn

#### Ví dụ thực tế:

Nếu hôm nay là ngày 15 trong tháng 31 ngày:
- `x = 40 + (14/30) * 1000 = 506.67` (ngày 15 = index 14)
- Đường thẳng đứng sẽ ở vị trí xấp xỉ giữa graph

### 3.6. `<text>` - Vẽ text (Date labels và "Today")

```jsx
<text 
  x={x}                    // Vị trí X (center của ngày)
  y="240"                  // Vị trí Y (dưới graph)
  textAnchor="middle"      // Căn giữa text
  className="portfolio-graph-date-label"  // CSS class
  fill={date.isToday ? "var(--hover-select)" : "var(--text)"}
>
  {date.label}             // Nội dung text
</text>
```

#### Giải thích chi tiết:

**`x={x}`**
- **Mục đích**: Vị trí X của text (thường center với điểm data)
- **Ví dụ thực tế**:
  - `x={540}` → Text ở giữa graph
  - `x={40}` → Text ở bên trái
- **Thay đổi**: `x={x + 5}` → Text sẽ lệch sang phải 5px

**`y="240"`**
- **Mục đích**: Vị trí Y của text (dưới graph)
- **Ví dụ thực tế**:
  - `y="240"` → Text cách đáy graph (y=200) khoảng 40px
  - `y="250"` → Text xa graph hơn
  - `y="230"` → Text gần graph hơn
- **Thay đổi**: `y="250"` → Khoảng cách giữa labels và graph lớn hơn

**`textAnchor="middle"`**
- **Mục đích**: Căn text theo điểm x
- **Giá trị có thể**:
  - `"middle"`: Căn giữa (text center tại x)
  - `"start"`: Căn trái (text bắt đầu tại x)
  - `"end"`: Căn phải (text kết thúc tại x)
- **Ví dụ thực tế**:
  - `textAnchor="middle"` với `x={540}` → "Jan 15" sẽ center tại 540
  - `textAnchor="start"` với `x={540}` → "Jan 15" sẽ bắt đầu tại 540 (lệch phải)
- **Thay đổi**: `textAnchor="start"` → Text sẽ lệch sang phải

**`className="portfolio-graph-date-label"`**
- **Mục đích**: Áp dụng CSS styling
- **CSS tương ứng**:
  ```css
  .portfolio-graph-date-label {
    font-family: 'Noto Sans', sans-serif;
    font-size: 11px;
    font-weight: 400;
    fill: var(--text);
  }
  ```
- **Thay đổi**: Thay đổi trong CSS sẽ ảnh hưởng đến tất cả labels

**`fill="..."`**
- **Mục đích**: Màu của text
- **Ví dụ thực tế**:
  - `fill="var(--text)"` → Màu text mặc định (đen/trắng tùy theme)
  - `fill="var(--hover-select)"` → Màu đỏ đậm (cho ngày hôm nay)
  - `fill="#FF0000"` → Màu đỏ cụ thể
- **Thay đổi**: `fill="var(--primary)"` → Text sẽ có màu hồng

#### Ví dụ thực tế:

Với ngày 15 ở giữa tháng:
- `x={540}`, `y="240"`, `textAnchor="middle"`
- Text "Jan 15" sẽ hiển thị ở giữa graph, cách đáy 40px

## 4. Cách tính toán tọa độ

### 4.1. Tính X (vị trí ngang)

**Công thức chung:**
```javascript
const x = startX + (index / (totalItems - 1)) * width
```

**Trong code:**
```javascript
const x = 40 + (i / (dateLabels.length - 1)) * 1000
```

**Giải thích:**
- `startX = 40`: Padding trái (từ viewBox)
- `i`: Index hiện tại (0, 1, 2, ..., 30)
- `dateLabels.length - 1`: Tổng số khoảng cách (31 ngày = 30 khoảng)
- `1000`: Chiều rộng vùng vẽ (từ viewBox width)
- **Kết quả**: x sẽ từ 40 đến 1040

**Ví dụ thực tế với 31 ngày:**
- Ngày 1 (i=0): `x = 40 + (0/30) * 1000 = 40`
- Ngày 16 (i=15): `x = 40 + (15/30) * 1000 = 540` (giữa)
- Ngày 31 (i=30): `x = 40 + (30/30) * 1000 = 1040`

**Thay đổi và tác động:**
- Tăng padding: `x = 60 + (i / (dateLabels.length - 1)) * 1000`
  - Ngày 1: `x = 60` (xa mép trái hơn)
  - Ngày 31: `x = 1060` (có thể bị cắt)
- Giảm width: `x = 40 + (i / (dateLabels.length - 1)) * 880`
  - Ngày 1: `x = 40`
  - Ngày 31: `x = 920` (graph thu hẹp hơn)

### 4.2. Tính Y (vị trí dọc)

**Công thức:**
```javascript
const y = baseY - (value * scaleFactor)
```

**Trong code:**
```javascript
const y = 200 - (value * scaleFactor)
```

**Giải thích:**
- `baseY = 200`: Đáy của graph trong viewBox
- `value`: Giá trị XP từ database
- `scaleFactor`: Hệ số scale để fit vào khoảng 0-200
- **Kết quả**: Giá trị cao hơn sẽ ở trên (y nhỏ hơn)

**Ví dụ thực tế:**
Giả sử `maxXP = 1000`, `scaleFactor = 200/1000 = 0.2`:
- XP = 0: `y = 200 - (0 * 0.2) = 200` (đáy)
- XP = 500: `y = 200 - (500 * 0.2) = 100` (giữa)
- XP = 1000: `y = 200 - (1000 * 0.2) = 0` (đỉnh)

**Thay đổi và tác động:**
- Thay đổi baseY: `y = 180 - (value * scaleFactor)`
  - Graph sẽ thấp hơn (đáy ở y=180 thay vì 200)
- Thay đổi scaleFactor: `scaleFactor = 150 / maxXP`
  - Graph sẽ thấp hơn (max value chỉ lên đến y=50 thay vì 0)

### 4.3. Scale Factor

**Công thức:**
```javascript
const maxXP = Math.max(...xpProgressData, 1);
const scaleFactor = maxXP > 0 ? 200 / maxXP : 1;
```

**Giải thích:**
- Tìm giá trị lớn nhất trong data
- Tính scale factor để giá trị lớn nhất map vào y=0 (đỉnh)
- `200` là chiều cao vùng vẽ (từ baseY=200 đến y=0)

**Ví dụ thực tế:**
- Data: `[0, 100, 500, 200, 0]`
- `maxXP = 500`
- `scaleFactor = 200 / 500 = 0.4`
- Tính y:
  - 0 XP → y = 200
  - 100 XP → y = 200 - (100 * 0.4) = 160
  - 500 XP → y = 200 - (500 * 0.4) = 0 (đỉnh)
  - 200 XP → y = 200 - (200 * 0.4) = 120

**Thay đổi và tác động:**
- Nếu data mới có maxXP = 2000:
  - `scaleFactor = 200 / 2000 = 0.1`
  - Graph sẽ tự động scale, giá trị 2000 sẽ ở đỉnh
- Nếu muốn graph thấp hơn: `scaleFactor = 150 / maxXP`
  - Max value sẽ chỉ lên đến y=50

## 5. Data Flow từ Database

### 5.1. Bước 1: Fetch từ API

**Code:**
```javascript
// Trong useEffect (dòng 108-127)
const data = await apiGetMonthlyXP(user.uid, currentMonth.year, currentMonth.month);
setMonthlyXPData(data);
```

**API Response:**
```json
[
  { "date": "2026-01-01", "xp_earned": 0 },
  { "date": "2026-01-02", "xp_earned": 150 },
  { "date": "2026-01-03", "xp_earned": 200 },
  { "date": "2026-01-04", "xp_earned": 0 },
  ...
]
```

**Backend Query (worker.js):**
```sql
SELECT stats_date, xp_earned
FROM user_daily_stats
WHERE user_id = ? 
  AND stats_date >= ? 
  AND stats_date <= ?
ORDER BY stats_date ASC
```

### 5.2. Bước 2: Transform Data

**Code:**
```javascript
const xpProgressData = useMemo(() => {
  if (monthlyXPData.length === 0) return [];
  return monthlyXPData.map(item => item.xp_earned || 0);
}, [monthlyXPData]);
```

**Kết quả:**
```javascript
[0, 150, 200, 0, 100, 500, 200, 0, ...]
```

### 5.3. Bước 3: Tính Scale Factor

**Code:**
```javascript
const maxXP = Math.max(...xpProgressData, 1);
const scaleFactor = maxXP > 0 ? 200 / maxXP : 1;
```

**Ví dụ:**
- Data: `[0, 150, 200, 0, 100, 500, 200, 0]`
- `maxXP = 500`
- `scaleFactor = 200 / 500 = 0.4`

### 5.4. Bước 4: Generate Date Labels

**Code:**
```javascript
const dateLabels = useMemo(() => {
  const year = currentMonth.year;
  const month = currentMonth.month;
  const daysInMonth = new Date(year, month, 0).getDate();
  
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const date = new Date(year, month - 1, day);
    const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
    return { 
      label: `${monthStr} ${day}`,  // "Jan 1", "Jan 2", ...
      day: day,
      date: date
    };
  });
}, [currentMonth]);
```

**Kết quả:**
```javascript
[
  { label: "Jan 1", day: 1, date: Date(...) },
  { label: "Jan 2", day: 2, date: Date(...) },
  ...
]
```

### 5.5. Bước 5: Render vào SVG

**Code:**
```jsx
<polyline
  points={xpProgressData.map((value, i) => {
    const x = 40 + (i / (dateLabels.length - 1)) * 1000;
    const y = 200 - (value * scaleFactor);
    return `${x},${y}`;
  }).join(' ')}
/>
```

**Ví dụ với data `[0, 150, 200, 0]` (4 ngày):**
- Day 0: x = 40, y = 200 → `"40,200"`
- Day 1: x = 373.33, y = 140 → `"373.33,140"`
- Day 2: x = 706.67, y = 120 → `"706.67,120"`
- Day 3: x = 1040, y = 200 → `"1040,200"`
- **points = "40,200 373.33,140 706.67,120 1040,200"**

## 6. Tooltip Implementation

### 6.1. HTML Tooltip Element

```jsx
<div
  id="xp-chart-tooltip"
  style={{
    display: 'none',           // Ẩn mặc định
    position: 'fixed',         // Fixed để theo chuột
    background: 'var(--background)',
    border: '2px solid var(--chart-dot-stroke)',
    borderRadius: '4px',
    padding: '8px 12px',
    fontFamily: "'Noto Sans', sans-serif",
    fontSize: '14px',
    color: 'var(--text)',
    pointerEvents: 'none',     // Không chặn click
    zIndex: 10000,             // Luôn ở trên cùng
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
  }}
/>
```

### 6.2. Event Handlers

**onMouseEnter:**
```jsx
onMouseEnter={(e) => {
  const tooltip = document.getElementById('xp-chart-tooltip');
  if (tooltip) {
    tooltip.textContent = `${monthStr} ${day}: ${value.toLocaleString()} XP`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${e.clientX + 10}px`;  // Cách chuột 10px phải
    tooltip.style.top = `${e.clientY - 30}px`;   // Cách chuột 30px trên
  }
}}
```

**Ví dụ thực tế:**
- Chuột ở `(500, 300)` trên màn hình
- Tooltip sẽ hiển thị ở `(510, 270)`
- Nội dung: "Jan 15: 1,500 XP"

**onMouseMove:**
```jsx
onMouseMove={(e) => {
  const tooltip = document.getElementById('xp-chart-tooltip');
  if (tooltip) {
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY - 30}px`;
  }
}}
```

**Mục đích**: Cập nhật vị trí tooltip khi di chuyển chuột (tooltip luôn theo chuột)

**onMouseLeave:**
```jsx
onMouseLeave={() => {
  const tooltip = document.getElementById('xp-chart-tooltip');
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}}
```

**Mục đích**: Ẩn tooltip khi rời chuột khỏi dot

## 7. Điều chỉnh kích thước và vị trí

### 7.1. Container Size

**CSS:**
```css
.portfolio-graph-placeholder {
  height: 250px;  /* Chiều cao container */
  width: 100%;    /* Chiều rộng = 100% parent */
}
```

**Thay đổi:**
- `height: 300px` → Graph cao hơn, có thể thấy rõ hơn
- `height: 200px` → Graph thấp hơn, compact hơn

### 7.2. ViewBox Adjustment

**Hiện tại:**
```jsx
viewBox="40 -20 1000 270"
```

**Giải thích:**
- `40`: Padding trái (40px trong hệ tọa độ ảo)
- `-20`: Padding trên (20px lên trên)
- `1000`: Chiều rộng vùng vẽ
- `270`: Chiều cao vùng vẽ

**Thay đổi và tác động:**

**Thu hẹp graph:**
```jsx
viewBox="60 -20 880 270"
```
- Padding trái tăng: `40 → 60` (20px thêm)
- Width giảm: `1000 → 880` (120px ít hơn)
- **Kết quả**: Graph thu hẹp, có margin 2 bên lớn hơn

**Tăng chiều cao:**
```jsx
viewBox="40 -30 1000 280"
```
- Padding trên tăng: `-20 → -30` (10px thêm)
- Height tăng: `270 → 280` (10px thêm)
- **Kết quả**: Graph cao hơn, có thể chứa date labels tốt hơn

**Không có padding:**
```jsx
viewBox="0 0 1000 270"
```
- **Kết quả**: Graph sát 2 bên và trên, có thể bị cắt

### 7.3. Dot Size Adjustment

**Hiện tại:**
```jsx
width="5"
height="5"
x={x - 2.5}
y={y - 2.5}
```

**Thay đổi:**

**Dot lớn hơn:**
```jsx
width="8"
height="8"
x={x - 4}  // 8/2 = 4
y={y - 4}
```
- **Kết quả**: Dot lớn hơn, dễ click hơn, nhưng có thể che line

**Dot nhỏ hơn:**
```jsx
width="4"
height="4"
x={x - 2}  // 4/2 = 2
y={y - 2}
```
- **Kết quả**: Dot nhỏ hơn, tinh tế hơn, nhưng khó click

**Dot hình chữ nhật:**
```jsx
width="6"
height="4"
x={x - 3}  // 6/2 = 3
y={y - 2}  // 4/2 = 2
```
- **Kết quả**: Dot hình chữ nhật ngang

### 7.4. Font Size Adjustment

**CSS:**
```css
.portfolio-graph-date-label {
  font-size: 11px;
}
```

**Thay đổi:**
- `font-size: 12px` → Text lớn hơn, dễ đọc hơn
- `font-size: 10px` → Text nhỏ hơn, compact hơn
- `font-size: 9px` → Text rất nhỏ, có thể khó đọc

### 7.5. Date Label Position

**Hiện tại:**
```jsx
y="240"
```

**Thay đổi:**
- `y="250"` → Labels xa graph hơn (10px thêm)
- `y="230"` → Labels gần graph hơn (10px ít hơn)
- `y="260"` → Labels rất xa graph

## 8. Tips và Best Practices

### 8.1. Tính toán tọa độ

**Luôn nhớ:**
- X tăng từ trái sang phải (0 → 1000)
- Y tăng từ trên xuống dưới (0 → 270)
- Trong SVG, y=0 là đỉnh, y lớn hơn = xuống dưới

### 8.2. Scale Factor

**Luôn tính scale factor dựa trên max value:**
```javascript
const maxValue = Math.max(...data, 1);
const scaleFactor = graphHeight / maxValue;
```

### 8.3. Padding

**Luôn thêm padding trong viewBox:**
- Tránh elements bị cắt ở mép
- Tạo không gian cho labels và tooltips

### 8.4. Performance

**Sử dụng useMemo cho tính toán:**
```javascript
const processedData = useMemo(() => {
  // Tính toán phức tạp
}, [dependencies]);
```

### 8.5. Responsive

**ViewBox tự động scale:**
- `width="100%"` và `height="100%"` → SVG tự scale theo container
- ViewBox giữ nguyên hệ tọa độ → Elements tự scale

## 9. Troubleshooting

### 9.1. Graph bị cắt 2 bên

**Nguyên nhân**: Padding trong viewBox không đủ
**Giải pháp**: Tăng padding trái/phải
```jsx
viewBox="60 -20 880 270"  // Tăng padding trái từ 40 → 60
```

### 9.2. Date labels bị che

**Nguyên nhân**: Height không đủ hoặc y position quá thấp
**Giải pháp**: 
- Tăng height trong viewBox: `270 → 280`
- Tăng y position: `y="240" → y="250"`

### 9.3. Dots không align với line

**Nguyên nhân**: Offset x, y không đúng
**Giải pháp**: Đảm bảo `x={x - width/2}` và `y={y - height/2}`

### 9.4. Graph quá nhỏ/lớn

**Nguyên nhân**: Container size hoặc viewBox không phù hợp
**Giải pháp**: Điều chỉnh CSS height hoặc viewBox

## 10. Tóm tắt các thuộc tính quan trọng

| Element | Thuộc tính | Mục đích | Ví dụ giá trị |
|---------|-----------|----------|---------------|
| `<svg>` | `viewBox` | Hệ tọa độ ảo | `"40 -20 1000 270"` |
| `<svg>` | `width` | Chiều rộng | `"100%"` |
| `<svg>` | `height` | Chiều cao | `"100%"` |
| `<line>` | `x1, y1, x2, y2` | Điểm bắt đầu/kết thúc | `x1="40" y1="0" x2="1040" y2="0"` |
| `<line>` | `stroke` | Màu đường | `"var(--neutral)"` |
| `<line>` | `strokeWidth` | Độ dày | `"0.5"` |
| `<polygon>` | `points` | Danh sách điểm | `"40,200 540,100 1040,200"` |
| `<polygon>` | `fill` | Màu tô | `"var(--primary)"` |
| `<polyline>` | `points` | Danh sách điểm | `"40,200 540,100 1040,200"` |
| `<polyline>` | `stroke` | Màu đường | `"var(--primary)"` |
| `<rect>` | `x, y` | Vị trí góc trên trái | `x={x-2.5} y={y-2.5}` |
| `<rect>` | `width, height` | Kích thước | `width="5" height="5"` |
| `<rect>` | `fill` | Màu tô | `"var(--chart-dot-fill)"` |
| `<rect>` | `stroke` | Màu viền | `"var(--chart-dot-stroke)"` |
| `<text>` | `x, y` | Vị trí | `x={x} y="240"` |
| `<text>` | `textAnchor` | Căn text | `"middle"` |
| `<text>` | `fill` | Màu text | `"var(--text)"` |

---

**Tài liệu này cung cấp hướng dẫn chi tiết về cách làm việc với SVG Graph. Nếu có thắc mắc hoặc cần giải thích thêm, vui lòng tham khảo code thực tế trong `src/pages/PortfolioPage.tsx`.**
