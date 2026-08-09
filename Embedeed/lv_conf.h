/**
 * @file lv_conf.h
 * Configuration file for LVGL v8.3.11 for PC Simulator
 */

#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

/*====================
   COLOR SETTINGS
 *====================*/

/* Color depth: 32 (ARGB8888) to match SquareLine Studio export */
#define LV_COLOR_DEPTH 32
#define LV_COLOR_16_SWAP 0

/* Enable features to draw on transparent background */
#define LV_COLOR_SCREEN_TRANSP 0

/* Adjust color mix functions rounding */
#define LV_COLOR_MIX_ROUND_OFS 0

/* Images pixels with this color will not be drawn if chroma keyed */
#define LV_COLOR_CHROMA_KEY lv_color_hex(0x00ff00)

/*=========================
   MEMORY SETTINGS
 *=========================*/

#define LV_MEM_CUSTOM 0
#if LV_MEM_CUSTOM == 0
    #if defined(ESP_PLATFORM) || defined(ARDUINO)
        #define LV_MEM_SIZE (128U * 1024U) /* 128KB RAM for ESP32 */
    #else
        #define LV_MEM_SIZE (8U * 1024U * 1024U) /* 8MB RAM for PC simulator */
    #endif
    #define LV_MEM_ADR 0
#endif

#define LV_MEM_BUF_MAX_NUM 16
#define LV_MEMCPY_MEMSET_STD 0

/*====================
   HAL SETTINGS
 *====================*/

#define LV_DISP_DEF_REFR_PERIOD 16 /* 60 FPS */
#define LV_INDEV_DEF_READ_PERIOD 16
#define LV_DPI_DEF 130

/* Custom tick source (millis on ESP32, SDL_GetTicks on PC) */
#define LV_TICK_CUSTOM 1
#if LV_TICK_CUSTOM
    #if defined(ESP_PLATFORM) || defined(ARDUINO)
        #define LV_TICK_CUSTOM_INCLUDE <Arduino.h>
        #define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())
    #else
        #define LV_TICK_CUSTOM_INCLUDE "SDL2/SDL.h"
        #define LV_TICK_CUSTOM_SYS_TIME_EXPR (SDL_GetTicks())
    #endif
#endif

/*=======================
 * FEATURE CONFIGURATION
 *=======================*/

#define LV_USE_LOG 1
#if LV_USE_LOG
    #define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
    #define LV_LOG_PRINTF 1
#endif

#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

/*==================
 * FONT USAGE
 *==================*/

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_48 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

/*===================
 * WIDGET USAGE
 *===================*/

#define LV_USE_ARC        1
#define LV_USE_BAR        1
#define LV_USE_BTN        1
#define LV_USE_BTNMATRIX  1
#define LV_USE_CANVAS     1
#define LV_USE_CHECKBOX   1
#define LV_USE_DROPDOWN   1
#define LV_USE_IMG        1
#define LV_USE_LABEL      1
#define LV_LABEL_TEXT_SELECTION 1
#define LV_LABEL_LONG_TXT_HINT 1
#define LV_USE_LINE       1
#define LV_USE_ROLLER     1
#define LV_USE_SLIDER     1
#define LV_USE_SWITCH     1
#define LV_USE_TEXTAREA   1
#define LV_USE_TABLE      1

/* Extra Widgets */
#define LV_USE_ANIMIMG    1
#define LV_USE_CALENDAR   1
#define LV_USE_CHART      1
#define LV_USE_COLORWHEEL 1
#define LV_USE_IMGBTN     1
#define LV_USE_KEYBOARD   1
#define LV_USE_MBOX       1
#define LV_USE_METER      1
#define LV_USE_SPINBOX    1
#define LV_USE_SPINNER    1
#define LV_USE_TABVIEW    1
#define LV_USE_TILEVIEW   1
#define LV_USE_WIN        1
#define LV_USE_SPAN       1

/* Layouts */
#define LV_USE_FLEX 1
#define LV_USE_GRID 1

#endif /* LV_CONF_H */
