# LVGL PC Simulator - Debug SquareLine Studio UI

Dự án LVGL PC Simulator cho phép biên dịch, chạy và gỡ lỗi (debug) trực tiếp giao diện được xuất từ **SquareLine Studio 1.6.1** trên hệ điều hành Windows bằng **SDL2** và **CMake/GCC**.

---

## 🚀 Hướng Dẫn Cài Đặt Khi Sang Máy Mới (Setup Guide)

Khi clone dự án này sang một máy tính mới, thực hiện 1 trong 2 cách sau để tải nạp thư viện LVGL:

### **Cách 1: Chạy file kịch bản tự động**
Double-click vào tệp [`setup.bat`](setup.bat) ở thư mục gốc để tự động tải thư viện LVGL v8.3.11.

---

### **Cách 2: Chạy thủ công lệnh Git Clone**
Mở Terminal/PowerShell tại thư mục dự án và chạy câu lệnh:
```bash
git clone --branch v8.3.11 --depth 1 https://github.com/lvgl/lvgl.git lvgl
```

---

## 🛠 Hướng Dẫn Biên Dịch & Chạy Debug

### **Chạy Debug trong VS Code (Khuyên dùng)**
- Nhấn **`F5`** (hoặc mở tab **Run & Debug** ➔ chọn **Debug LVGL Simulator (GDB)**).
- VS Code sẽ tự động biên dịch và mở trình gỡ lỗi GDB.

### **Biên dịch thủ công bằng dòng lệnh Terminal**
```bash
# 1. Khởi tạo cấu hình build với MinGW
cmake -B build -G "MinGW Makefiles"

# 2. Biên dịch dự án
cmake --build build --parallel

# 3. Chạy phần mềm Simulator
.\build\lvgl_simulator.exe
```

---

## 📂 Cấu Trúc Dự Án (Project Structure)

```
Embedeed/
├── ui/              # Thư mục chứa giao diện do SquareLine Studio xuất ra (ui.c, screens,...)
├── lvgl/            # Thư viện lõi đồ họa LVGL (v8.3.11) - được quản lý riêng
├── main.c           # Mã nguồn khởi tạo cửa sổ SDL2 & vòng lặp chạy Simulator
├── lv_conf.h        # Cấu hình tính năng, màu sắc 32-bit & phông chữ của LVGL
├── CMakeLists.txt   # File cấu hình liên kết biên dịch dự án
├── setup.bat        # Kịch bản tự động tải thư viện LVGL khi sang máy mới
├── .gitignore       # Cấu hình loại bỏ file rác & thư mục build khỏi Git
└── .vscode/         # Cấu hình Debug F5 và Build Task cho VS Code
```
