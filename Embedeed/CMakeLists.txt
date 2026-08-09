cmake_minimum_required(VERSION 3.12)
project(lvgl_simulator C CXX)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)

# Include root directory for lv_conf.h and ui headers
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/lvgl
    ${CMAKE_CURRENT_SOURCE_DIR}/ui
)

# Enable LV_CONF_INCLUDE_SIMPLE
add_compile_definitions(LV_CONF_INCLUDE_SIMPLE)
add_compile_definitions(LV_LVGL_H_INCLUDE_SIMPLE)

# Find SDL2
find_package(SDL2 REQUIRED)
include_directories(${SDL2_INCLUDE_DIRS})

# Add LVGL library
add_subdirectory(lvgl)

# Add UI library
add_subdirectory(ui)
target_include_directories(ui PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/ui
    ${CMAKE_CURRENT_SOURCE_DIR}/lvgl
)

# Executable target
add_executable(lvgl_simulator main.c)

target_link_libraries(lvgl_simulator PRIVATE
    ui
    lvgl
    ${SDL2_LIBRARIES}
)

if (WIN32)
    target_link_options(lvgl_simulator PRIVATE "-mconsole")
endif()
