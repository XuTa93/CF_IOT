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

// Cấu hình UART1 kết nối RP2040
#define UART1_TX_PIN 17
#define UART1_RX_PIN 18
#define UART1_BAUD   115200

// Cấu hình Rotary Encoder EC11 (Connector 4 chân: IO6, IO7, IO15, IO16)
#define EC11_CLK_PIN  6   // Chân CLK (Phase A)
#define EC11_DT_PIN   7   // Chân DT (Phase B)
#define EC11_SW_PIN   15  // Chân SW (Nút nhấn)
#define EC11_GND_PIN  16  // Chân GND mềm (Cấu hình OUTPUT 0V)

static volatile int32_t encoder_count = 0;
static int last_clk_state = HIGH;

void IRAM_ATTR ec11_isr() {
    int clk_val = digitalRead(EC11_CLK_PIN);
    int dt_val = digitalRead(EC11_DT_PIN);
    
    if (clk_val != last_clk_state && clk_val == LOW) {
        if (dt_val != clk_val) {
            encoder_count++; // Xoay theo chiều kim đồng hồ (CW)
        } else {
            encoder_count--; // Xoay ngược chiều kim đồng hồ (CCW)
        }
    }
    last_clk_state = clk_val;
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
// Biến Series & Giả lập nhiệt độ cho Chart1
static lv_chart_series_t * ui_chart_series = NULL;
static float sim_angle = 0.0f;

// Callback Timer 2 giây (2,000 ms) đọc giá trị từ ui_Temperture1 nạp vào Chart1 (30 mẫu, FIFO)
static void temp_chart_timer_cb(lv_timer_t * timer) {
    if (!ui_Chart1 || !ui_chart_series) return;

    // 1. Giả lập nhiệt độ ngẫu nhiên từ 70.0 đến 120.0°C
    float sim_temp = 70.0f + (rand() % 501) / 10.0f; // 70.0 ~ 120.0 (bước 0.1)

    // 2. Cập nhật con số hiển thị chính (ui_Temperture1)
    //    Lưu ý: lv_label_set_text_fmt dùng lv_snprintf KHÔNG hỗ trợ %f (float)
    //    Phải dùng snprintf chuẩn C trước rồi truyền chuỗi vào lv_label_set_text
    if (ui_Temperture1) {
        char buf[16];
        snprintf(buf, sizeof(buf), "%.1f", sim_temp);
        lv_label_set_text(ui_Temperture1, buf);
    }

    // 3. Nạp giá trị vào biểu đồ (Thêm điểm mới ở cuối, tự động xoá điểm cũ ở đầu)
    int16_t chart_val = (int16_t)roundf(sim_temp);
    lv_chart_set_next_value(ui_Chart1, ui_chart_series, chart_val);
    lv_chart_refresh(ui_Chart1);
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("=====================================");
    Serial.println(" Starting JC4827W543 Display Test... ");
    Serial.println("=====================================");

    // Khởi tạo UART1 kết nối RP2040 (TX: GPIO 17, RX: GPIO 18, Baud: 115200)
    Serial1.begin(UART1_BAUD, SERIAL_8N1, UART1_RX_PIN, UART1_TX_PIN);
    Serial.println("[UART1] Khởi tạo thành công (TX: 17, RX: 18, Baud: 115200) kết nối RP2040");

    // Khởi tạo chân GND mềm (GPIO 16 = 0V) và chân đọc EC11 (CLK: 6, DT: 7, SW: 15)
    pinMode(EC11_GND_PIN, OUTPUT);
    digitalWrite(EC11_GND_PIN, LOW); // Cấp mát (0V) trực tiếp qua GPIO 16

    pinMode(EC11_CLK_PIN, INPUT_PULLUP);
    pinMode(EC11_DT_PIN, INPUT_PULLUP);
    pinMode(EC11_SW_PIN, INPUT_PULLUP);
    last_clk_state = digitalRead(EC11_CLK_PIN);
    attachInterrupt(digitalPinToInterrupt(EC11_CLK_PIN), ec11_isr, CHANGE);
    Serial.println("[EC11] Khởi tạo thành công (CLK: IO6, DT: IO7, SW: IO15, GND: IO16=0V)");

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

    // 2. Cấu hình Arc Min: Giới hạn từ 20 đến 120, liên kết tự động với ui_TemperatureMin
    if (ui_ArcMin) {
        lv_arc_set_range(ui_ArcMin, 20, 120);
        lv_obj_add_event_cb(ui_ArcMin, arc_min_cb, LV_EVENT_VALUE_CHANGED, NULL);
        if (ui_TemperatureMin) {
            lv_label_set_text_fmt(ui_TemperatureMin, "%d", (int)lv_arc_get_value(ui_ArcMin));
        }
    }

    // 3. Cấu hình Arc Max: Giới hạn từ 40 đến 140, liên kết tự động với ui_TemperatureMax
    if (ui_ArcMax) {
        lv_arc_set_range(ui_ArcMax, 40, 140);
        lv_obj_add_event_cb(ui_ArcMax, arc_max_cb, LV_EVENT_VALUE_CHANGED, NULL);
        if (ui_TemperatureMax) {
            lv_label_set_text_fmt(ui_TemperatureMax, "%d", (int)lv_arc_get_value(ui_ArcMax));
        }
    }

    // 4. Cấu hình Chart1 Giả Lập: 1 Series duy nhất, 30 mẫu, 2 giây/mẫu, cuộn FIFO, random 70~120°C
    if (ui_Chart1) {
        lv_chart_set_update_mode(ui_Chart1, LV_CHART_UPDATE_MODE_SHIFT); // Chế độ cuộn FIFO SHIFT
        lv_chart_set_point_count(ui_Chart1, 30); // 30 mẫu dữ liệu
        lv_chart_set_range(ui_Chart1, LV_CHART_AXIS_PRIMARY_Y, 60, 130);   // Trục Y bên trái: 60~130°C
        lv_chart_set_range(ui_Chart1, LV_CHART_AXIS_SECONDARY_Y, 60, 130); // Trục Y bên phải: 60~130°C (khớp bên trái)
        
        // Lấy 1 Series duy nhất từ SquareLine Studio (loại bỏ series trùng lặp)
        ui_chart_series = lv_chart_get_series_next(ui_Chart1, NULL);
        if (!ui_chart_series) {
            ui_chart_series = lv_chart_add_series(ui_Chart1, lv_color_hex(0x10B981), LV_CHART_AXIS_PRIMARY_Y);
        } else {
            ui_chart_series->color = lv_color_hex(0x10B981); // Đổi màu sang Xanh Lá Neon
        }

        // Nạp sẵn 30 mẫu ngẫu nhiên 70~120 ban đầu để lấp đầy biểu đồ
        for (int i = 0; i < 30; i++) {
            int16_t init_val = 70 + (rand() % 51); // Random 70 ~ 120
            lv_chart_set_next_value(ui_Chart1, ui_chart_series, init_val);
        }
        
        // Tạo Timer 2 giây (2,000 ms) chạy lấy mẫu giả lập
        lv_timer_create(temp_chart_timer_cb, 2000, NULL);
    }

    // Giao diện WiFi GUI (Icon 📶 & Bàn phím cảm ứng)
    wifi_gui_init();

    Serial.println("UI Ready!");
}

void loop() {
    lv_timer_handler();

    // Đọc dữ liệu nhận từ RP2040 qua UART1
    while (Serial1.available()) {
        char c = Serial1.read();
        Serial.print(c); // Chuyển tiếp dữ liệu RP2040 ra Serial Monitor để debug
    }

    // Đọc nút nhấn EC11 (SW) - Tối ưu Non-blocking (Không làm chậm UI / LVGL)
    static uint32_t last_sw_press = 0;
    static bool sw_last_state = HIGH;
    bool sw_curr_state = digitalRead(EC11_SW_PIN);

    if (sw_last_state == HIGH && sw_curr_state == LOW) {
        if (millis() - last_sw_press > 200) { // Chống dội phím non-blocking 200ms
            Serial.println("[EC11] Nút nhấn SW được BẤM!");
            last_sw_press = millis();
        }
    }
    sw_last_state = sw_curr_state;

    // Báo vị trí nấc xoay EC11 khi có thay đổi
    static int32_t last_reported_count = 0;
    if (encoder_count != last_reported_count) {
        Serial.printf("[EC11] Vị trí Encoder: %d\n", encoder_count);
        last_reported_count = encoder_count;
    }

    delay(5);
}
