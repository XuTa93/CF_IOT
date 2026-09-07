# CF_IOT - Hệ Thống Giám Sát & Điều Khiển Nhiệt Độ Thông Minh

Hệ thống IoT toàn diện kết hợp màn hình cảm ứng phần cứng HMI, bộ vi điều khiển phụ trợ đọc encoder và ứng dụng Web PWA đa nền tảng kết nối qua MQTT.

---

## 📂 Cấu Trúc Dự Án

- **[`Embedeed/`](Embedeed/):** Firmware điều khiển màn hình **JC4827W543 (ESP32-S3)**, thư viện đồ họa **LVGL 8.4**, cảm ứng điện dung GT911, bộ giải mã núm xoay vô cấp **EC11 (P2)** và giao diện cấu hình **WiFi Manager**. Hỗ trợ trình giả lập PC Simulator (SDL2).
- **[`CP2040/`](CP2040/):** Firmware vi điều khiển phụ **Raspberry Pi RP2040**, quản lý 2 núm xoay EC11 và đèn LED báo hiệu WS2812B NeoPixel, truyền dữ liệu sang ESP32 qua UART.
- **[`PWA/`](PWA/):** Ứng dụng Web Dashboard **Progressive Web App (PWA)** chuẩn Dark Theme Glassmorphism, hiển thị nhiệt độ Realtime, biểu đồ Canvas, ngưỡng Min/Max, nhật ký lịch sử, cảnh báo và thông báo đẩy điện thoại.

---

## 📖 Chi Tiết Tính Năng

👉 Xem tài liệu chi tiết toàn bộ tính năng tại: **[`FEATURES.md`](FEATURES.md)**.
