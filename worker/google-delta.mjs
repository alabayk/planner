// A complete cached view remains available to the existing merge/conflict logic.
export function createGoogleDeltaReader({now=()=>Date.now(),maxBytes=8*1024*1024,storage}={}){
  const cache=new Map();
  return async function read(key,list,expand,{force=false}={}){
    let old=cache.get(key);
    if(!old&&storage)try{const saved=await storage.get(key);if(saved)old={...saved,events:new Map(saved.events)};}catch{}
    if(force||old&&now()-old.fullAt>86400000)old=null;
    async function load(previous){
      const events=new Map(previous?.events||[]);let pageToken='',nextSyncToken;
      do{
        const page=await list({syncToken:previous?.token,pageToken});
        for(const event of page.items||[]){
          if(event.recurrence||event.status==='cancelled')for(const [id,item]of events)if(item.recurringEventId===event.id)events.delete(id);
          if(event.recurrence&&event.status!=='cancelled')for(const item of await expand(event))events.set(item.id,item);
          else events.set(event.id,event);
        }
        pageToken=page.nextPageToken||'';nextSyncToken=page.nextSyncToken;
      }while(pageToken);
      const state={events,token:nextSyncToken,fullAt:previous?.fullAt||now()};
      if(nextSyncToken&&new TextEncoder().encode(JSON.stringify([...events])).length<=maxBytes){if(cache.size>=4&&!cache.has(key))cache.delete(cache.keys().next().value);cache.set(key,state);if(storage)try{await storage.set(key,{...state,events:[...events]});}catch{}}
      else{cache.delete(key);if(storage)try{await storage.delete(key);}catch{}}
      return new Map(events);
    }
    try{return await load(old);}catch(error){cache.delete(key);if(storage)try{await storage.delete(key);}catch{}if(old&&/Google 410:/.test(error.message))return load(null);throw error;}
  };
}
