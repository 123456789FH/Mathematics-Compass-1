const CACHE='bousla-v5-membership-hotfix';
const SHELL=[
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/app.js',
  './js/demo-backend.js',
  './js/supabase-backend.js',
  './assets/images/logo.jpg',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

const networkFirst=request=>fetch(request)
  .then(response=>{
    if(response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(request,copy));
    }
    return response;
  })
  .catch(()=>caches.match(request));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;

  // ملفات التشغيل الحساسة والصفحات: الشبكة أولًا حتى تصل التحديثات فورًا.
  if(event.request.mode==='navigate'||
     url.pathname.endsWith('/index.html')||
     url.pathname.endsWith('/js/config.js')||
     url.pathname.endsWith('/js/app.js')||
     url.pathname.endsWith('/js/supabase-backend.js')){
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>cached||networkFirst(event.request))
  );
});
