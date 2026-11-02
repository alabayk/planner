// Internal Cache API only: never served by an HTTP route; no OAuth credentials.
// Best-effort cross-isolate/colo-local persistence; eviction causes a safe full sync.
export function googleCacheStorage(namespace='google-v1'){
  if(typeof caches==='undefined'||!caches.default)return undefined;
  const url=async key=>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return 'https://planner-internal.invalid/'+namespace+'/'+[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');};
  return {get:async key=>{const response=await caches.default.match(await url(key));return response?response.json():null;},
    set:async(key,value)=>caches.default.put(await url(key),Response.json(value,{headers:{'Cache-Control':'max-age=86400'}})),
    delete:async key=>caches.default.delete(await url(key))};
}
