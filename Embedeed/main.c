#ifndef ARDUINO

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <SDL2/SDL.h>

#include "lvgl/lvgl.h"
#include "ui/ui.h"

#define DISP_HOR_RES 480
#define DISP_VER_RES 272

static SDL_Window * window = NULL;
static SDL_Renderer * renderer = NULL;
static SDL_Texture * texture = NULL;
static uint32_t lcd_buf[DISP_HOR_RES * DISP_VER_RES];

static int mouse_x = 0;
static int mouse_y = 0;
static bool mouse_pressed = false;

/* LVGL Display Flush Callback */
static void sdl_disp_flush(lv_disp_drv_t * disp_drv, const lv_area_t * area, lv_color_t * color_p)
{
    int32_t w = area->x2 - area->x1 + 1;
    int32_t h = area->y2 - area->y1 + 1;

    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            int px = area->x1 + x;
            int py = area->y1 + y;
            if (px >= 0 && px < DISP_HOR_RES && py >= 0 && py < DISP_VER_RES) {
                lcd_buf[py * DISP_HOR_RES + px] = color_p[y * w + x].full;
            }
        }
    }

    SDL_UpdateTexture(texture, NULL, lcd_buf, DISP_HOR_RES * sizeof(uint32_t));
    SDL_RenderClear(renderer);
    SDL_RenderCopy(renderer, texture, NULL, NULL);
    SDL_RenderPresent(renderer);

    lv_disp_flush_ready(disp_drv);
}

/* LVGL Mouse Read Callback */
static void sdl_mouse_read(lv_indev_drv_t * indev_drv, lv_indev_data_t * data)
{
    (void)indev_drv;
    data->point.x = (lv_coord_t)mouse_x;
    data->point.y = (lv_coord_t)mouse_y;
    data->state = mouse_pressed ? LV_INDEV_STATE_PR : LV_INDEV_STATE_REL;
}

int main(int argc, char * argv[])
{
    (void)argc;
    (void)argv;

    printf("==========================================\n");
    printf(" Starting LVGL v8 PC Simulator \n");
    printf(" Resolution: %dx%d \n", DISP_HOR_RES, DISP_VER_RES);
    printf("==========================================\n");
    fflush(stdout);

    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        printf("SDL_Init Error: %s\n", SDL_GetError());
        return 1;
    }

    window = SDL_CreateWindow("LVGL 8.3.11 Simulator - Debug UI",
                              SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                              DISP_HOR_RES, DISP_VER_RES,
                              SDL_WINDOW_SHOWN);
    if (!window) {
        printf("SDL_CreateWindow Error: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!renderer) {
        renderer = SDL_CreateRenderer(window, -1, 0);
    }
    if (!renderer) {
        printf("SDL_CreateRenderer Error: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_ARGB8888,
                                SDL_TEXTUREACCESS_STREAMING,
                                DISP_HOR_RES, DISP_VER_RES);
    if (!texture) {
        printf("SDL_CreateTexture Error: %s\n", SDL_GetError());
        SDL_DestroyRenderer(renderer);
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    /* Initialize LVGL Core */
    lv_init();

    /* Initialize Display Buffer */
    static lv_disp_draw_buf_t disp_buf;
    static lv_color_t buf1[DISP_HOR_RES * 40];
    static lv_color_t buf2[DISP_HOR_RES * 40];
    lv_disp_draw_buf_init(&disp_buf, buf1, buf2, DISP_HOR_RES * 40);

    /* Register Display Driver */
    static lv_disp_drv_t disp_drv;
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = DISP_HOR_RES;
    disp_drv.ver_res = DISP_VER_RES;
    disp_drv.flush_cb = sdl_disp_flush;
    disp_drv.draw_buf = &disp_buf;
    lv_disp_drv_register(&disp_drv);

    /* Register Input (Mouse) Driver */
    static lv_indev_drv_t indev_drv;
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = sdl_mouse_read;
    lv_indev_drv_register(&indev_drv);

    /* Initialize SquareLine Studio UI */
    ui_init();

    printf("UI Initialized successfully. Displaying window...\n");
    fflush(stdout);

    /* Main Loop */
    bool running = true;
    SDL_Event event;

    while (running) {
        while (SDL_PollEvent(&event)) {
            switch (event.type) {
                case SDL_QUIT:
                    running = false;
                    break;
                case SDL_MOUSEBUTTONDOWN:
                    if (event.button.button == SDL_BUTTON_LEFT) {
                        mouse_pressed = true;
                        mouse_x = event.button.x;
                        mouse_y = event.button.y;
                    }
                    break;
                case SDL_MOUSEBUTTONUP:
                    if (event.button.button == SDL_BUTTON_LEFT) {
                        mouse_pressed = false;
                    }
                    break;
                case SDL_MOUSEMOTION:
                    mouse_x = event.motion.x;
                    mouse_y = event.motion.y;
                    break;
                default:
                    break;
            }
        }

        /* Task Handler for animations, input & layout updates */
        lv_timer_handler();
        SDL_Delay(5);
    }

    /* Cleanup */
    SDL_DestroyTexture(texture);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();

    return 0;
}

#endif /* ARDUINO */
