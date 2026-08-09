# 📌 Cấu Hình Phần Cứng Board JC4827W543 (ESP32-S3 Display 4.3")

Tài liệu này lưu trữ toàn bộ sơ đồ chân (Pinout), cấu hình Driver màn hình, Cảm ứng GT911 và thiết lập LVGL đã được thử nghiệm thành công 100% trên thiết bị **JC4827W543**.

---

## 🛠 1. Thông Số Phần Cứng Vi Xử Lý (MCU & Memory)

| Thông số | Giá trị |
| :--- | :--- |
| **Model Bo mạch** | JC4827W543 / ESP32-S3-4827S043 (Guition 4.3") |
| **Tài liệu gốc (GitHub)** | [lsdlsd88/JC4827W543](https://github.com/lsdlsd88/JC4827W543) |
| **Vi xử lý (MCU)** | ESP32-S3 WROOM 1U (Xtensa® Dual-Core 32-bit LX7 @ 240MHz) |
| **Bộ nhớ Flash** | 4MB (`qio`) |
| **Bộ nhớ PSRAM** | 8MB High-Speed OPI PSRAM (`qio_opi` / 80MHz) |
| **Màn hình** | 4.3 inch IPS (Độ phân giải `480 x 272`) |

---

## 📺 2. Cấu Hình Driver Màn Hình & Sơ Đồ Chân (QSPI NV3041A)

Màn hình sử dụng **IC NV3041A** giao tiếp qua chuẩn **QSPI (Quad SPI)**. Để không bị lỗi đứt nét hay đen 80% phía dưới màn hình, phải sử dụng kiến trúc **`Arduino_Canvas`** lưu trong PSRAM.

### 📌 Sơ đồ chân QSPI Bus:
* **CS Pin**: `GPIO 45`
* **SCK Pin**: `GPIO 47`
* **D0 Pin**: `GPIO 21`
* **D1 Pin**: `GPIO 48`
* **D2 Pin**: `GPIO 40`
* **D3 Pin**: `GPIO 39`
* **Reset (RST)**: `GFX_NOT_DEFINED` (-1)

### 💡 Chân Đèn nền & Cấp nguồn (Backlight & Power):
```cpp
// Kích hoạt HIGH trong setup()
pinMode(1, OUTPUT);  digitalWrite(1, HIGH);  // Đèn nền Backlight (Primary)
pinMode(2, OUTPUT);  digitalWrite(2, HIGH);  // Nguồn LCD / Backlight
pinMode(38, OUTPUT); digitalWrite(38, HIGH); // Nguồn Cảm ứng & Màn hình
```

### 🏗 Mã nguồn khởi tạo màn hình trong `src/main.cpp`:
```cpp
Arduino_DataBus *bus = new Arduino_ESP32QSPI(45, 47, 21, 48, 40, 39);
Arduino_GFX *panel = new Arduino_NV3041A(bus, GFX_NOT_DEFINED, 0 /* rotation */, true /* IPS */);
Arduino_GFX *gfx = new Arduino_Canvas(480, 272, panel);
```

---

## 🖐 3. Cấu Hình Cảm Ứng GT911 (Capacitive Touch)

* **Chuẩn giao tiếp**: I2C (`TAMC_GT911`)
* **Chân SDA**: `GPIO 8`
* **Chân SCL**: `GPIO 4`
* **Chân INT**: `GPIO 3`
* **Chân RST**: `GPIO 38`

### 🔄 Cấu hình Định hướng Tọa độ Cảm ứng (Touch Mapping):
Dự án được cấu hình lật tọa độ để khớp chuẩn 100% với màn hình:
```cpp
#define TOUCH_INVERT_X 1  // Kích hoạt lật chiều ngang X (480 - x)
#define TOUCH_INVERT_Y 1  // Kích hoạt lật chiều dọc Y (272 - y)
#define TOUCH_SWAP_XY  0  // Không đảo trục X/Y
```

---

## 🔌 4. Cấu Hình Cổng Nối Tiếp UART1 (Kết Nối RP2040)

* **TX Pin (Phát)**: `GPIO 17` (Nối với chân RX của RP2040)
* **RX Pin (Nhận)**: `GPIO 18` (Nối với chân TX của RP2040)
* **Tốc độ Baud Rate**: `115200 bps` (SERIAL_8N1)

### 💻 Khởi tạo trong `src/main.cpp`:
```cpp
#define UART1_TX_PIN 17
#define UART1_RX_PIN 18
#define UART1_BAUD   115200

// Trong setup():
Serial1.begin(UART1_BAUD, SERIAL_8N1, UART1_RX_PIN, UART1_TX_PIN);
```

---

## 🔘 5. Cấu Hình 2 Cổng SH1.0 (4-Pin) Đọc Rotary Encoder EC11

Sử dụng trực tiếp **2 cổng cắm chuẩn SH1.0 (4 chân)** có sẵn trên bo mạch JC4827W543 mà không cần hàn nối dây phụ:

### 🎛 Cổng SH1.0 Số 1 (Chỉnh `TemperatureMin` - Chân IO46, IO9, IO14, IO5):
* **Pin 1 - CLK1**: `GPIO 46` *(Ngắt phần cứng `IRAM_ATTR`)*
* **Pin 2 - DT1**: `GPIO 9`
* **Pin 3 - SW1 (Nút nhấn Min)**: `GPIO 14` *(INPUT_PULLUP)*
* **Pin 4 - GND1 (Software GND)**: `GPIO 5` *(Cấu hình `OUTPUT`, `LOW` 0V làm Mát)*

### 🎛 Cổng SH1.0 Số 2 (Chỉnh `TemperatureMax` - Chân IO6, IO7, IO15, IO16):
* **Pin 1 - CLK2**: `GPIO 6` *(Ngắt phần cứng `IRAM_ATTR`)*
* **Pin 2 - DT2**: `GPIO 7`
* **Pin 3 - SW2 (Nút nhấn Max / WiFi GUI)**: `GPIO 15` *(INPUT_PULLUP)*
* **Pin 4 - GND2 (Software GND)**: `GPIO 16` *(Cấu hình `OUTPUT`, `LOW` 0V làm Mát)*

### 💻 Cấu hình trong `src/main.cpp`:
```cpp
// EC11 Núm 1 - Min Temp (Connector SH1.0 #1)
#define EC11_1_CLK  46
#define EC11_1_DT   9
#define EC11_1_SW   14
#define EC11_1_GND  5   // OUTPUT LOW (0V)

// EC11 Núm 2 - Max Temp (Connector SH1.0 #2)
#define EC11_2_CLK  6
#define EC11_2_DT   7
#define EC11_2_SW   15
#define EC11_2_GND  16  // OUTPUT LOW (0V)
```

---

## 🎨 4. Cấu Hình Đồ Họa LVGL v8.3 & SquareLine Studio

* **SquareLine Studio Version**: 1.6.1 (Xuất dự án chuẩn 32-bit ARGB8888).
* **`lv_conf.h`**:
  * `#define LV_COLOR_DEPTH 32` (Khớp định dạng ảnh từ SquareLine Studio).
  * `#define LV_MEM_SIZE (128U * 1024U)` (Heap LVGL 128KB).
* **Chuyển đổi màu Realtime (`my_disp_flush`)**:
  Chuyển ARGB8888 sang RGB565 bằng toán tử bitwise tối ưu cho CPU 240MHz:
  ```cpp
  line_buf[i] = ((px >> 8) & 0xF800) | ((px >> 5) & 0x07E0) | ((px >> 3) & 0x001F);
  ```

---

## ⚙️ 5. Cấu Hình PlatformIO (`platformio.ini`)

```ini
[env:jc4827w543]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
upload_speed = 460800

board_upload.flash_size = 4MB
board_build.partitions = default.csv

board_build.arduino.memory_type = qio_opi
board_build.f_flash = 80000000L
board_build.flash_mode = qio
board_build.psram_type = opi

build_flags = 
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DARDUINO_USB_MODE=1
    -I.
    -Isrc

lib_deps = 
    lvgl/lvgl@^8.3.11
    moononournation/GFX Library for Arduino@1.4.3
    tamctec/TAMC_GT911@^1.0.2
```
