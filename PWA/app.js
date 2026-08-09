/**
 * CF IOT Temperature Monitor - Progressive Web App
 * File: app.js
 * Mô tả: Kết nối MQTT Broker qua WebSockets để nhận dữ liệu nhiệt độ thời gian thực
 * - Nhận payload MQTT (JSON hoặc Plain Text Number)
 * - Tự động cập nhật nhiệt độ, vẽ biểu đồ Canvas, gauge và cảnh báo khi quá ngưỡng
 * - Hỗ trợ cả chế độ MQTT Broker và chế độ Mô phỏng (Simulated)
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
    mode: localStorage.getItem('cf_iot_mode') || 'mqtt', // 'mqtt' hoặc 'simulated'
    mqttHost: localStorage.getItem('cf_iot_mqtt_host') || 'broker.emqx.io',
    mqttPort: parseInt(localStorage.getItem('cf_iot_mqtt_port')) || 8083,
    mqttTopic: localStorage.getItem('cf_iot_mqtt_topic') || 'cf_iot/temperature',
    mqttUser: localStorage.getItem('cf_iot_mqtt_user') || '',
    mqttPass: localStorage.getItem('cf_iot_mqtt_pass') || '',

    tempMinGauge: 0,
    tempMaxGauge: 150,
    maxDataPoints: 60,
};

// Dữ liệu nhiệt độ toàn cục
const sensorData = {
    temperature: 0,
    setTempMin: 40,      // Ngưỡng Min cài đặt
    setTempMax: 110,     // Ngưỡng Max cài đặt
    history: [],         // Lịch sử nhiệt độ
    alertsLog: [],       // Nhật ký cảnh báo
    tempMin: Infinity,
    tempMax: -Infinity,
    tempSum: 0,
    tempCount: 0,
};

let mqttClient = null;
let simulatedTimer = null;

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
        dashboard: 'Giám sát Nhiệt độ MQTT',
        history: 'Lịch sử Nhiệt độ',
        alerts: 'Danh sách Cảnh báo',
        settings: 'Cấu hình MQTT Broker',
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

            if (topbarTitle) topbarTitle.textContent = pageTitles[targetPage] || 'Giám sát Nhiệt độ MQTT';

            sidebar.classList.remove('open');
            overlay.classList.remove('active');

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
// 5. KẾT NỐI MQTT BROKER (Paho MQTT over WebSockets)
// ============================================================
function connectMQTT() {
    if (typeof Paho === 'undefined') {
        console.error('❌ Paho MQTT library chưa được tải!');
        showNotification('❌ Chưa tải được thư viện MQTT JavaScript', 'error');
        return;
    }

    const clientId = 'cf_pwa_' + Math.random().toString(16).substr(2, 8);
    console.log(`[MQTT] Đang kết nối tới ${CONFIG.mqttHost}:${CONFIG.mqttPort} với ClientID ${clientId}...`);

    updateConnectionStatus('connecting', `Đang kết nối ${CONFIG.mqttHost}...`);

    try {
        mqttClient = new Paho.MQTT.Client(CONFIG.mqttHost, Number(CONFIG.mqttPort), clientId);

        mqttClient.onConnectionLost = onMQTTConnectionLost;
        mqttClient.onMessageArrived = onMQTTMessageArrived;

        const options = {
            timeout: 5,
            keepAliveInterval: 30,
            cleanSession: true,
            onSuccess: onMQTTConnectSuccess,
            onFailure: onMQTTConnectFailure,
        };

        if (CONFIG.mqttUser) options.userName = CONFIG.mqttUser;
        if (CONFIG.mqttPass) options.password = CONFIG.mqttPass;

        mqttClient.connect(options);
    } catch (err) {
        console.error('[MQTT] Lỗi khởi tạo client:', err);
        updateConnectionStatus('offline', 'Lỗi khởi tạo MQTT');
    }
}

function onMQTTConnectSuccess() {
    console.log(`[MQTT] ✅ Kết nối THÀNH CÔNG tới MQTT Broker! Subscribing topic: ${CONFIG.mqttTopic}`);
    updateConnectionStatus('online', `MQTT: ${CONFIG.mqttTopic}`);
    showNotification(`📡 Đã kết nối MQTT Broker! Topic: ${CONFIG.mqttTopic}`, 'success');

    // Subscribe Topic
    mqttClient.subscribe(CONFIG.mqttTopic, { qos: 0 });
}

function onMQTTConnectFailure(response) {
    console.error('[MQTT] ❌ Kết nối thất bại:', response.errorMessage);
    updateConnectionStatus('offline', 'MQTT Thất bại');
    showNotification(`❌ Lỗi kết nối MQTT: ${response.errorMessage}`, 'error');
}

function onMQTTConnectionLost(response) {
    if (response.errorCode !== 0) {
        console.warn('[MQTT] ⚠️ Mất kết nối MQTT:', response.errorMessage);
        updateConnectionStatus('offline', 'Mất kết nối MQTT');
        showNotification('⚠️ Mất kết nối tới MQTT Broker! Đang thử lại...', 'warning');

        // Tự động thử kết nối lại sau 5 giây
        setTimeout(() => {
            if (CONFIG.mode === 'mqtt') connectMQTT();
        }, 5000);
    }
}

// Xử lý khi nhận được tin nhắn MQTT từ Broker
function onMQTTMessageArrived(message) {
    const topic = message.destinationName;
    const payloadStr = message.payloadString.trim();
    console.log(`[MQTT Received] ${topic} -> ${payloadStr}`);

    let tempValue = null;

    try {
        // Thử parse JSON
        const data = JSON.parse(payloadStr);
        if (typeof data.temperature !== 'undefined') tempValue = parseFloat(data.temperature);
        else if (typeof data.temp !== 'undefined') tempValue = parseFloat(data.temp);
        else if (typeof data.val !== 'undefined') tempValue = parseFloat(data.val);
        else if (typeof data.value !== 'undefined') tempValue = parseFloat(data.value);

        if (typeof data.min !== 'undefined') sensorData.setTempMin = parseFloat(data.min);
        if (typeof data.max !== 'undefined') sensorData.setTempMax = parseFloat(data.max);
    } catch (e) {
        // Nếu không phải JSON, parse trực tiếp thành chuỗi số
        tempValue = parseFloat(payloadStr);
    }

    if (tempValue !== null && !isNaN(tempValue)) {
        processTemperatureData(tempValue);
    } else {
        console.warn('[MQTT] Payload không hợp lệ:', payloadStr);
    }
}

// ============================================================
// 6. XỬ LÝ NHIỆT ĐỘ & PHÁT HIỆN CẢNH BÁO
// ============================================================
function processTemperatureData(tempValue) {
    sensorData.temperature = parseFloat(tempValue.toFixed(1));

    let status = 'normal';
    let alertMsg = null;

    if (sensorData.temperature > sensorData.setTempMax) {
        status = 'high';
        alertMsg = `${sensorData.temperature}°C (vượt ngưỡng Max ${sensorData.setTempMax}°C)`;
    } else if (sensorData.temperature < sensorData.setTempMin) {
        status = 'low';
        alertMsg = `${sensorData.temperature}°C (thấp hơn ngưỡng Min ${sensorData.setTempMin}°C)`;
    }

    const now = new Date();

    sensorData.history.push({
        time: now,
        value: sensorData.temperature,
        status: status,
    });

    if (sensorData.history.length > CONFIG.maxDataPoints) {
        sensorData.history.shift();
    }

    if (alertMsg) {
        const lastAlert = sensorData.alertsLog[0];
        if (!lastAlert || (now - lastAlert.time > 4000) || lastAlert.status !== status) {
            sensorData.alertsLog.unshift({
                id: Date.now(),
                time: now,
                temp: sensorData.temperature,
                message: alertMsg,
                status: status,
            });

            if (sensorData.alertsLog.length > 50) sensorData.alertsLog.pop();
            showNotification(alertMsg, status === 'high' ? 'error' : 'warning');
        }
    }

    sensorData.tempCount++;
    sensorData.tempSum += sensorData.temperature;
    if (sensorData.temperature < sensorData.tempMin) sensorData.tempMin = sensorData.temperature;
    if (sensorData.temperature > sensorData.tempMax) sensorData.tempMax = sensorData.temperature;

    // Đẩy lên UI
    updateUI();
}

// ============================================================
// 7. CẬP NHẬT GIAO DIỆN
// ============================================================
function updateUI() {
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

    updateGauge(sensorData.temperature);

    const minEl = $('#tempMin');
    const avgEl = $('#tempAvg');
    const maxEl = $('#tempMax');
    if (minEl && sensorData.tempMin !== Infinity) minEl.textContent = sensorData.tempMin.toFixed(1) + '°C';
    if (maxEl && sensorData.tempMax !== -Infinity) maxEl.textContent = sensorData.tempMax.toFixed(1) + '°C';
    if (avgEl && sensorData.tempCount > 0) avgEl.textContent = (sensorData.tempSum / sensorData.tempCount).toFixed(1) + '°C';

    drawChart();
    renderAlertsGrid();
}

// Tính toán đường cong SVG Arc và vị trí chấm tròn cho Arc Min / Arc Max
function getArcPathAndDot(val, minLimit, maxLimit) {
    const pct = Math.min(Math.max((val - minLimit) / (maxLimit - minLimit), 0.05), 0.95);
    const startAngle = 135 * (Math.PI / 180);
    const totalSweep = 270 * (Math.PI / 180);
    const currentAngle = startAngle + pct * totalSweep;

    const R = 38;
    const cx = 50, cy = 50;

    const startX = cx + R * Math.cos(startAngle);
    const startY = cy + R * Math.sin(startAngle);

    const endX = cx + R * Math.cos(currentAngle);
    const endY = cy + R * Math.sin(currentAngle);

    const largeArc = pct * 270 > 180 ? 1 : 0;
    const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} A ${R} ${R} 0 ${largeArc} 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`;

    return { pathD, dotX: endX.toFixed(1), dotY: endY.toFixed(1) };
}

// Cập nhật Màn hình LVGL (SquareLine Studio layout)
function updateGauge(value) {
    const mainTempEl = $('#lvglMainTemp');
    const minTextEl = $('#lvglArcMinText');
    const maxTextEl = $('#lvglArcMaxText');
    const minPathEl = $('#lvglArcMinPath');
    const minDotEl = $('#lvglArcMinDot');
    const maxPathEl = $('#lvglArcMaxPath');
    const maxDotEl = $('#lvglArcMaxDot');
    const badge = $('#tempStatusBadge');

    // 1. Cập nhật nhiệt độ chính ở giữa
    if (mainTempEl) {
        mainTempEl.textContent = value.toFixed(1);
        if (value > sensorData.setTempMax) {
            mainTempEl.style.color = '#f43f5e';
            mainTempEl.style.textShadow = '0 0 20px rgba(244, 63, 94, 0.6)';
        } else if (value < sensorData.setTempMin) {
            mainTempEl.style.color = '#3b82f6';
            mainTempEl.style.textShadow = '0 0 20px rgba(59, 130, 246, 0.6)';
        } else {
            mainTempEl.style.color = '#10b981';
            mainTempEl.style.textShadow = '0 0 20px rgba(16, 185, 129, 0.5)';
        }
    }

    // 2. Cập nhật Arc Min (Bên trái)
    if (minTextEl) minTextEl.textContent = Math.round(sensorData.setTempMin);
    if (minPathEl && minDotEl) {
        const minArc = getArcPathAndDot(sensorData.setTempMin, 20, 120);
        minPathEl.setAttribute('d', minArc.pathD);
        minDotEl.setAttribute('cx', minArc.dotX);
        minDotEl.setAttribute('cy', minArc.dotY);
    }

    // 3. Cập nhật Arc Max (Bên phải)
    if (maxTextEl) maxTextEl.textContent = Math.round(sensorData.setTempMax);
    if (maxPathEl && maxDotEl) {
        const maxArc = getArcPathAndDot(sensorData.setTempMax, 40, 140);
        maxPathEl.setAttribute('d', maxArc.pathD);
        maxDotEl.setAttribute('cx', maxArc.dotX);
        maxDotEl.setAttribute('cy', maxArc.dotY);
    }

    // 4. Badge trạng thái
    if (badge) {
        if (value > sensorData.setTempMax) {
            badge.textContent = '🚨 Quá nhiệt!';
            badge.style.color = '#f43f5e';
            badge.style.background = 'rgba(244, 63, 94, 0.2)';
            badge.style.borderColor = '#f43f5e';
        } else if (value < sensorData.setTempMin) {
            badge.textContent = '❄️ Dưới Min';
            badge.style.color = '#3b82f6';
            badge.style.background = 'rgba(59, 130, 246, 0.2)';
            badge.style.borderColor = '#3b82f6';
        } else {
            badge.textContent = 'Bình thường';
            badge.style.color = '#10b981';
            badge.style.background = 'rgba(16, 185, 129, 0.2)';
            badge.style.borderColor = '#10b981';
        }
    }
}

// Biểu đồ Canvas
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

    // Đường ngưỡng Max
    const ySetMax = yScale(sensorData.setTempMax);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, ySetMax);
    ctx.lineTo(W - padding.right, ySetMax);
    ctx.stroke();
    ctx.setLineDash([]);

    // Đường ngưỡng Min
    const ySetMin = yScale(sensorData.setTempMin);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, ySetMin);
    ctx.lineTo(W - padding.right, ySetMin);
    ctx.stroke();
    ctx.setLineDash([]);

    // X Labels
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

    // Last point
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

// Bảng Cảnh báo
function renderAlertsGrid() {
    const grid = $('#alertsGrid');
    const countEl = $('#alertCount');
    if (!grid) return;

    const recentAlerts = sensorData.alertsLog.slice(0, 4);

    if (countEl) countEl.textContent = `${sensorData.alertsLog.length} sự cố`;

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
                <span class="device-type">Chi tiết: <strong>${alert.message}</strong></span>
                <span class="device-ip">${alert.time.toLocaleTimeString('vi-VN')}</span>
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
                <span style="font-size: 0.8rem; color: var(--text-muted);">${alert.toLocaleString('vi-VN')}</span>
            </div>
            <p style="margin: 0; font-size: 0.9rem;">${alert.message}</p>
        </div>
    `).join('');
}

// ============================================================
// 8. CÀI ĐẶT CẤU HÌNH & CHẾ ĐỘ MÔ PHỎNG
// ============================================================
function initSettings() {
    const modeSelect = $('#connectionMode');
    const hostInput = $('#mqttHost');
    const portInput = $('#mqttPort');
    const topicInput = $('#mqttTopic');
    const userInput = $('#mqttUser');
    const passInput = $('#mqttPass');
    const saveBtn = $('#btnSaveSettings');
    const testBtn = $('#btnTestConnection');

    if (modeSelect) modeSelect.value = CONFIG.mode;
    if (hostInput) hostInput.value = CONFIG.mqttHost;
    if (portInput) portInput.value = CONFIG.mqttPort;
    if (topicInput) topicInput.value = CONFIG.mqttTopic;
    if (userInput) userInput.value = CONFIG.mqttUser;
    if (passInput) passInput.value = CONFIG.mqttPass;

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            CONFIG.mode = modeSelect.value;
            CONFIG.mqttHost = hostInput.value.trim();
            CONFIG.mqttPort = parseInt(portInput.value) || 8083;
            CONFIG.mqttTopic = topicInput.value.trim();
            CONFIG.mqttUser = userInput.value.trim();
            CONFIG.mqttPass = passInput.value.trim();

            localStorage.setItem('cf_iot_mode', CONFIG.mode);
            localStorage.setItem('cf_iot_mqtt_host', CONFIG.mqttHost);
            localStorage.setItem('cf_iot_mqtt_port', CONFIG.mqttPort.toString());
            localStorage.setItem('cf_iot_mqtt_topic', CONFIG.mqttTopic);
            localStorage.setItem('cf_iot_mqtt_user', CONFIG.mqttUser);
            localStorage.setItem('cf_iot_mqtt_pass', CONFIG.mqttPass);

            showNotification('💾 Đã lưu cấu hình MQTT!', 'success');

            restartConnection();
        });
    }

    if (testBtn) {
        testBtn.addEventListener('click', () => {
            if (mqttClient && mqttClient.isConnected()) {
                const sampleTemp = (70 + Math.random() * 45).toFixed(1);
                const message = new Paho.MQTT.Message(sampleTemp);
                message.destinationName = CONFIG.mqttTopic;
                mqttClient.send(message);
                showNotification(`📡 Đã gửi thử mẫu ${sampleTemp}°C lên topic ${CONFIG.mqttTopic}`, 'info');
            } else {
                showNotification('⚠️ Chưa kết nối tới MQTT Broker! Đang chuyển tạm sang chế độ Mô phỏng.', 'warning');
                generateSimulatedData();
            }
        });
    }
}

function startSimulationMode() {
    if (simulatedTimer) clearInterval(simulatedTimer);
    updateConnectionStatus('online', 'Mô phỏng (Simulated)');
    showNotification('🧪 Đang chạy ở chế độ Mô phỏng dữ liệu', 'info');

    simulatedTimer = setInterval(() => {
        const baseTemp = 90;
        const variation = Math.sin(Date.now() / 8000) * 25 + (Math.random() - 0.5) * 6;
        const simVal = parseFloat((baseTemp + variation).toFixed(1));
        processTemperatureData(simVal);
    }, 2000);
}

function restartConnection() {
    if (simulatedTimer) {
        clearInterval(simulatedTimer);
        simulatedTimer = null;
    }

    if (mqttClient && mqttClient.isConnected()) {
        try { mqttClient.disconnect(); } catch (e) {}
    }

    if (CONFIG.mode === 'mqtt') {
        connectMQTT();
    } else {
        startSimulationMode();
    }
}

function updateConnectionStatus(type, textStr) {
    const statusEl = $('#connectionStatus');
    if (!statusEl) return;

    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');

    if (type === 'online') {
        dot.className = 'status-dot status-online';
        text.textContent = textStr || 'MQTT Online';
    } else if (type === 'connecting') {
        dot.className = 'status-dot status-warning';
        text.textContent = textStr || 'Đang kết nối...';
    } else {
        dot.className = 'status-dot status-offline';
        text.textContent = textStr || 'Offline';
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
    console.log('🚀 CF Temp Monitor (MQTT Enabled) - Khởi tạo...');

    initNavigation();
    initSettings();
    initChartControls();

    restartConnection();
});
