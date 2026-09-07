/**
 * HTTPS Backend Server cho CF IOT PWA (Web Push API)
 * Chạy: node server.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const webpush = require('web-push');
const mqtt = require('mqtt');

const PORT_HTTPS = 8443;
const PORT_HTTP = 8080;
const DATA_DIR = path.join(__dirname, 'data');
const CERT_DIR = path.join(__dirname, 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Đảm bảo thư mục tồn tại
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

// ==========================================
// 1. CHỨNG CHỈ SSL
// ==========================================
if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
    console.log('🔐 Đang tạo chứng chỉ SSL...');
    try {
        execSync(
            `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" -days 365 -nodes -subj "/CN=CF-IOT"`,
            { stdio: 'pipe' }
        );
        console.log('✅ Tạo chứng chỉ SSL thành công!');
    } catch(e) {
        console.error('❌ Lỗi tạo SSL. Cần cài đặt OpenSSL.');
        process.exit(1);
    }
}

// ==========================================
// 2. WEB PUSH & VAPID KEYS
// ==========================================
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
}

webpush.setVapidDetails(
    'mailto:admin@cf-iot.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// ==========================================
// 3. QUẢN LÝ ĐĂNG KÝ (SUBSCRIPTIONS)
// ==========================================
let subscriptions = [];
if (fs.existsSync(SUBS_FILE)) {
    try {
        subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    } catch(e) {}
}

function saveSubscription(sub) {
    const exists = subscriptions.find(s => s.endpoint === sub.endpoint);
    if (!exists) {
        subscriptions.push(sub);
        fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
        console.log(`📱 Thiết bị mới đã đăng ký nhận cảnh báo. Tổng số: ${subscriptions.length}`);
    }
}

function sendAlertToAll(title, body) {
    const payload = JSON.stringify({ title, body, icon: '/icons/icon-512.jpg' });
    console.log(`\n🚨 GỬI CẢNH BÁO PUSH: ${title} - ${body}`);
    
    subscriptions.forEach((sub, index) => {
        webpush.sendNotification(sub, payload).catch(error => {
            if (error.statusCode === 410 || error.statusCode === 404) {
                // Thiết bị đã hủy đăng ký
                console.log(`Thiết bị ${index} đã hủy đăng ký, đang xóa khỏi danh sách...`);
                subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
                fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
            } else {
                console.error(`Lỗi gửi push tới thiết bị ${index}:`, error);
            }
        });
    });
}

// ==========================================
// 4. MQTT CLIENT (BACKEND)
// ==========================================
const MQTT_BROKER = 'ws://broker.hivemq.com:8000/mqtt';
const MQTT_TOPIC = 'cf_iot/temperature';
let ALERT_THRESHOLD_MAX = 100;
let ALERT_THRESHOLD_MIN = 30;
let isAlertActive = false;
let isLowAlertActive = false;

console.log(`\n📡 Đang kết nối MQTT Backend tới: ${MQTT_BROKER}...`);
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
    console.log('✅ Backend đã kết nối MQTT thành công!');
    mqttClient.subscribe(MQTT_TOPIC);
    mqttClient.subscribe(MQTT_TOPIC + '/config');
});

mqttClient.on('message', (topic, message) => {
    const payloadStr = message.toString();

    // 1. Nếu là tin nhắn cấu hình ngưỡng
    if (topic === MQTT_TOPIC + '/config') {
        try {
            const configData = JSON.parse(payloadStr);
            if (typeof configData.max === 'number') ALERT_THRESHOLD_MAX = configData.max;
            if (typeof configData.min === 'number') ALERT_THRESHOLD_MIN = configData.min;
            console.log(`🎛️ Server đã nhận cấu hình ngưỡng mới: Min=${ALERT_THRESHOLD_MIN}, Max=${ALERT_THRESHOLD_MAX}`);
        } catch (e) {
            console.error('Lỗi parse JSON cấu hình MQTT:', e);
        }
        return;
    }

    // 2. Nếu là tin nhắn nhiệt độ
    let temp = null;
    try {
        const data = JSON.parse(payloadStr);
        temp = typeof data.temperature !== 'undefined' ? parseFloat(data.temperature) : parseFloat(data.val);
    } catch (e) {
        temp = parseFloat(payloadStr);
    }

    if (temp === null || isNaN(temp)) return;
    
    // Debug log (print every 5 seconds to avoid spam)
    if (Math.random() < 0.1) console.log(`[MQTT] Đã nhận nhiệt độ: ${temp.toFixed(1)}°C (Ngưỡng Max: ${ALERT_THRESHOLD_MAX})`);
    
    // Logic báo động tránh spam cho ngưỡng Max
    if (temp >= ALERT_THRESHOLD_MAX) {
        if (!isAlertActive) {
            isAlertActive = true;
            sendAlertToAll(
                '🔥 CẢNH BÁO QUÁ NHIỆT!',
                `Nhiệt độ hiện tại: ${temp.toFixed(1)}°C (Vượt mức Max ${ALERT_THRESHOLD_MAX}°C). Kiểm tra ngay!`
            );
        }
    } else if (temp < ALERT_THRESHOLD_MAX - 5) {
        if (isAlertActive) {
            console.log(`✅ Nhiệt độ đã an toàn dưới Max (${temp.toFixed(1)}°C). Đã reset cảnh báo Max.`);
            isAlertActive = false;
        }
    }

    // Logic báo động tránh spam cho ngưỡng Min
    if (temp <= ALERT_THRESHOLD_MIN) {
        if (!isLowAlertActive) {
            isLowAlertActive = true;
            sendAlertToAll(
                '❄️ CẢNH BÁO NHIỆT ĐỘ THẤP!',
                `Nhiệt độ hiện tại: ${temp.toFixed(1)}°C (Thấp hơn mức Min ${ALERT_THRESHOLD_MIN}°C). Kiểm tra ngay!`
            );
        }
    } else if (temp > ALERT_THRESHOLD_MIN + 5) {
        if (isLowAlertActive) {
            console.log(`✅ Nhiệt độ đã an toàn trên Min (${temp.toFixed(1)}°C). Đã reset cảnh báo Min.`);
            isLowAlertActive = false;
        }
    }
});

// ==========================================
// 5. HTTP/HTTPS SERVER
// ==========================================
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function handler(req, res) {
    // API Routes
    if (req.url === '/api/vapid-public-key' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(vapidKeys.publicKey);
        return;
    }

    if (req.url === '/api/subscribe' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const subscription = JSON.parse(body);
                saveSubscription(subscription);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400); res.end('Invalid JSON');
            }
        });
        return;
    }

    // Static Files
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    // Bỏ qua query string nếu có
    filePath = filePath.split('?')[0];

    if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }

    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    });
}

// Khởi chạy Server
const nets = require('os').networkInterfaces();
let localIP = 'localhost';
for (const iface of Object.values(nets)) {
    for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
}

https.createServer({ key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) }, handler)
    .listen(PORT_HTTPS, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(60));
        console.log('  🔒 CF IOT BACKEND SERVER (KÈM PUSH NOTIFICATION)');
        console.log('='.repeat(60));
        console.log(`  💻 Web: https://localhost:${PORT_HTTPS}`);
        console.log(`  📱 ĐT : https://${localIP}:${PORT_HTTPS}`);
        console.log('='.repeat(60) + '\n');
    });

http.createServer(handler).listen(PORT_HTTP, '0.0.0.0', () => {
    console.log(`  🌐 HTTP (dự phòng): http://localhost:${PORT_HTTP}`);
});
