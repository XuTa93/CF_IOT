/**
 * Service Worker cho CF IOT Dashboard
 * Quản lý bộ nhớ đệm (caching) và hỗ trợ chế độ ngoại tuyến (offline)
 */

// Tên bộ nhớ đệm (Cache Storage)
const CACHE_NAME = 'cf-iot-v1';

// Danh sách các tài nguyên tĩnh cần lưu cache khi cài đặt Service Worker
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-512.jpg'
];

/**
 * Sự kiện Install: Xảy ra khi Service Worker được đăng ký lần đầu hoặc cập nhật.
 * Tiến hành tải và lưu các tài nguyên tĩnh cốt lõi vào Cache Storage.
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Đang cài đặt (Install)...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Đang lưu trữ tài nguyên tĩnh vào cache...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Kích hoạt ngay Service Worker mới mà không cần chờ đóng tab
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] Lỗi khi lưu cache cài đặt:', error);
      })
  );
});

/**
 * Sự kiện Activate: Dọn dẹp các phiên bản cache cũ không còn dùng.
 * Đảm bảo Service Worker mới chiếm quyền kiểm soát ngay lập tức.
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Đang kích hoạt (Activate)...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log('[Service Worker] Xóa bộ nhớ đệm cũ:', cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => {
        // Chiếm quyền kiểm soát các client tab đang mở ngay lập tức
        return self.clients.claim();
      })
  );
});

/**
 * Kiểm tra xem một URL có phải là API call hay không
 * @param {string} url - URL của yêu cầu
 * @returns {boolean}
 */
function isApiRequest(url) {
  return url.includes('/api/') || 
         url.includes('mqtt') || 
         url.includes('blynk') || 
         url.includes('firebase') || 
         url.includes('thingsboard') ||
         url.includes(':1883') ||
         url.includes(':8080');
}

/**
 * Chiến lược Network-First (Ưu tiên mạng trước):
 * Dùng cho dữ liệu API / thời gian thực.
 * Thử tải từ mạng trước, nếu thành công thì cập nhật cache và trả về dữ liệu tươi.
 * Nếu mất mạng (offline), chuyển sang lấy dữ liệu lưu sẵn từ cache.
 */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Mất kết nối mạng, thử lấy dữ liệu API từ cache:', request.url);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Trả về phản hồi ngoại tuyến JSON fallback cho API call
    return new Response(
      JSON.stringify({ error: 'Ngoại tuyến: Không thể kết nối đến máy chủ IoT', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}

/**
 * Chiến lược Cache-First (Ưu tiên bộ nhớ đệm trước):
 * Dùng cho các tài nguyên tĩnh (HTML, CSS, JS, hình ảnh, icon).
 * Kiểm tra trong cache trước, nếu có thì trả về ngay (tối ưu tốc độ tải).
 * Nếu chưa có, gửi yêu cầu qua mạng và lưu vào cache cho các lần sau.
 */
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Mất kết nối mạng khi tải tài nguyên tĩnh:', request.url);
    // Khi ngoại tuyến và điều hướng trang, trả về trang index.html lưu trong cache làm trang fallback
    if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
      const fallbackResponse = await caches.match('index.html') || await caches.match('./');
      if (fallbackResponse) {
        return fallbackResponse;
      }
    }
    throw error;
  }
}

/**
 * Sự kiện Fetch: Bắt và xử lý mọi yêu cầu HTTP từ ứng dụng.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Bỏ qua yêu cầu không phải phương thức GET hoặc không dùng giao thức HTTP/HTTPS
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  //Phân chia chiến lược caching dựa theo loại URL (API hay static assets)
  if (isApiRequest(request.url)) {
    event.respondWith(networkFirstStrategy(request));
  } else {
    event.respondWith(cacheFirstStrategy(request));
  }
});
