/**
 * @file wifi_gui.cpp
 * LVGL 8.3 Touch WiFi Setup GUI (Modal Dialog Overlay) tailored for 480x272 Resolution
 */

#include "wifi_gui.h"

static lv_obj_t * wifi_modal = NULL;
static lv_obj_t * wifi_ssid_dd = NULL;
static lv_obj_t * wifi_pass_ta = NULL;
static lv_obj_t * wifi_kb = NULL;
static lv_obj_t * wifi_status_label = NULL;
static lv_obj_t * wifi_btn_scan = NULL;
static lv_obj_t * wifi_btn_connect = NULL;

static void wifi_scan_cb(lv_event_t * e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_CLICKED) {
        lv_label_set_text(wifi_status_label, "Status: Scanning nearby WiFi...");
        lv_timer_handler();

        int n = WiFi.scanNetworks();
        if (n == 0) {
            lv_label_set_text(wifi_status_label, "Status: No WiFi found!");
            lv_dropdown_clear_options(wifi_ssid_dd);
            lv_dropdown_set_options(wifi_ssid_dd, "No WiFi Found");
        } else {
            String options = "";
            for (int i = 0; i < n; ++i) {
                if (i > 0) options += "\n";
                options += WiFi.SSID(i);
            }
            lv_dropdown_clear_options(wifi_ssid_dd);
            lv_dropdown_set_options(wifi_ssid_dd, options.c_str());
            String status = "Found " + String(n) + " networks. Select one below:";
            lv_label_set_text(wifi_status_label, status.c_str());
        }
        WiFi.scanDelete();
    }
}

static void wifi_connect_cb(lv_event_t * e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_CLICKED) {
        char ssid[64];
        lv_dropdown_get_selected_str(wifi_ssid_dd, ssid, sizeof(ssid));
        const char * pass = lv_textarea_get_text(wifi_pass_ta);

        if (strlen(ssid) == 0 || strcmp(ssid, "No WiFi Found") == 0 || strcmp(ssid, "Click Scan to Find WiFi") == 0) {
            lv_label_set_text(wifi_status_label, "Status: Please select a valid WiFi!");
            return;
        }

        String status_msg = "Connecting to " + String(ssid) + "...";
        lv_label_set_text(wifi_status_label, status_msg.c_str());
        lv_timer_handler();

        WiFi.mode(WIFI_STA);
        WiFi.begin(ssid, pass);

        int retry = 0;
        while (WiFi.status() != WL_CONNECTED && retry < 15) {
            delay(400);
            lv_timer_handler();
            retry++;
        }

        if (WiFi.status() == WL_CONNECTED) {
            String ip_msg = "Connected! IP: " + WiFi.localIP().toString();
            lv_label_set_text(wifi_status_label, ip_msg.c_str());
        } else {
            lv_label_set_text(wifi_status_label, "Connection Failed! Check password.");
        }
    }
}

static void wifi_close_cb(lv_event_t * e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_CLICKED) {
        wifi_gui_close();
    }
}

static void ta_event_cb(lv_event_t * e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_FOCUSED) {
        if (wifi_kb && wifi_pass_ta) {
            lv_keyboard_set_textarea(wifi_kb, wifi_pass_ta);
            lv_obj_clear_flag(wifi_kb, LV_OBJ_FLAG_HIDDEN);
            lv_obj_move_foreground(wifi_kb); // Đẩy bàn phím lên lớp trên cùng phía trước Modal
            if (wifi_modal) {
                lv_obj_align(wifi_modal, LV_ALIGN_TOP_MID, 0, 2);
            }
        }
    } else if (code == LV_EVENT_DEFOCUSED) {
        if (wifi_kb) {
            lv_keyboard_set_textarea(wifi_kb, NULL);
            lv_obj_add_flag(wifi_kb, LV_OBJ_FLAG_HIDDEN);
            if (wifi_modal) {
                lv_obj_center(wifi_modal);
            }
        }
    }
}

static void kb_event_cb(lv_event_t * e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_READY || code == LV_EVENT_CANCEL) {
        if (wifi_kb) {
            lv_obj_add_flag(wifi_kb, LV_OBJ_FLAG_HIDDEN);
        }
        if (wifi_modal) {
            lv_obj_center(wifi_modal);
        }
    }
}

void wifi_gui_open(void) {
    if (wifi_modal) {
        lv_obj_clear_flag(wifi_modal, LV_OBJ_FLAG_HIDDEN);
        lv_obj_center(wifi_modal);
        lv_obj_move_foreground(wifi_modal);
        if (wifi_kb) {
            lv_obj_move_foreground(wifi_kb);
        }
    }
}

void wifi_gui_close(void) {
    if (wifi_modal) {
        lv_obj_add_flag(wifi_modal, LV_OBJ_FLAG_HIDDEN);
    }
    if (wifi_kb) {
        lv_obj_add_flag(wifi_kb, LV_OBJ_FLAG_HIDDEN);
    }
}

void wifi_gui_init(void) {
    lv_obj_t * scr = lv_scr_act();
    if (!scr) return;

    // 1. Tạo Nút Icon WiFi 📶 ở mép dưới căn giữa màn hình (Hạ thấp 5px)
    lv_obj_t * btn_wifi_icon = lv_btn_create(scr);
    lv_obj_set_size(btn_wifi_icon, 50, 40);
    lv_obj_align(btn_wifi_icon, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_opa(btn_wifi_icon, LV_OPA_TRANSP, 0); // Trong suốt 100% không background
    lv_obj_set_style_shadow_width(btn_wifi_icon, 0, 0);       // Bỏ bóng mờ
    lv_obj_set_style_border_width(btn_wifi_icon, 0, 0);       // Bỏ viền
    lv_obj_add_event_cb(btn_wifi_icon, [](lv_event_t * e){ wifi_gui_open(); }, LV_EVENT_CLICKED, NULL);

    lv_obj_t * lbl_icon = lv_label_create(btn_wifi_icon);
    lv_label_set_text(lbl_icon, LV_SYMBOL_WIFI);
    lv_obj_set_style_text_color(lbl_icon, lv_color_hex(0x38BDF8), 0); // สี Cyan nổi bật
    lv_obj_center(lbl_icon);

    // 2. Tạo Modal Dialog cấu hình WiFi chuẩn 460x245px cho màn hình 480x272
    wifi_modal = lv_obj_create(scr);
    lv_obj_set_size(wifi_modal, 460, 245);
    lv_obj_center(wifi_modal);
    lv_obj_set_style_bg_color(wifi_modal, lv_color_hex(0x111827), 0); // Dark Theme Background
    lv_obj_set_style_border_color(wifi_modal, lv_color_hex(0x3B82F6), 0); // Blue Border
    lv_obj_set_style_border_width(wifi_modal, 2, 0);
    lv_obj_set_style_radius(wifi_modal, 10, 0);
    lv_obj_set_style_pad_all(wifi_modal, 8, 0);
    lv_obj_clear_flag(wifi_modal, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(wifi_modal, LV_OBJ_FLAG_HIDDEN); // Mặc định ẩn

    // Tiêu đề Modal
    lv_obj_t * title = lv_label_create(wifi_modal);
    lv_label_set_text(title, LV_SYMBOL_WIFI "  WiFi Manager");
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 6, 2);
    lv_obj_set_style_text_color(title, lv_color_hex(0xF9FAFB), 0);

    // Nút Đóng (X)
    lv_obj_t * btn_close = lv_btn_create(wifi_modal);
    lv_obj_set_size(btn_close, 32, 28);
    lv_obj_align(btn_close, LV_ALIGN_TOP_RIGHT, 0, -2);
    lv_obj_set_style_bg_color(btn_close, lv_color_hex(0xEF4444), 0);
    lv_obj_set_style_radius(btn_close, 6, 0);
    lv_obj_add_event_cb(btn_close, wifi_close_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lbl_x = lv_label_create(btn_close);
    lv_label_set_text(lbl_x, "X");
    lv_obj_center(lbl_x);

    // Status Label (Dòng trạng thái)
    wifi_status_label = lv_label_create(wifi_modal);
    lv_label_set_text(wifi_status_label, "Status: Disconnected");
    lv_obj_align(wifi_status_label, LV_ALIGN_TOP_LEFT, 6, 30);
    lv_obj_set_style_text_color(wifi_status_label, lv_color_hex(0x9CA3AF), 0);

    // Dòng 1: Dropdown Tên WiFi + Nút Scan
    wifi_ssid_dd = lv_dropdown_create(wifi_modal);
    lv_obj_set_size(wifi_ssid_dd, 280, 38);
    lv_obj_align(wifi_ssid_dd, LV_ALIGN_TOP_LEFT, 6, 56);
    lv_dropdown_set_options(wifi_ssid_dd, "Click Scan to Find WiFi");

    wifi_btn_scan = lv_btn_create(wifi_modal);
    lv_obj_set_size(wifi_btn_scan, 120, 38);
    lv_obj_align(wifi_btn_scan, LV_ALIGN_TOP_RIGHT, -6, 56);
    lv_obj_set_style_bg_color(wifi_btn_scan, lv_color_hex(0xF59E0B), 0); // Amber
    lv_obj_set_style_radius(wifi_btn_scan, 6, 0);
    lv_obj_add_event_cb(wifi_btn_scan, wifi_scan_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lbl_scan = lv_label_create(wifi_btn_scan);
    lv_label_set_text(lbl_scan, LV_SYMBOL_REFRESH " Scan");
    lv_obj_center(lbl_scan);

    // Dòng 2: Ô nhập Mật khẩu + Nút Connect
    wifi_pass_ta = lv_textarea_create(wifi_modal);
    lv_textarea_set_password_mode(wifi_pass_ta, true);
    lv_textarea_set_placeholder_text(wifi_pass_ta, "Enter Password");
    lv_obj_set_size(wifi_pass_ta, 280, 38);
    lv_obj_align(wifi_pass_ta, LV_ALIGN_TOP_LEFT, 6, 102);
    lv_obj_add_event_cb(wifi_pass_ta, ta_event_cb, LV_EVENT_ALL, NULL);

    wifi_btn_connect = lv_btn_create(wifi_modal);
    lv_obj_set_size(wifi_btn_connect, 120, 38);
    lv_obj_align(wifi_btn_connect, LV_ALIGN_TOP_RIGHT, -6, 102);
    lv_obj_set_style_bg_color(wifi_btn_connect, lv_color_hex(0x10B981), 0); // Green
    lv_obj_set_style_radius(wifi_btn_connect, 6, 0);
    lv_obj_add_event_cb(wifi_btn_connect, wifi_connect_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t * lbl_conn = lv_label_create(wifi_btn_connect);
    lv_label_set_text(lbl_conn, LV_SYMBOL_OK " Connect");
    lv_obj_center(lbl_conn);

    // 3. Bàn phím cảm ứng ảo LVGL (Virtual Keyboard) kích thước 470x120px
    wifi_kb = lv_keyboard_create(scr);
    lv_obj_set_size(wifi_kb, 470, 120);
    lv_obj_align(wifi_kb, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_event_cb(wifi_kb, kb_event_cb, LV_EVENT_ALL, NULL);
    lv_obj_add_flag(wifi_kb, LV_OBJ_FLAG_HIDDEN); // Mặc định ẩn bàn phím
}
