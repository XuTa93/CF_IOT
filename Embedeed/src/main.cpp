/**
 * @file main.cpp
 * ESP32-S3 Hardware Entry point for JC4827W543 Display (480x272)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <lvgl.h>
#include <Arduino_GFX_Library.h>
#include <TAMC_GT911.h>
#include "ui/ui.h"
#include "wifi_gui.h"
#include "ModbusMaster.h"

// Khai báo Font 85px cho LVGL
LV_FONT_DECLARE(ui_font_Font85);

// Cấu hình Tên WiFi và Mật khẩu (Điền tên WiFi của bạn tại đây)
#define WIFI_SSID     "Tên_WiFi_Của_Bạn"
#define WIFI_PASSWORD "Mật_Khẩu_WiFi"

// Cấu hình màn hình JC4827W543 (NV3041A QSPI Driver)
#define GFX_BL 1
#define DISPLAY_ROTATION 0

Arduino_DataBus *bus = new Arduino_ESP32QSPI(
    45 /* CS */, 47 /* SCK */, 21 /* D0 */, 48 /* D1 */, 40 /* D2 */, 39 /* D3 */
);

// Khởi tạo Panel phần cứng NV3041A QSPI
Arduino_GFX *panel = new Arduino_NV3041A(
    bus, GFX_NOT_DEFINED /* RST */, DISPLAY_ROTATION /* rotation */, true /* IPS */
);

// Dùng Canvas 480x272 trong PSRAM để làm mượt và đảm bảo quét 100% diện tích màn hình
Arduino_GFX *gfx = new Arduino_Canvas(480 /* width */, 272 /* height */, panel);

// Cấu hình Cảm ứng GT911 cho JC4827W543
#define TOUCH_SDA 8
#define TOUCH_SCL 4
#define TOUCH_INT 3
#define TOUCH_RST 38

// Cấu hình Lật/Đảo trục tọa độ cảm ứng (Đổi 0 thành 1 để kích hoạt)
#define TOUCH_INVERT_X 1  // Đã kích hoạt lật chiều ngang X
#define TOUCH_INVERT_Y 1  // Đã kích hoạt lật chiều dọc Y
#define TOUCH_SWAP_XY  0  // Đổi thành 1 nếu trục X và Y bị đảo ngang/dọc

TAMC_GT911 ts = TAMC_GT911(TOUCH_SDA, TOUCH_SCL, TOUCH_INT, TOUCH_RST, 480, 272);

// Cấu hình UART1 (Modbus RTU Master Poll) kết nối Modbus Slave (ModSim32 trên PC qua COM3)
#define UART1_TX_PIN 17
#define UART1_RX_PIN 18
#define UART1_BAUD   115200

// Khởi tạo Modbus RTU Master (Mặc định đọc Slave ID = 1, chu kỳ Poll 500ms)
static ModbusMaster modbus(1);

// Con trỏ chuỗi dữ liệu biểu đồ Chart1
static lv_chart_series_t * ui_chart_series = NULL;

// Callback khi Modbus Master đọc dữ liệu FC03 thành công từ Slave (ModSim32 trên PC qua COM3)
void on_modbus_data_received(uint16_t start_addr, const int16_t *data, uint16_t count) {
    if (count > 0) {
        int16_t raw_temp = data[0]; // Thanh ghi 40001 (Offset 0): Nhiệt độ đo tức thời x10 (ví dụ 854 = 85.4°C)
        float temp_c = raw_temp / 10.0f;

        // 1. Cập nhật số hiển thị to ở giữa màn hình (ui_Temperture1)
        if (ui_Temperture1) {
            char buf[16];
            snprintf(buf, sizeof(buf), "%.1f", temp_c);
            lv_label_set_text(ui_Temperture1, buf);
        }

        // 2. Nạp điểm nhiệt độ từ Modbus vào biểu đồ Chart1
        if (ui_Chart1 && ui_chart_series) {
            int16_t chart_val = (int16_t)roundf(temp_c);
            lv_chart_set_next_value(ui_Chart1, ui_chart_series, chart_val);
            lv_chart_refresh(ui_Chart1);
        }

        // 3. Tự động kiểm tra cảnh báo ngưỡng Min / Max
        int min_val = ui_ArcMin ? lv_arc_get_value(ui_ArcMin) : 50;
        int max_val = ui_ArcMax ? lv_arc_get_value(ui_ArcMax) : 100;
        int16_t alarm = 0;
        if (temp_c > max_val) alarm = 2; // Quá nhiệt
        else if (temp_c < min_val) alarm = 1; // Dưới ngưỡng

        static float last_logged_temp = -999.0f;
        if (fabsf(temp_c - last_logged_temp) > 0.05f) {
            Serial.printf("[Modbus Poll -> LCD] Đọc từ PC ModSim32: %.1f°C (Raw: %d, Alarm: %d)\n", temp_c, raw_temp, alarm);
            last_logged_temp = temp_c;
        }
    }
}

// Cấu hình Rotary Encoder EC11 Số 1 (Module 4 chân: SW=46, GND=9, PhaseA=14, PhaseB=5) - Cổng P2 (Chỉnh Min Temp)
#define EC11_SW_PIN   46  // Chân 1: Nút nhấn (SW) - IO46
#define EC11_GND_PIN  9   // Chân 2: Common Ground (0V) - IO9
#define EC11_CLK_PIN  14  // Chân 3: Phase A - IO14 (Đảo với DT để xoay phải là TĂNG)
#define EC11_DT_PIN   5   // Chân 4: Phase B - IO5

static volatile int32_t encoder_count = 0;
static volatile uint8_t enc_prevState = 0;

// Thuật toán giải mã Encoder EC11 #1 máy trạng thái (State Machine) có lọc chống dội (Debounce)
void IRAM_ATTR ec11_isr() {
    static uint32_t last_isr_time = 0;
    uint32_t now = micros();
    if (now - last_isr_time < 800) return; // Lọc bỏ xung dội cơ học dưới 800us giúp xoay mịn, đầm chắc
    last_isr_time = now;

    uint8_t currState = (digitalRead(EC11_CLK_PIN) << 1) | digitalRead(EC11_DT_PIN);
    if (currState != enc_prevState) {
        if ((enc_prevState == 0b00 && currState == 0b01) || 
            (enc_prevState == 0b01 && currState == 0b11) ||
            (enc_prevState == 0b11 && currState == 0b10) || 
            (enc_prevState == 0b10 && currState == 0b00)) {
            encoder_count++; // Xoay theo chiều kim đồng hồ (CW)
        } else if ((enc_prevState == 0b00 && currState == 0b10) || 
                   (enc_prevState == 0b10 && currState == 0b11) ||
                   (enc_prevState == 0b11 && currState == 0b01) || 
                   (enc_prevState == 0b01 && currState == 0b00)) {
            encoder_count--; // Xoay ngược chiều kim đồng hồ (CCW)
        }
        enc_prevState = currState;
    }
}

// Cấu hình Rotary Encoder EC11 Số 2 (Module 4 chân: SW=6, GND=7, PhaseA=15, PhaseB=16) - Cổng P3 (Chỉnh Max Temp)
#define EC11_2_SW_PIN   6   // Chân 1: Nút nhấn (SW) - IO6
#define EC11_2_GND_PIN  7   // Chân 2: Common Ground (0V) - IO7
#define EC11_2_CLK_PIN  15  // Chân 3: Phase A - IO15
#define EC11_2_DT_PIN   16  // Chân 4: Phase B - IO16

static volatile int32_t encoder2_count = 0;
static volatile uint8_t enc2_prevState = 0;

// Thuật toán giải mã Encoder EC11 #2 máy trạng thái (State Machine) có lọc chống dội (Debounce)
void IRAM_ATTR ec11_2_isr() {
    static uint32_t last_isr_time2 = 0;
    uint32_t now = micros();
    if (now - last_isr_time2 < 800) return; // Lọc bỏ xung dội cơ học dưới 800us
    last_isr_time2 = now;

    uint8_t currState = (digitalRead(EC11_2_CLK_PIN) << 1) | digitalRead(EC11_2_DT_PIN);
    if (currState != enc2_prevState) {
        if ((enc2_prevState == 0b00 && currState == 0b01) || 
            (enc2_prevState == 0b01 && currState == 0b11) ||
            (enc2_prevState == 0b11 && currState == 0b10) || 
            (enc2_prevState == 0b10 && currState == 0b00)) {
            encoder2_count++; // Xoay theo chiều kim đồng hồ (CW)
        } else if ((enc2_prevState == 0b00 && currState == 0b10) || 
                   (enc2_prevState == 0b10 && currState == 0b11) ||
                   (enc2_prevState == 0b11 && currState == 0b01) || 
                   (enc2_prevState == 0b01 && currState == 0b00)) {
            encoder2_count--; // Xoay ngược chiều kim đồng hồ (CCW)
        }
        enc2_prevState = currState;
    }
}

/* Callback hiển thị LVGL 8.3 (Hỗ trợ 32-bit từ SquareLine Studio) */
static uint16_t line_buf[480 * 30];

void my_disp_flush(lv_disp_drv_t *disp_drv, const lv_area_t *area, lv_color_t *color_p) {
    uint32_t w = area->x2 - area->x1 + 1;
    uint32_t h = area->y2 - area->y1 + 1;

#if (LV_COLOR_DEPTH == 32)
    uint32_t total_pixels = w * h;
    for (uint32_t i = 0; i < total_pixels; i++) {
        uint32_t px = color_p[i].full;
        line_buf[i] = ((px >> 8) & 0xF800) | ((px >> 5) & 0x07E0) | ((px >> 3) & 0x001F);
    }
    gfx->draw16bitRGBBitmap(area->x1, area->y1, line_buf, w, h);
#else
    gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t *)color_p, w, h);
#endif

    gfx->flush(); // Đẩy toàn bộ bộ đệm Canvas 480x272 ra màn hình phần cứng
    lv_disp_flush_ready(disp_drv);
}

/* Callback đọc cảm ứng GT911 (Đã hỗ trợ lật/đảo tọa độ) */
void my_touch_read(lv_indev_drv_t *indev_drv, lv_indev_data_t *data) {
    ts.read();
    if (ts.isTouched && ts.touches > 0) {
        data->state = LV_INDEV_STATE_PR;
        int16_t x = ts.points[0].x;
        int16_t y = ts.points[0].y;

#if TOUCH_SWAP_XY
        int16_t temp = x;
        x = y;
        y = temp;
#endif

#if TOUCH_INVERT_X
        x = 480 - x;
#endif

#if TOUCH_INVERT_Y
        y = 272 - y;
#endif

        if (x < 0) x = 0;
        if (x >= 480) x = 479;
        if (y < 0) y = 0;
        if (y >= 272) y = 271;

        data->point.x = x;
        data->point.y = y;
    } else {
        data->state = LV_INDEV_STATE_REL;
    }
}

// Hàm khởi tạo và kết nối WiFi
void initWiFi() {
    if (strlen(WIFI_SSID) == 0 || strcmp(WIFI_SSID, "Tên_WiFi_Của_Bạn") == 0) {
        Serial.println("[WiFi] Vui lòng nhập Tên WiFi và Mật khẩu trong main.cpp!");
        return;
    }

    Serial.print("[WiFi] Đang kết nối tới: ");
    Serial.println(WIFI_SSID);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < 20) {
        delay(500);
        Serial.print(".");
        retry++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] Kết nối THÀNH CÔNG!");
        Serial.print("[WiFi] Địa chỉ IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[WiFi] Kết nối THẤT BẠI (Timeout)!");
    }
}

// Callback cập nhật nhãn TemperatureMin khi xoay Arc Min
static void arc_min_cb(lv_event_t * e) {
    lv_obj_t * arc = lv_event_get_target(e);
    int32_t val = lv_arc_get_value(arc);
    if (ui_TemperatureMin) {
        lv_label_set_text_fmt(ui_TemperatureMin, "%d", (int)val);
    }
}

// Callback cập nhật nhãn TemperatureMax khi xoay Arc Max
static void arc_max_cb(lv_event_t * e) {
    lv_obj_t * arc = lv_event_get_target(e);
    int32_t val = lv_arc_get_value(arc);
    if (ui_TemperatureMax) {
        lv_label_set_text_fmt(ui_TemperatureMax, "%d", (int)val);
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("=====================================");
    Serial.println(" Starting JC4827W543 Display Test... ");
    Serial.println("=====================================");

    // Khởi tạo UART1 làm Modbus RTU Master Poll (TX: GPIO 17, RX: GPIO 18, Baud: 115200, Target Slave ID: 1, Poll: 500ms)
    Serial1.begin(UART1_BAUD, SERIAL_8N1, UART1_RX_PIN, UART1_TX_PIN);
    modbus.begin(&Serial1, 1, 500, on_modbus_data_received);
    Serial.println("[Modbus RTU Master] Khởi tạo thành công Master Poll trên UART1 (COM3, 115200 8N1, Target Slave ID: 1, Poll: 500ms)");

    // Cấu hình Cổng P2 (EC11 #1 - Điều khiển Min Temperature)
    pinMode(EC11_GND_PIN, OUTPUT);
    digitalWrite(EC11_GND_PIN, LOW); // Cấp 0V qua IO9

    pinMode(EC11_CLK_PIN, INPUT_PULLUP);
    pinMode(EC11_DT_PIN, INPUT_PULLUP);
    pinMode(EC11_SW_PIN, INPUT_PULLUP);

    enc_prevState = (digitalRead(EC11_CLK_PIN) << 1) | digitalRead(EC11_DT_PIN);
    attachInterrupt(digitalPinToInterrupt(EC11_CLK_PIN), ec11_isr, CHANGE);
    attachInterrupt(digitalPinToInterrupt(EC11_DT_PIN), ec11_isr, CHANGE);
    Serial.println("[EC11 #1] Cổng P2: SW=IO46, GND=IO9 (0V), PhaseA=IO14, PhaseB=IO5");

    // Cấu hình Cổng P3 (EC11 #2 - Điều khiển Max Temperature)
    pinMode(EC11_2_GND_PIN, OUTPUT);
    digitalWrite(EC11_2_GND_PIN, LOW); // Cấp 0V qua IO7

    pinMode(EC11_2_CLK_PIN, INPUT_PULLUP);
    pinMode(EC11_2_DT_PIN, INPUT_PULLUP);
    pinMode(EC11_2_SW_PIN, INPUT_PULLUP);

    enc2_prevState = (digitalRead(EC11_2_CLK_PIN) << 1) | digitalRead(EC11_2_DT_PIN);
    attachInterrupt(digitalPinToInterrupt(EC11_2_CLK_PIN), ec11_2_isr, CHANGE);
    attachInterrupt(digitalPinToInterrupt(EC11_2_DT_PIN), ec11_2_isr, CHANGE);
    Serial.println("[EC11 #2] Cổng P3: SW=IO6, GND=IO7 (0V), PhaseA=IO15, PhaseB=IO16");

    // Kết nối WiFi
    initWiFi();

    // Bật đèn nền & cấp nguồn màn hình (GPIO 1, GPIO 2, GPIO 38)
    pinMode(1, OUTPUT);
    digitalWrite(1, HIGH);
    pinMode(2, OUTPUT);
    digitalWrite(2, HIGH);
    pinMode(38, OUTPUT);
    digitalWrite(38, HIGH);

    // Khởi tạo màn hình
    if (!gfx->begin()) {
        Serial.println("gfx->begin() FAILED!");
    } else {
        Serial.println("gfx->begin() SUCCESS!");
    }

    // Đặt hướng xoay màn hình chuẩn
    gfx->setRotation(DISPLAY_ROTATION);

    // Tô màu đỏ màn hình để kiểm tra đèn nền & phần cứng
    gfx->fillScreen(RED);
    delay(1000);
    gfx->fillScreen(BLACK);

    // Khởi tạo cảm ứng GT911
    ts.begin();

    // Khởi tạo LVGL 8.3 dùng bộ đệm an toàn trong RAM nội bộ
    lv_init();
    static lv_disp_draw_buf_t draw_buf;
    static lv_color_t buf1[480 * 30]; // 28.8KB RAM nội bộ an toàn 100%
    lv_disp_draw_buf_init(&draw_buf, buf1, NULL, 480 * 30);

    // Đăng ký Driver hiển thị LVGL
    static lv_disp_drv_t disp_drv;
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = 480;
    disp_drv.ver_res = 272;
    disp_drv.flush_cb = my_disp_flush;
    disp_drv.draw_buf = &draw_buf;
    lv_disp_drv_register(&disp_drv);

    // Đăng ký Driver cảm ứng LVGL
    static lv_indev_drv_t indev_drv;
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = my_touch_read;
    lv_indev_drv_register(&indev_drv);

    // Khởi tạo UI từ SquareLine Studio!
    Serial.println("Calling ui_init()...");
    ui_init();

    // 1. Ép màu nền Đen Tuyền (0x000000) tối đa độ tương phản
    if (lv_scr_act()) {
        lv_obj_set_style_bg_opa(lv_scr_act(), LV_OPA_COVER, 0);
        lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(0x000000), 0);
        lv_obj_invalidate(lv_scr_act());
    }

    // 2. Cấu hình Arc Min: Giới hạn từ 20 đến 120, đặt giá trị ban đầu là 50
    if (ui_ArcMin) {
        lv_arc_set_range(ui_ArcMin, 20, 120);
        lv_arc_set_value(ui_ArcMin, 50); // Khởi tạo 50°C để xoay tăng hay giảm đều thấy số nhảy ngay
        lv_obj_add_event_cb(ui_ArcMin, arc_min_cb, LV_EVENT_VALUE_CHANGED, NULL);
        if (ui_TemperatureMin) {
            lv_label_set_text(ui_TemperatureMin, "50");
        }
    }

    // 3. Cấu hình Arc Max: Giới hạn từ 40 đến 140, đặt giá trị ban đầu là 100°C
    if (ui_ArcMax) {
        lv_arc_set_range(ui_ArcMax, 40, 140);
        lv_arc_set_value(ui_ArcMax, 100); // Khởi tạo 100°C cho Arc Max
        lv_obj_add_event_cb(ui_ArcMax, arc_max_cb, LV_EVENT_VALUE_CHANGED, NULL);
        if (ui_TemperatureMax) {
            lv_label_set_text(ui_TemperatureMax, "100");
        }
    }

    // 4. Cấu hình Chart1 Giả Lập: 1 Series duy nhất, 30 mẫu, 2 giây/mẫu, cuộn FIFO, random 70~120°C
    if (ui_Chart1) {
        lv_chart_set_update_mode(ui_Chart1, LV_CHART_UPDATE_MODE_SHIFT); // Chế độ cuộn FIFO SHIFT
        lv_chart_set_point_count(ui_Chart1, 30); // 30 mẫu dữ liệu
        lv_chart_set_range(ui_Chart1, LV_CHART_AXIS_PRIMARY_Y, 0, 150);   // Trục Y bên trái: 0~150°C
        lv_chart_set_range(ui_Chart1, LV_CHART_AXIS_SECONDARY_Y, 0, 150); // Trục Y bên phải: 0~150°C
        
        // Lấy 1 Series duy nhất từ SquareLine Studio (loại bỏ series trùng lặp)
        ui_chart_series = lv_chart_get_series_next(ui_Chart1, NULL);
        if (!ui_chart_series) {
            ui_chart_series = lv_chart_add_series(ui_Chart1, lv_color_hex(0x10B981), LV_CHART_AXIS_PRIMARY_Y);
        } else {
            ui_chart_series->color = lv_color_hex(0x10B981); // Đổi màu sang Xanh Lá Neon
        }

        // Đặt baseline ban đầu cho biểu đồ
        for (int i = 0; i < 30; i++) {
            lv_chart_set_next_value(ui_Chart1, ui_chart_series, 0);
        }
    }

    // Đặt hiển thị ban đầu ở giữa màn hình là --.- (chờ nhận nhiệt độ từ Modbus Master Poll)
    if (ui_Temperture1) {
        lv_label_set_text(ui_Temperture1, "--.-");
    }

    // Giao diện WiFi GUI (Icon 📶 & Bàn phím cảm ứng)
    wifi_gui_init();

    Serial.println("UI Ready!");
}

void loop() {
    modbus.task();
    lv_timer_handler();
    modbus.task();

    // Định kỳ 2 giây tự động đồng bộ Min và Max hiện tại xuống ModSim32 (Slave)
    static uint32_t last_sync_thresholds = 0;
    if (millis() - last_sync_thresholds > 2000) {
        last_sync_thresholds = millis();
        int min_val = ui_ArcMin ? lv_arc_get_value(ui_ArcMin) : 50;
        int max_val = ui_ArcMax ? lv_arc_get_value(ui_ArcMax) : 100;
        modbus.writeSingleRegister(MB_REG_TEMP_MIN, min_val);
        delay(10);
        modbus.writeSingleRegister(MB_REG_TEMP_MAX, max_val);
    }

    // 1. XỬ LÝ EC11 #1 (CỔNG P2) - ĐIỀU KHIỂN MIN TEMPERATURE
    static int32_t last_reported_count = 0;
    int32_t diff = encoder_count - last_reported_count;
    if (abs(diff) >= 4) { // 4 bước chuyển trạng thái = đúng 1 khấc xoay cơ học (1 detent)
        int32_t delta = diff / 4; // Mỗi khấc xoay tăng/giảm chính xác 1 đơn vị, cực kỳ đầm và chuẩn
        last_reported_count += delta * 4;
        Serial.printf("[EC11 #1] Xoay: count=%d | Delta=%d\n", encoder_count, delta);

        if (ui_ArcMin) {
            int32_t cur_val = lv_arc_get_value(ui_ArcMin);
            int32_t new_val = cur_val + delta;
            if (new_val < 20) new_val = 20;
            if (new_val > 120) new_val = 120;

            lv_arc_set_value(ui_ArcMin, new_val);
            if (ui_TemperatureMin) {
                lv_label_set_text_fmt(ui_TemperatureMin, "%d", (int)new_val);
            }
            // Gửi FC06 ghi ngưỡng Min mới xuống Slave (ModSim32 trên PC qua COM3)
            modbus.writeSingleRegister(MB_REG_TEMP_MIN, new_val);
        }
    }

    // Đọc nút nhấn SW1 (IO46) - Bấm nút sẽ reset Min Temp về 50°C
    static uint32_t last_sw_press = 0;
    static bool sw_last_state = HIGH;
    bool sw_curr_state = digitalRead(EC11_SW_PIN);
    if (sw_last_state == HIGH && sw_curr_state == LOW) {
        if (millis() - last_sw_press > 250) {
            Serial.println("[EC11 #1] Nút nhấn SW (IO46) được BẤM -> Đặt lại 50°C");
            if (ui_ArcMin) {
                lv_arc_set_value(ui_ArcMin, 50);
                if (ui_TemperatureMin) lv_label_set_text(ui_TemperatureMin, "50");
            }
            modbus.writeSingleRegister(MB_REG_TEMP_MIN, 50);
            last_sw_press = millis();
        }
    }
    sw_last_state = sw_curr_state;

    // Log realtime mỗi khi có xung encoder 1 thay đổi
    static int32_t last_raw_count = 0;
    if (encoder_count != last_raw_count) {
        Serial.printf("[EC11 #1 Raw] count=%d (CLK=%d, DT=%d)\n", encoder_count, digitalRead(EC11_CLK_PIN), digitalRead(EC11_DT_PIN));
        last_raw_count = encoder_count;
    }

    // 2. XỬ LÝ EC11 #2 (CỔNG P3) - ĐIỀU KHIỂN MAX TEMPERATURE
    static int32_t last_reported_count2 = 0;
    int32_t diff2 = encoder2_count - last_reported_count2;
    if (abs(diff2) >= 4) { // 4 bước chuyển trạng thái = đúng 1 khấc xoay cơ học (1 detent)
        int32_t delta2 = diff2 / 4;
        last_reported_count2 += delta2 * 4;
        Serial.printf("[EC11 #2] Xoay: count=%d | Delta=%d\n", encoder2_count, delta2);

        if (ui_ArcMax) {
            int32_t cur_val = lv_arc_get_value(ui_ArcMax);
            int32_t new_val = cur_val + delta2;
            if (new_val < 40) new_val = 40;
            if (new_val > 140) new_val = 140;

            lv_arc_set_value(ui_ArcMax, new_val);
            if (ui_TemperatureMax) {
                lv_label_set_text_fmt(ui_TemperatureMax, "%d", (int)new_val);
            }
            // Gửi FC06 ghi ngưỡng Max mới xuống Slave (ModSim32 trên PC qua COM3)
            modbus.writeSingleRegister(MB_REG_TEMP_MAX, new_val);
        }
    }

    // Đọc nút nhấn SW2 (IO6) - Bấm nút sẽ reset Max Temp về 100°C
    static uint32_t last_sw2_press = 0;
    static bool sw2_last_state = HIGH;
    bool sw2_curr_state = digitalRead(EC11_2_SW_PIN);
    if (sw2_last_state == HIGH && sw2_curr_state == LOW) {
        if (millis() - last_sw2_press > 250) {
            Serial.println("[EC11 #2] Nút nhấn SW (IO6) được BẤM -> Đặt lại 100°C");
            if (ui_ArcMax) {
                lv_arc_set_value(ui_ArcMax, 100);
                if (ui_TemperatureMax) lv_label_set_text(ui_TemperatureMax, "100");
            }
            modbus.writeSingleRegister(MB_REG_TEMP_MAX, 100);
            last_sw2_press = millis();
        }
    }
    sw2_last_state = sw2_curr_state;

    // Log realtime mỗi khi có xung encoder 2 thay đổi
    static int32_t last_raw_count2 = 0;
    if (encoder2_count != last_raw_count2) {
        Serial.printf("[EC11 #2 Raw] count=%d (CLK=%d, DT=%d)\n", encoder2_count, digitalRead(EC11_2_CLK_PIN), digitalRead(EC11_2_DT_PIN));
        last_raw_count2 = encoder2_count;
    }

    delay(2);
}
