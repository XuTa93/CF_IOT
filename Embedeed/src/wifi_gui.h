/**
 * @file wifi_gui.h
 * LVGL 8.3 Touch WiFi Setup GUI (Modal Dialog Overlay) for ESP32-S3
 */

#ifndef WIFI_GUI_H
#define WIFI_GUI_H

#include <Arduino.h>
#include <WiFi.h>
#include <lvgl.h>

void wifi_gui_init(void);
void wifi_gui_open(void);
void wifi_gui_close(void);

#endif // WIFI_GUI_H
