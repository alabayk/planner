const CACHE='vmeste-v66',ASSETS=['./','./styles.css?v=11','./enhancements.css?v=41','./reliability.css?v=64','./event-types.css?v=65','./collaboration.css?v=66','./app.js?v=66','./api.mjs','./sync-core.mjs','./reliable-sync.mjs','./calendar-health.mjs','./event-model.mjs','./event-editor.mjs','./event-resize.mjs','./invite-model.mjs','./collaboration.mjs','./manifest.webmanifest?v=11','./icon.svg?v=11'],SUPABASE='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const assetPaths=new Set(ASSETS.map(path=>new URL(path,self.location.href).pathname));
function acceptable(response,url,navigation=false){return response.ok&&(!/text\/html/i.test(response.headers.get('content-type')||'')||navigation||url.pathname.endsWith('/'));}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(async cache=>{
  await Promise.all(ASSETS.map(async path=>{const url=new URL(path,self.location.href),response=await fetch(url,{cache:'reload'});if(!acceptable(response,url,path==='./'))throw new Error('Asset unavailable');await cache.put(url,response);}));
  try{const response=await fetch(SUPABASE);if(response.ok&&!/text\/html/i.test(response.headers.get('content-type')||''))await cache.put(SUPABASE,response);}catch{}
}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vmeste-v')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url),navigation=request.mode==='navigate'&&url.origin===self.location.origin;
  const asset=url.origin===self.location.origin&&assetPaths.has(url.pathname),cdn=url.href===SUPABASE;
  // API requests never fall back to the HTML application shell.
  if(!navigation&&!asset&&!cdn)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{const response=await fetch(request);if(!acceptable(response,url,navigation))throw new Error('Asset unavailable');await cache.put(request,response.clone());return response;}
    catch{const cached=await cache.match(request,navigation?{ignoreSearch:true}:undefined);if(cached)return cached;if(navigation){const shell=await cache.match(new URL('./',self.location.href));if(shell)return shell;}return new Response('Нет подключения',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=new URL(event.notification.data?.url||'./',self.registration.scope);
  if(url.origin!==self.location.origin)return;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{const window=list.find(item=>item.url.startsWith(self.registration.scope));if(window){await window.navigate(url.href);return window.focus();}return clients.openWindow(url.href);}));
});
self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{};}catch{}event.waitUntil(self.registration.showNotification(data.title||'Планер',{body:data.body||'Новое событие',icon:'./icon.svg',badge:'./icon.svg',tag:data.tag||'shared-plan',data:{url:data.url||'./'}}));});
