# 📜 TÀI LIỆU KIẾN TRÚC & TÍNH NĂNG HỆ THỐNG GIÁM SÁT NHIỆT ĐỘ LÒ SẤY (IOT SYSTEM ARCHITECTURE)

> **Dự án:** Hệ Thống Giám Sát & Điều Khiển Nhiệt Độ Lò Sấy Công Nghiệp  
> **Thiết bị chính:** ESP32-S3 JC4827W543 + Đồng hồ Autonics TK4S + Cảm biến nhiệt độ  
> **Ứng dụng:** PWA Web App / Mobile App / Home Assistant (HASS) Integration  
> **Ngày tạo:** 09/08/2026  
> **Trạng thái:** Phương án Đề xuất & Thiết kế (Đang chờ Review & Xác nhận từ Khách hàng)

---

## 📑 MỤC LỤC
1. [Tổng Quan Hệ Thống & Mục Tiêu](#1-tổng-quan-hệ-thống--mục-tiêu)
2. [Sơ Đồ Kiến Trúc Tổng Thể (System Architecture Diagram)](#2-sơ-đồ-kiến-trúc-tổng-thể-system-architecture-diagram)
3. [Tầng Phần Cứng & Thiết Bị Nhúng (Embedded Hardware Layer)](#3-tầng-phần-cứng--thiết-bị-nhúng-embedded-hardware-layer)
4. [Giao Thức Modbus RTU RS485 với Đánh Giá Thanh Ghi Autonics TK4S](#4-giao-thức-modbus-rtu-rs485-với-đánh-giá-thanh-ghi-autonics-tk4s)
5. [Logic Cảnh Báo Nhiệt Độ Lò Sấy (Alarm & Safety Control Logic)](#5-logic-cảnh-báo-nhiệt-độ-lò-sấy-alarm--safety-control-logic)
6. [Tầng Phần Mềm IoT, PWA Web App & Kết Nối Home Assistant (HASS)](#6-tầng-phần-mềm-iot-pwa-web-app--kết-nối-home-assistant-hass)
7. [Phương Án Tối Ưu Tốc Độ & Độ Tin Cậy (Optimization Strategies)](#7-phương-án-tối-ưu-tốc-độ--độ-tin-cậy-optimization-strategies)
8. [Lộ Trình Triển Khai Chi Tiết (Implementation Roadmap)](#8-lộ-trình-triển-khai-chi-tiết-implementation-roadmap)

---

## 1. TỔNG QUAN HỆ THỐNG & MỤC TIÊU

Hệ thống được thiết kế nhằm mục đích **giám sát, cài đặt và tự động cảnh báo nhiệt độ lò sấy** theo thời gian thực với các tiêu chuẩn công nghiệp cao nhất:

* **Tại lò sấy (Local Control)**: Người vận hành thao tác trực tiếp trên màn hình cảm ứng 4.3" ESP32-S3 (JC4827W543) hoặc xoay núm vặn EC11 để cài đặt ngưỡng nhiệt độ **Min (`TemperatureMin`)** và **Max (`TemperatureMax`)**.
* **Điều khiển công nghiệp (Industrial Execution)**: ESP32-S3 giao tiếp hai chiều với đồng hồ nhiệt độ công nghiệp **Autonics TK4S** qua chuẩn giao tiếp **Modbus RTU (RS485)**. Đẩy ngưỡng cài đặt vào TK4S và đọc trực tiếp nhiệt độ đo thực tế (`PV`) từ cảm biến.
* **Cảnh báo thông minh (Smart Alarming)**: Phát cảnh báo tức thời khi nhiệt độ thực nằm ngoài khoảng an toàn (`PV < TemperatureMin` hoặc `PV > TemperatureMax`).
* **Giám sát từ xa & Phân tích báo cáo (Remote IoT & Analytics)**: 
  * Kết nối không dây Wi-Fi truyền dữ liệu MQTT lên Server.
  * Tích hợp **Home Assistant (HASS)** để tự động hóa (gửi thông báo Telegram/Zalo, điều khiển còi báo ngoài...).
  * Ứng dụng **IoT PWA Web App (Mobile/Desktop)** hiển thị biểu đồ thời gian thực, lưu trữ lịch sử và xuất báo cáo phân tích hiệu suất lò sấy.

---

## 2. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ (SYSTEM ARCHITECTURE DIAGRAM)

```
                     ┌─────────────────────────────────────────┐
                     │ CẢM BIẾN NHIỆT ĐỘ (Thermocouple K/PT100)│
                     └────────────────────┬────────────────────┘
                                          │ (Tín hiệu Analog/Nhiệt)
                                          ▼
                     ┌─────────────────────────────────────────┐
                     │ ĐỒNG HỒ ĐIỀU KHIỂN NHIỆT ĐỘ AUTONICS TK4S│
                     └────────────────────┬────────────────────┘
                                          │ RS485 (Modbus RTU @ 9600/115200 bps)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ BO MẠCH TRUNG TÂM ESP32-S3 (JC4827W543 Display Gateway)                          │
│ ├─ QSPI Display 4.3" IPS (480x272) + GT911 Touch (LVGL 8.3 GUI)                 │
│ ├─ EC11 Rotary Encoder (Chân IO6, IO7, IO15, IO16-GND)                          │
│ ├─ UART1 Modbus RTU Master (Giao tiếp TK4S)                                     │
│ └─ Wi-Fi / MQTT Engine (Truyền nhận dữ liệu Cloud)                             │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │ Giao thức Wi-Fi / MQTT (JSON payload)     │
                   ▼                                           ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│ HOME ASSISTANT (HASS) SERVER         │   │ IOT PWA WEB APP / MOBILE APP         │
│ ├─ Auto MQTT Discovery               │   │ ├─ Realtime Dashboard (WebSocket)    │
│ ├─ Cảnh báo Telegram / Zalo Push     │   │ ├─ Push Notification (WebPush/FCM)   │
│ └─ Lưu cơ sở dữ liệu InfluxDB        │   │ └─ Xuất Báo cáo CSV/Excel & Biểu đồ  │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```

---

## 3. TẦNG PHẦN CỨNG & THIẾT BỊ NHÚNG (EMBEDDED HARDWARE LAYER)

### 3.1. Bo Mạch Trung Tâm ESP32-S3 JC4827W543
* **Tài liệu nhà sản xuất (GUITION)**: [lsdlsd88/JC4827W543 Repository](https://github.com/lsdlsd88/JC4827W543)
* **Vi xử lý**: ESP32-S3 WROOM-1U (Dual-Core LX7 @ 240MHz, 4MB Flash, 8MB OPI PSRAM).
* **Màn hình**: 4.3 inch IPS QSPI LCD NV3041A (Độ phân giải 480x272 pixel).
* **Giao diện người dùng (GUI)**: LVGL v8.3 thiết kế từ SquareLine Studio.
  * `ui_Temperture1`: Hiển thị con số nhiệt độ thực tế (`PV`) đọc từ TK4S (Font 85px Neon Green).
  * `ui_Chart1`: Biểu đồ đồ thị nhiệt độ 30 mẫu FIFO cuộn mượt (2 giây/mẫu).
  * `ui_ArcMin` & `ui_TemperatureMin`: Cài đặt ngưỡng cảnh báo dưới.
  * `ui_ArcMax` & `ui_TemperatureMax`: Cài đặt ngưỡng cảnh báo trên.
* **Bộ điều khiển cơ học kép cắm qua 2 Cổng SH1.0 (Dual EC11 Rotary Encoders)**:
  * **EC11 Núm 1 (Chỉnh Min Temp - Connector SH1.0 Số 1)**:
    * `IO46`: CLK1 (Phase A - Ngắt `IRAM_ATTR`)
    * `IO9`: DT1 (Phase B)
    * `IO14`: SW1 (Nút nhấn công tắc Min)
    * `IO5`: GND1 (Software GND 0V: `OUTPUT LOW`)
    * **Chức năng**: Xoay núm 1 để tăng/giảm trực tiếp **`TemperatureMin`** (`ui_ArcMin` & `ui_TemperatureMin`).
  * **EC11 Núm 2 (Chỉnh Max Temp - Connector SH1.0 Số 2)**:
    * `IO6`: CLK2 (Phase A - Ngắt `IRAM_ATTR`)
    * `IO7`: DT2 (Phase B)
    * `IO15`: SW2 (Nút nhấn công tắc Max / Mở Menu WiFi)
    * `IO16`: GND2 (Software GND 0V: `OUTPUT LOW`)
    * **Chức năng**: Xoay núm 2 để tăng/giảm trực tiếp **`TemperatureMax`** (`ui_ArcMax` & `ui_TemperatureMax`). Bấm SW2 để Bật/Tắt nhanh cửa sổ Cài đặt WiFi.

### 3.2. Đồng Hồ Đo & Điều Khiển Nhiệt Độ Autonics TK4S
* **Model**: Autonics TK4S (Dòng bộ điều khiển PID cao cấp công nghiệp).
* **Đầu vào**: Đọc cảm biến Can nhiệt K (Thermocouple) hoặc PT100 (RTD).
* **Đầu ra**: Truyền thông nối tiếp RS485 (Chế độ Modbus RTU Slave, ID mặc định: `1`).
* **Vai trò**: Đo nhiệt độ chính xác cao, tự động chạy thuật toán điều khiển gia nhiệt lò sấy (PID/ON-OFF) và cung cấp dữ liệu thanh ghi Modbus cho ESP32-S3.

### 3.3. Mạch Chuyển Đổi Tín Hiệu UART ↔ RS485 (MAX485 / SP3485)
* **Kết nối ESP32-S3**:
  * **TXD**: `GPIO 17` (UART1 TX)
  * **RXD**: `GPIO 18` (UART1 RX)
  * **DE/RE**: Tự động đảo chiều (Hardware Auto Direction Module) hoặc điều khiển qua GPIO.

---

## 4. GIAO THỨC MODBUS RTU RS485 VỚI ĐỒNG HỒ AUTONICS TK4S

ESP32-S3 hoạt động với vai trò **Modbus RTU Master**, tuần tự gửi request đọc/ghi dữ liệu tới Autonics TK4S (**Modbus RTU Slave ID: 1**).

### 4.1. Bảng Ánh Xạ Thanh Ghi Modbus (Autonics TK4S Memory Map)

| Tên thông số | Mã Thanh ghi (Register Address) | Mã Hàm Modbus (Function Code) | Kiểu dữ liệu | Mô tả chi tiết |
| :--- | :--- | :--- | :--- | :--- |
| **Present Value (PV)** | `00100` (`0x0064`) | `03` (Read Holding) | 16-bit Int (`x1` hoặc `x10`) | Nhiệt độ thực tế từ cảm biến ➔ Đẩy lên `ui_Temperture1` |
| **Set Value (SV)** | `00000` (`0x0000`) | `03` Read / `06` Write | 16-bit Int | Nhiệt độ cài đặt mục tiêu của lò sấy |
| **Alarm 1 Low Limit (`TemperatureMin`)** | `00005` (`0x0005`) hoặc `SV_Low` | `03` Read / `06` Write | 16-bit Int | Ngưỡng cảnh báo dưới ➔ Đồng bộ từ `ui_ArcMin` |
| **Alarm 1 High Limit (`TemperatureMax`)** | `00006` (`0x0006`) hoặc `SV_High` | `03` Read / `06` Write | 16-bit Int | Ngưỡng cảnh báo trên ➔ Đồng bộ từ `ui_ArcMax` |

### 4.2. Chu Kỳ Đồng Bộ Dữ Liệu Modbus (Data Sync Cycle)
1. **Đọc định kỳ (Read Loop - 500ms ~ 1000ms)**:
   * ESP32-S3 gửi lệnh Function Code `03` đọc thanh ghi `PV` từ TK4S.
   * Cập nhật ngay giá trị `PV` lên nhãn `ui_Temperture1` và nạp vào Biểu đồ `ui_Chart1`.
2. **Ghi sự kiện (Write on Change)**:
   * Khi người dùng vặn Arc Min hoặc Arc Max trên màn hình ESP32-S3 ➔ ESP32-S3 tự động phát lệnh Function Code `06` (Write Single Register) để đẩy ngay giá trị mới vào thanh ghi cảnh báo của TK4S.

---

## 5. LOGIC CẢNH BÁO NHIỆT ĐỘ LÒ SẤY (ALARM & SAFETY CONTROL LOGIC)

Dựa trên 3 thông số: Nhiệt độ thực `PV` (`ui_Temperture1`), Ngưỡng Min `TemperatureMin` (`ui_ArcMin`), Ngưỡng Max `TemperatureMax` (`ui_ArcMax`).

### 5.1. Bảng Trạng Thái Điều Kiện Vận Hành

| Trạng thái | Điều kiện | Hiển thị Màn hình ESP32-S3 | Cảnh báo Còi / Đèn | Tín hiệu IoT / HASS |
| :--- | :--- | :--- | :--- | :--- |
| **BÌNH THƯỜNG (OK)** | `TemperatureMin <= PV <= TemperatureMax` | Màu Xanh Lá Neon (`#10F524`), Trạng thái `NORMAL` | Tắt Còi | `alarm: false`, Status: `OK` |
| **CẢNH BÁO THẤP (LOW TEMP)** | `PV < TemperatureMin` | Chớp Màu Xanh Dương (`#7599F8`), Trạng thái `TEMP LOW!` | Bật Còi nhịp chậm | `alarm: true`, Type: `LOW_TEMP` |
| **CẢNH BÁO CAO (HIGH TEMP)** | `PV > TemperatureMax` | Chớp Màu Đỏ Rực (`#EF4444`), Trạng thái `OVERHEAT!` | Bật Còi liên tục | `alarm: true`, Type: `HIGH_TEMP` |

### 5.2. Thuật Toán Tránh Cảnh Báo Giả (Hysteresis & Filter)
* **Độ trễ Cảnh báo (Hysteresis)**: Thiết lập độ trễ $\Delta T = 1.0^\circ\text{C}$ để tránh hiện tượng còi chớp tắt liên tục khi nhiệt độ dao động sát ngưỡng.
* **Thời gian xác nhận (Debounce Delay)**: Nhiệt độ phải vượt ngưỡng liên tục quá 3 giây mới kích hoạt còi báo báo động.

---

## 6. TẦNG PHẦN MỀM IOT, PWA WEB APP & KẾT NỐI HOME ASSISTANT (HASS)

### 6.1. Giao Thức Kết Nối WiFi & MQTT
ESP32-S3 sử dụng thư viện `PubSubClient` gửi dữ liệu định kỳ (mỗi 2 giây) hoặc ngay khi có sự kiện cảnh báo lên **MQTT Broker** (Mosquitto / HASS Broker):

#### Topis MQTT chuẩn:
* **`drying_oven/tele/state`** (JSON Payload):
  ```json
  {
    "temperature": 95.4,
    "temp_min": 70.0,
    "temp_max": 110.0,
    "alarm": false,
    "alarm_type": "NONE",
    "wifi_rssi": -65,
    "uptime_seconds": 3600
  }
  ```
* **`drying_oven/cmnd/set_min`**: Nhận lệnh thay đổi `TemperatureMin` từ Web App / HASS.
* **`drying_oven/cmnd/set_max`**: Nhận lệnh thay đổi `TemperatureMax` từ Web App / HASS.

---

### 6.2. Tích Hợp Home Assistant (HASS) — Tự Động Khám Phá (MQTT Discovery)
ESP32-S3 gửi cấu hình **MQTT Auto Discovery** khi vừa khởi động. HASS sẽ tự động nhận diện thiết bị lò sấy mà người dùng không cần viết code yaml:

* **Entity Nhiệt độ (`sensor.drying_oven_temperature`)**: Đồ thị nhiệt độ HASS Lovelace.
* **Entity Ngưỡng Min (`number.drying_oven_temp_min`)**: Cài đặt ngưỡng dưới từ HASS dashboard.
* **Entity Ngưỡng Max (`number.drying_oven_temp_max`)**: Cài đặt ngưỡng trên từ HASS dashboard.
* **Entity Cảnh báo (`binary_sensor.drying_oven_alarm`)**: Trigger kịch bản tự động hóa (Automation):
  * *Tự động gửi thông báo OTT qua Telegram / Zalo / Notification app khi có sự cố lò sấy.*
  * *Tự động ngắt nguồn thanh nhiệt lò sấy nếu quá nhiệt nghiêm trọng.*

---

### 6.3. Phần Mềm IoT PWA Web App / Mobile App (Progressive Web App)
Ứng dụng Web PWA hiện đại chạy trực tiếp trên Điện thoại (iOS/Android) và Máy tính mà không cần cài đặt qua App Store:

#### Các Tính Năng Chính Của PWA Web App:
1. **Bảng Điều Khiển Realtime (Live Dashboard)**:
   * Hiển thị đồng hồ số lớn & đồ thị nhiệt độ realtime (kết nối WebSocket / MQTT mượt mà).
   * Đèn trạng thái báo động trực quan.
2. **Cài Đặt Ngưỡng Từ Xa (Remote Configuration)**:
   * Cho phép chỉnh `TemperatureMin` và `TemperatureMax` từ xa có bảo mật phân quyền tài khoản (Admin/Operator).
3. **Cảnh Báo Thông Minh (Push Notifications)**:
   * Sử dụng công nghệ WebPush API / FCM gửi thông báo trực tiếp lên màn hình khóa điện thoại cả khi tắt ứng dụng.
4. **Báo Cáo & Phân Tích Dữ Liệu (Analytics & Reporting)**:
   * Lưu trữ lịch sử nhiệt độ theo ngày, tuần, tháng.
   * Tính toán nhiệt độ trung bình, nhiệt độ cực đại, thời gian chạy lò sấy.
   * **Xuất báo cáo dữ liệu định dạng Excel (.xlsx) / CSV** phục vụ kiểm định chất lượng sấy.

---

## 7. PHƯƠNG ÁN TỐI ƯU TỐC ĐỘ & ĐỘ TIN CẬY (OPTIMIZATION STRATEGIES)

1. **Về Phần Cứng & Giao Tiếp Nhúng (ESP32-S3 ↔ TK4S)**:
   * **FreeRTOS Dual-Task Split**:
     * **Core 1**: Dành riêng cho LVGL GUI 60 FPS, quét cảm ứng GT911 và đọc Encoder EC11.
     * **Core 0**: Dành riêng cho Modbus RTU RS485, kết nối Wi-Fi & MQTT truyền dữ liệu.
   * Đảm bảo màn hình không bao giờ bị giật lag kể cả khi mất mạng Wi-Fi hoặc RS485 bị nhiễu.
2. **Về An Toàn Dữ Liệu (Data Integrity & NVS Memory)**:
   * Lưu giá trị `TemperatureMin` và `TemperatureMax` vào bộ nhớ Flash NVS (`Preferences.h`). Khi mất điện đột ngột và có điện lại, hệ thống tự động khôi phục đúng cài đặt trước đó.
3. **Về Khả Năng Mở Rộng (Scalability)**:
   * Cấu trúc Modbus Master có thể hỗ trợ mở rộng đọc nhiều đồng hồ TK4S cùng lúc (Dành cho hệ thống nhiều phòng sấy / nhiều lò sấy).

---

## 8. LỘ TRÌNH TRIỂN KHAI CHI TIẾT (IMPLEMENTATION ROADMAP)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📍 GIAI ĐOẠN 1: BÁO CÁO & XÁC NHẬN PHƯƠNG ÁN (ĐANG THỰC HIỆN)                     │
│ ├─ Viết file tài liệu chi tiết SYSTEM_ARCHITECTURE.md                           │
│ └─ Khách hàng review, đóng góp ý kiến & chốt xác nhận triển khai                │
└──────────────────────┬──────────────────────────────────────────────────────────┘
                       │ (Sau khi xác nhận)
                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ⚙️ GIAI ĐOẠN 2: LẬP TRÌNH NHÚNG ESP32-S3 & MODBUS RTU TK4S                       │
│ ├─ Viết Driver Modbus RTU RS485 (HardwareSerial / ModbusMaster) trên UART1      │
│ ├─ Đọc PV từ TK4S đẩy lên ui_Temperture1 & Chart1                               │
│ └─ Đồng bộ 2 chiều ArcMin/ArcMax với thanh ghi Alarm của TK4S                    │
└──────────────────────┬──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📶 GIAI ĐOẠN 3: TÍCH HỢP MQTT & KẾT NỐI HOME ASSISTANT (HASS)                    │
│ ├─ Lập trình MQTT Engine + Auto Discovery trên ESP32-S3                          │
│ ├─ Cấu hình HASS Dashboard & Automation Cảnh báo Telegram                       │
│ └─ Kiểm thử độ ổn định khi đứt/kết nối lại Wi-Fi                                │
└──────────────────────┬──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📱 GIAI ĐOẠN 4: PHÁT TRIỂN PWA WEB APP & TÍNH NĂNG BÁO CÁO                       │
│ ├─ Xây dựng PWA Web App bằng Vite/React + TailwindCSS + MQTT.js                 │
│ ├─ Tích hợp biểu đồ lịch sử Chart.js & Tính năng xuất Báo cáo Excel/CSV          │
│ └─ Kiểm thử Push Notification màn hình khóa Mobile                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

> 📝 **GHI CHÚ:** File tài liệu kiến trúc này đã được tạo tại [`SYSTEM_ARCHITECTURE.md`](file:///D:/OneDrive%20-%20GREENFEED%20VN/tang.le@qdtek.vn%20-%20Documents/TangLx/CF_IOT/Embedeed/SYSTEM_ARCHITECTURE.md). Xin mời bạn xem qua và cho ý kiến phản hồi hoặc xác nhận để tiến hành triển khai giai đoạn tiếp theo!
