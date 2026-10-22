const CACHE_NAME = 'rayka-buoy-v5';

// لیست تمام CDNها و فایل‌های داخلی که باید آفلاین ذخیره شوند
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-dark.png',
  './icon-512-dark.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

// ۱. رویداد Install: ذخیره فایل‌ها در Cache
// (هر فایل جدا ذخیره می‌شود؛ اگر یکی در دسترس نبود، نصب سرویس‌ورکر و اعلان‌ها شکست نمی‌خورد)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS_TO_CACHE.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

// ۲. رویداد Activate: پاک‌سازی کش‌های قدیمی
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ۳. رویداد Fetch: دریافت اطلاعات
self.addEventListener('fetch', (event) => {
  // ۱. عدم ذخیره‌سازی درخواست‌های مستقیم دیتابیس Supabase و WebSocket
  if (event.request.url.includes('supabase.co') || event.request.url.startsWith('wss://')) {
    return;
  }

  // ۲. عدم کش کردن درخواست‌های غیر GET (مانند POST/PUT)
  if (event.request.method !== 'GET') {
    return;
  }

  // ۳. استراتژی: اول بررسی کش (سریع‌تر و بدون خطا در آفلاین)، در صورت عدم وجود -> دریافت از شبکه
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // اگر فایل در کش بود، همان را برمی‌گرداند و در پس‌زمینه اپدیت می‌کند
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {/* آنلاین نیست، نادیده بگیر */});

        return cachedResponse;
      }

      // اگر در کش نبود، از شبکه دریافت کن
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});

// ۴. رویداد Push: اعلان هشدار (نشتی / باتری کم) حتی وقتی برنامه کاملاً بسته است
//    سرور (تابع push-alerts) تا وقتی کاربر در برنامه «دیدم» را نزند، هر ۲۰ ثانیه یک پیام تازه می‌فرستد
//    و هر پیام با renotify دوباره صدا و لرزش می‌دهد.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try { data = { body: event.data.text() }; } catch (_) { data = {}; }
  }

  const title = data.title || 'هشدار رایکا';
  const options = {
    body: data.body || '',
    tag: data.tag || 'rayka-alert',   // همه‌ی هشدارها یک tag دارند: اعلان جدید جای قبلی را می‌گیرد و دوباره صدا می‌دهد
    renotify: true,
    requireInteraction: true,         // تا کاربر لمس نکند از صفحه نمی‌رود
    silent: false,
    vibrate: [500, 200, 500, 200, 900],
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './' }
  };

  event.waitUntil((async () => {
    // اگر برنامه همین الان جلوی چشم کاربر است، آلارم داخل خود برنامه (صدا + صفحهٔ قرمز) کار را انجام می‌دهد
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = list.some((c) => c.visibilityState === 'visible');
    if (visible && options.tag !== 'rayka-test') return;
    await self.registration.showNotification(title, options);
  })());
});

// ۵. لمس اعلان: برنامه را باز کن (یا اگر باز است جلو بیاور) تا صفحهٔ هشدار و دکمهٔ «دیدم» دیده شود
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
