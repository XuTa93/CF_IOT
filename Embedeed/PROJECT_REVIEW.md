# 📋 Project Review — ESP32-S3 Temperature Monitor (JC4827W543)

> **Ngày review:** 2026-08-08  
> **Firmware build:** SUCCESS (RAM 80.3% / Flash 82.4%)  
> **Trạng thái:** Đang chạy giả lập — chưa kết nối cảm biến thực

---

## 📁 1. Cấu Trúc Dự Án

```
Embedeed/
├── platformio.ini              ← Cấu hình PlatformIO (ESP32-S3, LVGL 8.3, GT911)
├── HARDWARE_CONFIG.md          ← Tài liệu phần cứng (Pinout, QSPI, Touch, LVGL)
├── PROJECT_REVIEW.md           ← File này
├── lv_conf.h                  ← Cấu hình LVGL (LV_COLOR_DEPTH=32, LV_MEM_SIZE=128KB)
│
├── src/
│   ├── main.cpp               ← Entry point: Display, Touch, WiFi, Chart, Arc logic
│   ├── wifi_gui.h             ← Header WiFi Manager GUI
│   ├── wifi_gui.cpp           ← WiFi Modal Dialog + Virtual Keyboard (LVGL)
│   │
│   └── ui/                    ← SquareLine Studio Export (KHÔNG SỬA TRỰC TIẾP)
│       ├── ui.h               ← Header chính UI (khai báo Fonts, Screens)
│       ├── ui.c               ← ui_init(), theme, load screen
│       ├── ui_helpers.h/c     ← Utility helpers (SquareLine generated)
│       ├── ui_events.h        ← Event hooks (SquareLine generated)
│       ├── fonts/
│       │   ├── ui_font_Font1.c    ← Font chính (~211KB, dùng bởi ui_Temperture1)
│       │   └── ui_font_Font85.c   ← Font 85px (~190KB, chưa sử dụng)
│       └── screens/
│           ├── ui_Screen1.h       ← Khai báo widgets của Screen1
│           └── ui_Screen1.c       ← Layout Screen1 (SquareLine generated)
│
└── ui/                        ← Thư mục xuất gốc từ SquareLine (phải sync → src/ui/)
```

---

## 🖥 2. Kiến Trúc Phần Mềm

```
┌─────────────────────────────────────────────────────────┐
│                        loop()                           │
│                   lv_timer_handler()                    │
│                      delay(5)                           │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌─────────────┐ ┌──────────┐ ┌──────────────┐
   │  Display     │ │  Touch    │ │  LVGL Timer  │
   │  Flush       │ │  Read     │ │  Callbacks   │
   │  (QSPI →    │ │  (GT911   │ │              │
   │   NV3041A)  │ │   I2C)    │ │  • Chart 2s  │
   └─────────────┘ └──────────┘ │  • Arc events │
                                 └──────────────┘
```

### Luồng dữ liệu nhiệt độ:

```
Giả lập sin() ──► ui_Temperture1 (Label) ──► lv_label_get_text()
                       │                           │
                       ▼                           ▼
                  Hiển thị số               Chart1 (30 mẫu FIFO)
                  lớn trên LCD              cuộn mỗi 2 giây
```

---

## 🧩 3. Danh Sách Widgets (ui_Screen1)

| Widget | Loại | Vị trí | Chức năng |
|:---|:---|:---|:---|
| `ui_Temperture1` | Label | Center, Y+25% | Hiển thị nhiệt độ chính (Font lớn, Neon Green `#10F524`) |
| `ui_Chart1` | Chart | Center, Y-73 | Biểu đồ 30 mẫu, FIFO cuộn, 2s/mẫu |
| `ui_TemperatureMin` | Label | X:-171, Y:78 | Hiển thị giá trị Min (Font 48px, Blue `#7599F8`) |
| `ui_TemperatureMax` | Label | X:+175, Y:77 | Hiển thị giá trị Max (Font 48px, Yellow-Green `#B5EC3A`) |
| `ui_ArcMin` | Arc | X:-171, Y:78 | Thanh trượt xoay chỉnh Min (Range: 20–120) |
| `ui_ArcMax` | Arc | X:+176, Y:78 | Thanh trượt xoay chỉnh Max (Range: 40–140) |
| WiFi Icon 📶 | Button | Bottom-Mid, Y:0 | Nút trong suốt mở WiFi Manager (Cyan `#38BDF8`) |

---

## ⚙️ 4. Cấu Hình Runtime (trong `main.cpp`)

| Thành phần | Giá trị | Ghi chú |
|:---|:---|:---|
| **ArcMin Range** | 20 – 120 | Callback `arc_min_cb` → cập nhật `ui_TemperatureMin` |
| **ArcMax Range** | 40 – 140 | Callback `arc_max_cb` → cập nhật `ui_TemperatureMax` |
| **Chart1 Point Count** | 30 mẫu | FIFO Shift mode |
| **Chart1 Y Range** | 20 – 60°C | `LV_CHART_AXIS_PRIMARY_Y` |
| **Chart1 Sample Rate** | 2,000 ms | `lv_timer_create(temp_chart_timer_cb, 2000)` |
| **Chart1 Series Color** | `#10B981` | Xanh Lá Neon (1 series duy nhất) |
| **Background Color** | `#000000` | Đen tuyền (ép trong setup, ghi đè SquareLine) |
| **Touch Invert** | X=1, Y=1 | Lật cả 2 trục để khớp hướng màn hình |

---

## 🐛 5. Các Vấn Đề Phát Hiện

### 🔴 Lỗi Tiềm Ẩn (Bugs)

| # | File | Dòng | Mô tả | Mức độ |
|:--|:---|:---|:---|:---|
| 1 | `main.cpp` | ~95 | **Bug cú pháp trong `TOUCH_SWAP_XY`**: `int16_temp = x;` thiếu khoảng trắng và `_t`, phải là `int16_t temp = x;`. Hiện không lỗi vì `TOUCH_SWAP_XY` = 0 (bị tắt), nhưng sẽ **lỗi biên dịch ngay** nếu bật lên 1. | ⚠️ Trung bình |
| 2 | `main.cpp` | ~15 | **`ui_font_Font85` khai báo nhưng không sử dụng**: Chiếm ~190KB Flash. Nếu không dùng, nên xoá file font và khai báo để tiết kiệm 14.5% Flash. | ⚠️ Trung bình |
| 3 | `main.cpp` | ~165-175 | **Giá trị đọc lại thừa**: `sim_temp` được ghi vào `ui_Temperture1`, rồi ngay lập tức đọc lại bằng `lv_label_get_text` + `atof`. Phần đọc lại là thừa trong chế độ giả lập (nhưng hợp lý nếu sau này cảm biến thực ghi trực tiếp vào label). | 🟡 Nhẹ |

### 🟡 Cảnh Báo Tối Ưu (Warnings)

| # | Mô tả | Gợi ý |
|:--|:---|:---|
| 4 | **RAM sử dụng 80.3%**: LVGL draw buffer `lv_color_t buf1[480*30]` ở 32-bit = 57.6KB. Cộng `line_buf[480*30]` uint16_t = 28.8KB. Tổng ~86KB chỉ riêng 2 buffer. | Giảm buffer height từ 30 → 20 nếu cần thêm RAM |
| 5 | **WiFi connect blocking UI**: `wifi_connect_cb` chặn UI thread tối đa 6 giây (`delay(400) × 15`). Có gọi `lv_timer_handler()` bên trong nhưng vẫn chặn touch. | Chuyển sang non-blocking WiFi (check `WiFi.status()` trong timer) |
| 6 | **Thiếu `#include <math.h>`**: Dùng `sinf()`, `roundf()` nhưng không include rõ ràng. Biên dịch OK vì `Arduino.h` include gián tiếp. | Thêm `#include <math.h>` cho rõ ràng |
| 7 | **SquareLine export path**: SquareLine xuất vào `ui/` gốc, PlatformIO compile `src/ui/`. Phải sync thủ công sau mỗi lần export. | Cấu hình SquareLine export path → `src/ui/` |

---

## 📊 6. Tài Nguyên Firmware

| Metric | Giá trị | Tối đa | % |
|:---|:---|:---|:---|
| **RAM** | 263,168 bytes | 327,680 bytes | **80.3%** |
| **Flash** | 1,079,433 bytes | 1,310,720 bytes | **82.4%** |

### Phân bổ Flash ước tính:

| Thành phần | Kích thước | Ghi chú |
|:---|:---|:---|
| `ui_font_Font1.c` | ~211 KB | Font chính của `ui_Temperture1` |
| `ui_font_Font85.c` | ~190 KB | ⚠️ **Không sử dụng** — có thể xoá để tiết kiệm |
| LVGL Library | ~400 KB | Core + Widgets + Chart + Keyboard |
| Arduino Framework | ~150 KB | ESP32-S3 Arduino core |
| WiFi Library | ~80 KB | WiFi STA mode |
| Application Code | ~50 KB | main.cpp + wifi_gui.cpp |

---

## 🔮 7. Kế Hoạch Phát Triển Tiếp Theo

### Giai đoạn 1 — Sẵn sàng (Đã hoàn thành ✅)
- [x] Hiển thị màn hình QSPI NV3041A 480×272
- [x] Cảm ứng GT911 (đã hiệu chỉnh Invert X/Y)
- [x] Giao diện SquareLine Studio (Label, Chart, Arc)
- [x] WiFi Manager Modal (Scan, Connect, Virtual Keyboard)
- [x] Biểu đồ nhiệt độ 30 mẫu FIFO (2s/mẫu)
- [x] Arc Min/Max liên kết với nhãn nhiệt độ
- [x] Nút WiFi trong suốt căn giữa mép dưới

### Giai đoạn 2 — Cần làm (TODO)
- [ ] **Kết nối cảm biến thực** (DS18B20 / MAX6675 / PT100): Thay giả lập `sinf()` bằng đọc nhiệt độ thực
- [ ] **Lưu cài đặt Min/Max vào NVS**: Dùng `Preferences.h` để lưu giá trị Arc khi tắt nguồn
- [ ] **Cảnh báo vượt ngưỡng**: So sánh nhiệt độ thực với Min/Max, đổi màu label hoặc hiển thị cảnh báo
- [ ] **Non-blocking WiFi**: Chuyển WiFi connect sang timer-based thay vì blocking delay
- [ ] **Xoá `ui_font_Font85.c`**: Tiết kiệm ~190KB Flash nếu xác nhận không dùng
- [ ] **Sửa bug TOUCH_SWAP_XY**: Sửa `int16_temp` → `int16_t temp`
- [ ] **OTA Firmware Update**: Cập nhật firmware qua WiFi

---

## 📌 8. Quy Tắc Phát Triển Quan Trọng

> [!IMPORTANT]
> ### Quy tắc SquareLine Studio
> 1. **KHÔNG sửa trực tiếp** các file trong `src/ui/` — chúng sẽ bị ghi đè khi export lại
> 2. Sau mỗi lần export từ SquareLine, phải **sync** `ui/` → `src/ui/`
> 3. Tất cả logic runtime (Arc range, Chart config, callbacks) đặt trong `main.cpp`
> 4. **KHÔNG dùng** `lv_obj_align()` trên widgets của SquareLine trong `main.cpp` — để SquareLine kiểm soát 100% layout

> [!IMPORTANT]
> ### Quy tắc bộ nhớ
> 1. LVGL buffer: `480 × 30 × 4 bytes = 57.6KB` (RAM nội bộ)
> 2. Canvas framebuffer: Được cấp phát trong **PSRAM** bởi `Arduino_Canvas`
> 3. RAM còn lại ~64KB — cẩn thận khi thêm biến lớn hoặc String dài

> [!IMPORTANT]
> ### Quy tắc màu hiển thị (ARGB8888 → RGB565)
> 1. SquareLine xuất 32-bit ARGB8888 (`LV_COLOR_DEPTH 32`)
> 2. Màn hình NV3041A nhận RGB565 16-bit
> 3. Chuyển đổi realtime trong `my_disp_flush()` bằng bitwise shift
