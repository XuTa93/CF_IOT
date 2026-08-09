@echo off
echo ===================================================
echo  LVGL PC Simulator - Setup External Dependencies   
echo ===================================================
if not exist "lvgl" (
    echo Downloading LVGL v8.3.11 library...
    git clone --branch v8.3.11 --depth 1 https://github.com/lvgl/lvgl.git lvgl
    echo Download completed successfully!
) else (
    echo [INFO] Folder 'lvgl' already exists. Skipping download.
)
echo.
echo Setup completed! You can now build or press F5 in VS Code.
pause
