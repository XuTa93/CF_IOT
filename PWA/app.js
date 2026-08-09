/**
 * CF IOT Temperature Monitor - Progressive Web App
 * File: app.js
 * Mô tả: Logic tập trung 100% vào giám sát, phân tích & cảnh báo nhiệt độ
 * - Cập nhật nhiệt độ thời gian thực
 * - Giám sát ngưỡng Min (Arc Min) & Max (Arc Max)
 * - Tự động phát hiện & ghi nhật ký sự cố Quá nhiệt / Dưới ngưỡng
 * - Vẽ biểu đồ Canvas diễn biến nhiệt độ & đường ngưỡng
 * - Thước đo Gauge conic-gradient
 * - Bảng lịch sử & Nhật ký cảnh báo nhiệt độ
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

    // Giới hạn gauge nhiệt độ
    tempMinGauge: 0,
    tempMaxGauge: 150,

    // Số điểm dữ liệu tối đa trên biểu đồ
    maxDataPoints: 60,
};

// Dữ liệu nhiệt độ toàn cục
const sensorData = {
    temperature: 0,
    setTempMin: 40,      // Ngưỡng Min cài đặt (Arc Min)
    setTempMax: 110,     // Ngưỡng Max cài đặt (Arc Max)
    history: [],         // Mảng lưu lịch sử nhiệt độ { time, value, status }
    alertsLog: [],       // Mảng lưu danh sách sự cố cảnh báo
    tempMin: Infinity,
    tempMax: -Infinity,
    tempSum: 0,
    tempCount: 0,
};

// Tiện ích DOM
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
// 3. ĐỒNG HỒ THỜI GIAN THỰC
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
// 4. ĐIỀU HƯỚNG SPA
// ============================================================
function initNavigation() {
    const navItems = $$('.nav-item');
    const pages = $$('.page');
    const topbarTitle = $('.topbar-title h1');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    const menuToggle = $('#menuToggle');

    const pageTitles = {
        dashboard: 'Giám sát Nhiệt độ',
        history: 'Lịch sử Nhiệt độ',
        alerts: 'Danh sách Cảnh báo',
        settings: 'Cài đặt Cấu hình',
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = item.dataset.page;

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            pages.forEach(p => p.classList.remove('active'));
            const page = $(`#page-${targetPage}`);
            if (page) page.classList.add('active');

            if (topbarTitle) topbarTitle.textContent = pageTitles[targetPage] || 'Giám sát Nhiệt độ';

            sidebar.classList.remove('open');
            overlay.classList.remove('active');

            // Render lại các bảng khi chuyển trang
            if (targetPage === 'history') renderHistoryTable();
            if (targetPage === 'alerts') renderFullAlertsList();
        });
    });

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });
}

// ============================================================
// 5. GIẢ LẬP VÀ XỬ LÝ DỮ LIỆU NHIỆT ĐỘ
// ============================================================
function generateSimulatedData() {
    // Giả lập nhiệt độ dao động ngẫu nhiên 60 ~ 125°C
    const baseTemp = 90;
    const variation = Math.sin(Date.now() / 8000) * 25 + (Math.random() - 0.5) * 6;
    sensorData.temperature = parseFloat((baseTemp + variation).toFixed(1));

    // Đánh giá trạng thái so với ngưỡng Min / Max
    let status = 'normal';
    let alertMsg = null;

    if (sensorData.temperature > sensorData.setTempMax) {
        status = 'high';
        alertMsg = `⚠️ CẢNH BÁO QUÁ NHIỆT: ${sensorData.temperature}°C vượt ngưỡng Max (${sensorData.setTempMax}°C)`;
    } else if (sensorData.temperature < sensorData.setTempMin) {
        status = 'low';
        alertMsg = `❄️ CẢNH BÁO DƯỚI NGƯỠNG: ${sensorData.temperature}°C thấp hơn ngưỡng Min (${sensorData.setTempMin}°C)`;
    }

    const now = new Date();

    // Lưu vào lịch sử
    sensorData.history.push({
        time: now,
        value: sensorData.temperature,
        status: status,
    });

    if (sensorData.history.length > CONFIG.maxDataPoints) {
        sensorData.history.shift();
    }

    // Nếu có sự cố cảnh báo mới -> ghi nhận vào Nhật ký Cảnh báo
    if (alertMsg) {
        // Tránh trùng lặp cảnh báo quá dồn dập (ít nhất cách nhau 4 giây)
        const lastAlert = sensorData.alertsLog[0];
        if (!lastAlert || (now - lastAlert.time > 4000) || lastAlert.status !== status) {
            sensorData.alertsLog.unshift({
                id: Date.now(),
                time: now,
                temp: sensorData.temperature,
                message: alertMsg,
                status: status,
            });

            // Giữ tối đa 50 sự cố
            if (sensorData.alertsLog.length > 50) sensorData.alertsLog.pop();

            // Hiển thị Toast Cảnh báo
            showNotification(alertMsg, status === 'high' ? 'error' : 'warning');
        }
    }

    // Cập nhật thống kê Min / Max / Avg phiên
    sensorData.tempCount++;
    sensorData.tempSum += sensorData.temperature;
    if (sensorData.temperature < sensorData.tempMin) sensorData.tempMin = sensorData.temperature;
    if (sensorData.temperature > sensorData.tempMax) sensorData.tempMax = sensorData.temperature;
}

// ============================================================
// 6. CẬP NHẬT GIAO DIỆN CHÍNH
// ============================================================
function updateUI() {
    // ---- 1. Cập nhật Thẻ Thống kê ----
    const tempValEl = $('#tempValue');
    const tempAvgValEl = $('#tempAvgCardValue');
    const minValEl = $('#setTempMinValue');
    const maxValEl = $('#setTempMaxValue');

    if (tempValEl) tempValEl.textContent = sensorData.temperature.toFixed(1);
    if (minValEl) minValEl.textContent = sensorData.setTempMin;
    if (maxValEl) maxValEl.textContent = sensorData.setTempMax;

    if (tempAvgValEl && sensorData.tempCount > 0) {
        const avg = (sensorData.tempSum / sensorData.tempCount).toFixed(1);
        tempAvgValEl.textContent = avg;
    }

    // Xu hướng nhiệt độ
    if (sensorData.history.length >= 2) {
        const prev = sensorData.history[sensorData.history.length - 2].value;
        const curr = sensorData.temperature;
        const diff = ((curr - prev) / prev * 100).toFixed(1);
        const tempTrend = $('#tempTrend');
        if (tempTrend) {
            if (diff > 0) {
                tempTrend.textContent = `↑ +${diff}%`;
                tempTrend.className = 'card-trend card-trend--up';
            } else if (diff < 0) {
                tempTrend.textContent = `↓ ${diff}%`;
                tempTrend.className = 'card-trend card-trend--down';
            } else {
                tempTrend.textContent = `→ 0.0%`;
                tempTrend.className = 'card-trend card-trend--neutral';
            }
        }
    }

    // ---- 2. Cập nhật Gauge Nhiệt độ ----
    updateGauge(sensorData.temperature);

    // ---- 3. Cập nhật Min / Avg / Max ở Gauge ----
    const minEl = $('#tempMin');
    const avgEl = $('#tempAvg');
    const maxEl = $('#tempMax');
    if (minEl && sensorData.tempMin !== Infinity) minEl.textContent = sensorData.tempMin.toFixed(1) + '°C';
    if (maxEl && sensorData.tempMax !== -Infinity) maxEl.textContent = sensorData.tempMax.toFixed(1) + '°C';
    if (avgEl && sensorData.tempCount > 0) avgEl.textContent = (sensorData.tempSum / sensorData.tempCount).toFixed(1) + '°C';

    // ---- 4. Vẽ lại Biểu đồ ----
    drawChart();

    // ---- 5. Cập nhật danh sách Cảnh báo nhanh trên Dashboard ----
    renderAlertsGrid();
}

// ============================================================
// 7. GAUGE NHIỆT ĐỘ (Conic Gradient)
// ============================================================
function updateGauge(value) {
    const gaugeEl = $('#tempGauge');
    const valueEl = $('#gaugeValue');
    const fillEl = $('#gaugeFill');

    if (!gaugeEl || !fillEl) return;

    const percent = Math.min(Math.max((value - CONFIG.tempMinGauge) / (CONFIG.tempMaxGauge - CONFIG.tempMinGauge) * 100, 0), 100);

    // Màu sắc chuyển đổi theo khoảng nhiệt độ
    let color;
    if (value < sensorData.setTempMin) {
        color = '#3b82f6'; // Xanh dương - Dưới ngưỡng Min
    } else if (value <= sensorData.setTempMax) {
        color = '#00d4aa'; // Teal - An toàn
    } else {
        color = '#f43f5e'; // Đỏ - Quá nhiệt
    }

    const angle = (percent / 100) * 180;
    fillEl.style.background = `conic-gradient(
        ${color} 0deg,
        ${color} ${angle}deg,
        rgba(255,255,255,0.05) ${angle}deg,
        rgba(255,255,255,0.05) 180deg
    )`;

    gaugeEl.style.setProperty('--gauge-color', color);

    if (valueEl) valueEl.textContent = value.toFixed(1);
}

// ============================================================
// 8. VẼ BIỂU ĐỒ DIỄN BIẾN NHIỆT ĐỘ (Canvas)
// ============================================================
function drawChart() {
    const canvas = $('#tempCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

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

    ctx.clearRect(0, 0, W, H);

    const data = sensorData.history;
    if (data.length < 2) return;

    const values = data.map(d => d.value);
    let yMin = Math.floor(Math.min(...values, sensorData.setTempMin) - 5);
    let yMax = Math.ceil(Math.max(...values, sensorData.setTempMax) + 5);

    const xScale = (i) => padding.left + (i / (data.length - 1)) * chartW;
    const yScale = (v) => padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (i / gridLines) * chartH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(W - padding.right, y);
        ctx.stroke();

        const val = yMax - (i / gridLines) * (yMax - yMin);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(0) + '°C', padding.left - 8, y + 4);
    }

    // Đường ngưỡng Max (Đỏ nét đứt)
    const ySetMax = yScale(sensorData.setTempMax);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, ySetMax);
    ctx.lineTo(W - padding.right, ySetMax);
    ctx.stroke();
    ctx.setLineDash([]);

    // Đường ngưỡng Min (Xanh nét đứt)
    const ySetMin = yScale(sensorData.setTempMin);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, ySetMin);
    ctx.lineTo(W - padding.right, ySetMin);
    ctx.stroke();
    ctx.setLineDash([]);

    // Nhãn thời gian trục X
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

    // Area Fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    gradient.addColorStop(0, 'rgba(0, 212, 170, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 212, 170, 0.0)');

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
    ctx.lineTo(xScale(data.length - 1), padding.top + chartH);
    ctx.lineTo(xScale(0), padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
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
    ctx.stroke();

    // Điểm tức thời cuối cùng
    const lastX = xScale(data.length - 1);
    const lastY = yScale(data[data.length - 1].value);

    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4aa';
    ctx.fill();
    ctx.strokeStyle = '#0a0e1a';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ============================================================
// 9. NHẬT KÝ & CẢNH BÁO NHIỆT ĐỘ
// ============================================================
function renderAlertsGrid() {
    const grid = $('#alertsGrid');
    const countEl = $('#alertCount');
    if (!grid) return;

    const recentAlerts = sensorData.alertsLog.slice(0, 4);

    if (countEl) countEl.textContent = `${sensorData.alertsLog.length} cảnh báo`;

    if (recentAlerts.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted);">
                ✅ Nhiệt độ hoạt động bình thường trong dải an toàn (${sensorData.setTempMin}°C ~ ${sensorData.setTempMax}°C).
            </div>
        `;
        return;
    }

    grid.innerHTML = recentAlerts.map(alert => `
        <div class="device-item ${alert.status === 'high' ? 'offline' : 'online'}" style="border-left: 4px solid ${alert.status === 'high' ? '#f43f5e' : '#3b82f6'};">
            <div class="device-header">
                <span class="status-dot ${alert.status === 'high' ? 'status-offline' : 'status-warning'}"></span>
                <strong class="device-name">${alert.status === 'high' ? '🚨 Cảnh báo Quá nhiệt' : '❄️ Dưới ngưỡng Min'}</strong>
            </div>
            <div class="device-info">
                <span class="device-type">Giá trị: <strong>${alert.temp}°C</strong></span>
                <span class="device-ip">${alert.time.toLocaleTimeString('vi-VN')}</span>
            </div>
            <div class="device-status-text" style="font-size: 0.8rem; margin-top: 4px;">
                ${alert.message}
            </div>
        </div>
    `).join('');
}

function renderHistoryTable() {
    const tbody = $('#historyTableBody');
    if (!tbody) return;

    const historyReversed = [...sensorData.history].reverse().slice(0, 30);

    tbody.innerHTML = historyReversed.map(item => {
        let statusBadge = `<span style="color: #00d4aa; font-weight: 500;">Bình thường</span>`;
        let comp = `Trong dải (${sensorData.setTempMin}°C - ${sensorData.setTempMax}°C)`;

        if (item.value > sensorData.setTempMax) {
            statusBadge = `<span style="color: #f43f5e; font-weight: 600;">⚠️ Quá nhiệt</span>`;
            comp = `<span style="color: #f43f5e;">+${(item.value - sensorData.setTempMax).toFixed(1)}°C so với Max</span>`;
        } else if (item.value < sensorData.setTempMin) {
            statusBadge = `<span style="color: #3b82f6; font-weight: 600;">❄️ Dưới Min</span>`;
            comp = `<span style="color: #3b82f6;">-${(sensorData.setTempMin - item.value).toFixed(1)}°C so với Min</span>`;
        }

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 12px; color: var(--text-muted);">${item.time.toLocaleTimeString('vi-VN')}</td>
                <td style="padding: 12px; font-weight: 600; font-size: 1.05rem;">${item.value}°C</td>
                <td style="padding: 12px;">${statusBadge}</td>
                <td style="padding: 12px; font-size: 0.85rem;">${comp}</td>
            </tr>
        `;
    }).join('');
}

function renderFullAlertsList() {
    const container = $('#fullAlertsList');
    if (!container) return;

    if (sensorData.alertsLog.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">Chưa phát hiện sự cố nhiệt độ nào.</p>`;
        return;
    }

    container.innerHTML = sensorData.alertsLog.map(alert => `
        <div style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 14px; margin-bottom: 10px; border-left: 4px solid ${alert.status === 'high' ? '#f43f5e' : '#3b82f6'};">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <strong style="color: ${alert.status === 'high' ? '#f43f5e' : '#3b82f6'};">${alert.status === 'high' ? '🚨 CẢNH BÁO QUÁ NHIỆT' : '❄️ DƯỚI NGƯỠNG AN TOÀN'}</strong>
                <span style="font-size: 0.8rem; color: var(--text-muted);">${alert.time.toLocaleString('vi-VN')}</span>
            </div>
            <p style="margin: 0; font-size: 0.9rem;">${alert.message}</p>
        </div>
    `).join('');
}

// ============================================================
// 10. CÀI ĐẶT CẤU HÌNH
// ============================================================
function initSettings() {
    const ipInput = $('#deviceIp');
    const portInput = $('#devicePort');
    const intervalInput = $('#updateInterval');
    const saveBtn = $('#btnSaveSettings');
    const testBtn = $('#btnTestConnection');

    if (ipInput) ipInput.value = CONFIG.deviceIp;
    if (portInput) portInput.value = CONFIG.devicePort;
    if (intervalInput) intervalInput.value = CONFIG.updateInterval;

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            CONFIG.deviceIp = ipInput.value.trim();
            CONFIG.devicePort = parseInt(portInput.value) || 80;
            CONFIG.updateInterval = parseInt(intervalInput.value) || 2;

            localStorage.setItem('cf_iot_ip', CONFIG.deviceIp);
            localStorage.setItem('cf_iot_port', CONFIG.devicePort.toString());
            localStorage.setItem('cf_iot_interval', CONFIG.updateInterval.toString());

            showNotification('✅ Đã lưu cấu hình giám sát thành công!', 'success');
            restartUpdateLoop();
        });
    }

    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            if (!CONFIG.deviceIp) {
                showNotification('⚠️ Vui lòng nhập địa chỉ IP thiết bị ESP32!', 'warning');
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = '⏳ Đang kiểm tra...';

            try {
                const url = `http://${CONFIG.deviceIp}:${CONFIG.devicePort}/`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                await fetch(url, { signal: controller.signal, mode: 'no-cors' });
                clearTimeout(timeout);

                showNotification('✅ Kết nối thành công tới ESP32!', 'success');
                updateConnectionStatus(true);
            } catch (err) {
                showNotification('❌ Không thể kết nối tới thiết bị!', 'error');
                updateConnectionStatus(false);
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '🔗 Kiểm tra kết nối';
            }
        });
    }
}

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

function showNotification(message, type = 'info') {
    const existing = $('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;

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

    const colors = {
        success: 'rgba(0, 212, 170, 0.95)',
        error: 'rgba(244, 63, 94, 0.95)',
        warning: 'rgba(245, 158, 11, 0.95)',
        info: 'rgba(59, 130, 246, 0.95)',
    };
    toast.style.background = colors[type] || colors.info;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Vòng lặp chính
let updateTimer = null;

function startUpdateLoop() {
    generateSimulatedData();
    updateUI();

    updateTimer = setInterval(() => {
        generateSimulatedData();
        updateUI();
    }, CONFIG.updateInterval * 1000);
}

function restartUpdateLoop() {
    if (updateTimer) clearInterval(updateTimer);
    startUpdateLoop();
}

// Chart Controls
function initChartControls() {
    const buttons = $$('.chart-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const range = btn.dataset.range;
            switch (range) {
                case '1h': CONFIG.maxDataPoints = 60; break;
                case '6h': CONFIG.maxDataPoints = 180; break;
                case '24h': CONFIG.maxDataPoints = 720; break;
            }
        });
    });
}

// Init App
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 CF Temp Monitor - Khởi tạo...');

    initNavigation();
    initSettings();
    initChartControls();

    startUpdateLoop();

    setTimeout(() => {
        updateConnectionStatus(true);
        showNotification('🌡️ Ứng dụng Giám sát Nhiệt độ đã sẵn sàng!', 'info');
    }, 1200);
});
