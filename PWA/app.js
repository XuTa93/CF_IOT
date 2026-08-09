/**
 * CF IOT Dashboard - Progressive Web App
 * File: app.js
 * Mô tả: Logic chính cho PWA Dashboard giám sát IoT
 * - Giả lập dữ liệu sensor (Nhiệt độ, Độ ẩm, Áp suất, WiFi RSSI)
 * - Vẽ biểu đồ Canvas nhiệt độ theo thời gian thực
 * - Gauge nhiệt độ bằng conic-gradient
 * - Điều hướng SPA (Single Page App)
 * - Đăng ký Service Worker cho PWA offline
 */

// ============================================================
// 1. ĐĂNG KÝ SERVICE WORKER (PWA Offline)
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('[SW] Đăng ký thành công:', reg.scope))
            .catch(err => console.warn('[SW] Đăng ký thất bại:', err));
    });
}

// ============================================================
// 2. CẤU HÌNH & BIẾN TOÀN CỤC
// ============================================================
const CONFIG = {
    // Địa chỉ IP thiết bị ESP32 (Thay đổi trong Cài đặt)
    deviceIp: localStorage.getItem('cf_iot_ip') || '',
    devicePort: parseInt(localStorage.getItem('cf_iot_port')) || 80,
    updateInterval: parseInt(localStorage.getItem('cf_iot_interval')) || 2, // giây

    // Giới hạn nhiệt độ gauge
    tempMin: 0,
    tempMax: 150,

    // Số điểm dữ liệu tối đa trên biểu đồ
    maxDataPoints: 60,
};

// Dữ liệu sensor hiện tại
const sensorData = {
    temperature: 0,
    humidity: 0,
    pressure: 0,
    rssi: 0,
    history: [],       // Mảng lưu lịch sử nhiệt độ { time, value }
    tempMin: Infinity,
    tempMax: -Infinity,
    tempSum: 0,
    tempCount: 0,
};

// Danh sách thiết bị mẫu
const devices = [
    { id: 'esp32-main', name: 'ESP32-S3 Main', type: 'Bộ xử lý chính', status: 'online', ip: '192.168.1.100' },
    { id: 'rp2040', name: 'RP2040 Sensor', type: 'Đọc cảm biến', status: 'online', ip: '192.168.1.101' },
    { id: 'relay-board', name: 'Relay Board', type: '4 Kênh Relay', status: 'offline', ip: '192.168.1.102' },
    { id: 'display', name: 'JC4827W543', type: 'Màn hình 4.3"', status: 'online', ip: '192.168.1.100' },
];

// ============================================================
// 3. TIỆN ÍCH DOM
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
// 4. ĐỒNG HỒ THỜI GIAN THỰC
// ============================================================
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = $('#topbarTime');
    if (el) el.textContent = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

// ============================================================
// 5. ĐIỀU HƯỚNG SPA (Single Page Application)
// ============================================================
function initNavigation() {
    const navItems = $$('.nav-item');
    const pages = $$('.page');
    const topbarTitle = $('.topbar-title h1');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    const menuToggle = $('#menuToggle');

    const pageTitles = {
        dashboard: 'Dashboard',
        devices: 'Thiết bị',
        history: 'Lịch sử',
        settings: 'Cài đặt',
    };

    // Chuyển trang
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = item.dataset.page;

            // Cập nhật active nav
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Hiển thị trang tương ứng
            pages.forEach(p => p.classList.remove('active'));
            const page = $(`#page-${targetPage}`);
            if (page) page.classList.add('active');

            // Cập nhật tiêu đề topbar
            if (topbarTitle) topbarTitle.textContent = pageTitles[targetPage] || 'Dashboard';

            // Đóng sidebar trên mobile
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    });

    // Toggle sidebar trên mobile
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    });

    // Đóng sidebar khi click overlay
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });
}

// ============================================================
// 6. GIẢ LẬP DỮ LIỆU SENSOR (Khi chưa kết nối ESP32 thật)
// ============================================================
function generateSimulatedData() {
    // Nhiệt độ: dao động quanh 70~120°C (giống firmware ESP32)
    const baseTemp = 95;
    const variation = Math.sin(Date.now() / 10000) * 20 + (Math.random() - 0.5) * 5;
    sensorData.temperature = parseFloat((baseTemp + variation).toFixed(1));

    // Độ ẩm: 40~85%
    sensorData.humidity = Math.round(60 + Math.sin(Date.now() / 15000) * 15 + (Math.random() - 0.5) * 5);

    // Áp suất: 1000~1025 hPa
    sensorData.pressure = Math.round(1013 + Math.sin(Date.now() / 20000) * 10 + (Math.random() - 0.5) * 2);

    // WiFi RSSI: -30 đến -80 dBm
    sensorData.rssi = Math.round(-55 + Math.sin(Date.now() / 8000) * 15 + (Math.random() - 0.5) * 5);

    // Lưu lịch sử
    const now = new Date();
    sensorData.history.push({
        time: now,
        value: sensorData.temperature,
    });

    // Giữ tối đa maxDataPoints điểm
    if (sensorData.history.length > CONFIG.maxDataPoints) {
        sensorData.history.shift();
    }

    // Cập nhật min/max/avg
    sensorData.tempCount++;
    sensorData.tempSum += sensorData.temperature;
    if (sensorData.temperature < sensorData.tempMin) sensorData.tempMin = sensorData.temperature;
    if (sensorData.temperature > sensorData.tempMax) sensorData.tempMax = sensorData.temperature;
}

// ============================================================
// 7. CẬP NHẬT GIAO DIỆN (DOM Updates)
// ============================================================
function updateUI() {
    // ---- Thẻ thống kê ----
    const tempEl = $('#tempValue');
    const humEl = $('#humValue');
    const pressEl = $('#pressValue');
    const rssiEl = $('#rssiValue');

    if (tempEl) tempEl.textContent = sensorData.temperature.toFixed(1);
    if (humEl) humEl.textContent = sensorData.humidity;
    if (pressEl) pressEl.textContent = sensorData.pressure;
    if (rssiEl) rssiEl.textContent = sensorData.rssi;

    // Trend indicators
    if (sensorData.history.length >= 2) {
        const prev = sensorData.history[sensorData.history.length - 2].value;
        const curr = sensorData.temperature;
        const diff = ((curr - prev) / prev * 100).toFixed(1);
        const tempTrend = $('#tempTrend');
        if (tempTrend) {
            if (diff > 0) {
                tempTrend.textContent = `↑ ${diff}%`;
                tempTrend.className = 'card-trend card-trend--up';
            } else if (diff < 0) {
                tempTrend.textContent = `↓ ${Math.abs(diff)}%`;
                tempTrend.className = 'card-trend card-trend--down';
            } else {
                tempTrend.textContent = `→ 0.0%`;
                tempTrend.className = 'card-trend card-trend--neutral';
            }
        }
    }

    // ---- Gauge nhiệt độ ----
    updateGauge(sensorData.temperature);

    // ---- Min / Avg / Max ----
    const minEl = $('#tempMin');
    const avgEl = $('#tempAvg');
    const maxEl = $('#tempMax');
    if (minEl && sensorData.tempMin !== Infinity) minEl.textContent = sensorData.tempMin.toFixed(1) + '°';
    if (maxEl && sensorData.tempMax !== -Infinity) maxEl.textContent = sensorData.tempMax.toFixed(1) + '°';
    if (avgEl && sensorData.tempCount > 0) avgEl.textContent = (sensorData.tempSum / sensorData.tempCount).toFixed(1) + '°';

    // ---- Biểu đồ ----
    drawChart();
}

// ============================================================
// 8. GAUGE NHIỆT ĐỘ (Conic Gradient)
// ============================================================
function updateGauge(value) {
    const gaugeEl = $('#tempGauge');
    const valueEl = $('#gaugeValue');
    const fillEl = $('#gaugeFill');

    if (!gaugeEl || !fillEl) return;

    // Tính phần trăm (0 ~ 100) dựa trên khoảng 0 ~ 150°C
    const percent = Math.min(Math.max((value - CONFIG.tempMin) / (CONFIG.tempMax - CONFIG.tempMin) * 100, 0), 100);

    // Xác định màu theo mức nhiệt độ
    let color;
    if (value < 50) {
        color = '#3b82f6'; // Xanh dương - Lạnh
    } else if (value < 80) {
        color = '#00d4aa'; // Teal - Bình thường
    } else if (value < 110) {
        color = '#f59e0b'; // Vàng - Ấm
    } else {
        color = '#f43f5e'; // Đỏ - Nóng
    }

    // Cập nhật conic-gradient cho gauge (bán nguyệt 180°: từ 180deg đến 360deg)
    const angle = (percent / 100) * 180;
    fillEl.style.background = `conic-gradient(
        ${color} 0deg,
        ${color} ${angle}deg,
        rgba(255,255,255,0.05) ${angle}deg,
        rgba(255,255,255,0.05) 180deg
    )`;

    // Thêm CSS variable cho các hiệu ứng phụ
    gaugeEl.style.setProperty('--gauge-color', color);

    if (valueEl) valueEl.textContent = value.toFixed(1);
}

// ============================================================
// 9. VẼ BIỂU ĐỒ CANVAS (Nhiệt độ theo thời gian)
// ============================================================
function drawChart() {
    const canvas = $('#tempCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    // Thiết lập kích thước canvas theo container (responsive)
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padding = { top: 20, right: 20, bottom: 35, left: 50 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    // Xóa canvas
    ctx.clearRect(0, 0, W, H);

    const data = sensorData.history;
    if (data.length < 2) return;

    // Tìm min/max giá trị cho trục Y
    const values = data.map(d => d.value);
    let yMin = Math.floor(Math.min(...values) - 5);
    let yMax = Math.ceil(Math.max(...values) + 5);
    if (yMax - yMin < 10) { yMin -= 5; yMax += 5; }

    // Hàm chuyển đổi tọa độ
    const xScale = (i) => padding.left + (i / (data.length - 1)) * chartW;
    const yScale = (v) => padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

    // ---- Vẽ lưới ngang (Grid Lines) ----
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (i / gridLines) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(W - padding.right, y);
        ctx.stroke();

        // Nhãn trục Y
        const val = yMax - (i / gridLines) * (yMax - yMin);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(0) + '°', padding.left - 8, y + 4);
    }

    // ---- Nhãn trục X (Thời gian) ----
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const xLabelCount = Math.min(data.length, 6);
    for (let i = 0; i < xLabelCount; i++) {
        const idx = Math.floor(i * (data.length - 1) / (xLabelCount - 1));
        const x = xScale(idx);
        const time = data[idx].time;
        const label = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        ctx.fillText(label, x, H - padding.bottom + 20);
    }

    // ---- Vẽ vùng tô gradient bên dưới đường (Area Fill) ----
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, 'rgba(0, 212, 170, 0.3)');
    gradient.addColorStop(0.5, 'rgba(0, 212, 170, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 212, 170, 0.0)');

    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(data[0].value));
    for (let i = 1; i < data.length; i++) {
        // Đường cong Bézier mượt
        const x0 = xScale(i - 1);
        const x1 = xScale(i);
        const y0 = yScale(data[i - 1].value);
        const y1 = yScale(data[i].value);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
    ctx.lineTo(xScale(data.length - 1), padding.top + chartH);
    ctx.lineTo(xScale(0), padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // ---- Vẽ đường chính (Line) ----
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(data[0].value));
    for (let i = 1; i < data.length; i++) {
        const x0 = xScale(i - 1);
        const x1 = xScale(i);
        const y0 = yScale(data[i - 1].value);
        const y1 = yScale(data[i].value);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
    ctx.strokeStyle = '#00d4aa';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00d4aa';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ---- Vẽ điểm cuối cùng (Current Point) ----
    const lastX = xScale(data.length - 1);
    const lastY = yScale(data[data.length - 1].value);

    // Vòng sáng bên ngoài
    ctx.beginPath();
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 212, 170, 0.2)';
    ctx.fill();

    // Điểm chính
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4aa';
    ctx.fill();
    ctx.strokeStyle = '#0a0e1a';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ============================================================
// 10. DANH SÁCH THIẾT BỊ (Device Grid)
// ============================================================
function renderDevices() {
    const grid = $('#devicesGrid');
    const count = $('#deviceCount');
    if (!grid) return;

    grid.innerHTML = devices.map(device => `
        <div class="device-item ${device.status}" id="device-${device.id}">
            <div class="device-header">
                <span class="status-dot status-${device.status}"></span>
                <strong class="device-name">${device.name}</strong>
            </div>
            <div class="device-info">
                <span class="device-type">${device.type}</span>
                <span class="device-ip">${device.ip}</span>
            </div>
            <div class="device-status-text">
                ${device.status === 'online' ? '🟢 Đang hoạt động' : '🔴 Mất kết nối'}
            </div>
        </div>
    `).join('');

    if (count) {
        const onlineCount = devices.filter(d => d.status === 'online').length;
        count.textContent = `${onlineCount}/${devices.length} thiết bị online`;
    }
}

// ============================================================
// 11. CÀI ĐẶT KẾT NỐI (Settings Page)
// ============================================================
function initSettings() {
    const ipInput = $('#deviceIp');
    const portInput = $('#devicePort');
    const intervalInput = $('#updateInterval');
    const saveBtn = $('#btnSaveSettings');
    const testBtn = $('#btnTestConnection');

    // Load giá trị đã lưu
    if (ipInput) ipInput.value = CONFIG.deviceIp;
    if (portInput) portInput.value = CONFIG.devicePort;
    if (intervalInput) intervalInput.value = CONFIG.updateInterval;

    // Lưu cài đặt
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            CONFIG.deviceIp = ipInput.value.trim();
            CONFIG.devicePort = parseInt(portInput.value) || 80;
            CONFIG.updateInterval = parseInt(intervalInput.value) || 2;

            localStorage.setItem('cf_iot_ip', CONFIG.deviceIp);
            localStorage.setItem('cf_iot_port', CONFIG.devicePort.toString());
            localStorage.setItem('cf_iot_interval', CONFIG.updateInterval.toString());

            showNotification('✅ Đã lưu cài đặt thành công!', 'success');

            // Khởi động lại vòng lặp cập nhật với interval mới
            restartUpdateLoop();
        });
    }

    // Kiểm tra kết nối
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            if (!CONFIG.deviceIp) {
                showNotification('⚠️ Vui lòng nhập địa chỉ IP thiết bị!', 'warning');
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = '⏳ Đang kiểm tra...';

            try {
                const url = `http://${CONFIG.deviceIp}:${CONFIG.devicePort}/`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(url, {
                    signal: controller.signal,
                    mode: 'no-cors',
                });
                clearTimeout(timeout);

                showNotification('✅ Kết nối thành công tới thiết bị!', 'success');
                updateConnectionStatus(true);
            } catch (err) {
                showNotification('❌ Không thể kết nối tới thiết bị! Kiểm tra IP và Port.', 'error');
                updateConnectionStatus(false);
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '🔗 Kiểm tra kết nối';
            }
        });
    }
}

// ============================================================
// 12. TRẠNG THÁI KẾT NỐI (Connection Status)
// ============================================================
function updateConnectionStatus(connected) {
    const statusEl = $('#connectionStatus');
    if (!statusEl) return;

    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');

    if (connected) {
        dot.className = 'status-dot status-online';
        text.textContent = 'Đã kết nối';
    } else {
        dot.className = 'status-dot status-offline';
        text.textContent = 'Chưa kết nối';
    }
}

// ============================================================
// 13. THÔNG BÁO (Toast Notification)
// ============================================================
function showNotification(message, type = 'info') {
    // Xóa thông báo cũ nếu có
    const existing = $('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;

    // Style inline cho toast
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        padding: '14px 24px',
        borderRadius: '12px',
        color: '#fff',
        fontSize: '0.9rem',
        fontWeight: '500',
        fontFamily: 'Inter, sans-serif',
        zIndex: '10000',
        animation: 'slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        maxWidth: '400px',
    });

    // Màu nền theo loại
    const colors = {
        success: 'rgba(0, 212, 170, 0.9)',
        error: 'rgba(244, 63, 94, 0.9)',
        warning: 'rgba(245, 158, 11, 0.9)',
        info: 'rgba(59, 130, 246, 0.9)',
    };
    toast.style.background = colors[type] || colors.info;

    document.body.appendChild(toast);

    // Tự động ẩn sau 3 giây
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// 14. VÒNG LẶP CẬP NHẬT CHÍNH (Main Update Loop)
// ============================================================
let updateTimer = null;

function startUpdateLoop() {
    // Chạy lần đầu ngay lập tức
    generateSimulatedData();
    updateUI();

    // Lặp theo interval
    updateTimer = setInterval(() => {
        generateSimulatedData();
        updateUI();
    }, CONFIG.updateInterval * 1000);
}

function restartUpdateLoop() {
    if (updateTimer) clearInterval(updateTimer);
    startUpdateLoop();
}

// ============================================================
// 15. XỬ LÝ RESPONSIVE (Resize Canvas)
// ============================================================
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        drawChart();
    }, 200);
});

// ============================================================
// 16. CHART CONTROLS (1H / 6H / 24H buttons)
// ============================================================
function initChartControls() {
    const buttons = $$('.chart-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const range = btn.dataset.range;
            switch (range) {
                case '1h':
                    CONFIG.maxDataPoints = 60;
                    break;
                case '6h':
                    CONFIG.maxDataPoints = 180;
                    break;
                case '24h':
                    CONFIG.maxDataPoints = 720;
                    break;
            }
        });
    });
}

// ============================================================
// 17. KHỞI TẠO ỨNG DỤNG (App Init)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 CF IOT Dashboard - Khởi tạo...');

    // Khởi tạo các module
    initNavigation();
    initSettings();
    initChartControls();
    renderDevices();

    // Bắt đầu vòng lặp dữ liệu
    startUpdateLoop();

    // Hiệu ứng fade-in cho cards
    const cards = $$('.card');
    cards.forEach((card, i) => {
        card.style.animationDelay = `${i * 0.1}s`;
    });

    // Cập nhật trạng thái kết nối giả lập
    setTimeout(() => {
        updateConnectionStatus(true);
        showNotification('🚀 Dashboard đã sẵn sàng! (Chế độ giả lập)', 'info');
    }, 1500);

    console.log('✅ CF IOT Dashboard - Sẵn sàng!');
});
