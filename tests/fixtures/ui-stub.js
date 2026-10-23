// Local browser fixture only. No real Auth, database or push service is contacted.
window.smoke={errors:[],checks:[],writes:0};
addEventListener('error',event=>smoke.errors.push(event.message));
addEventListener('unhandledrejection',event=>smoke.errors.push(String(event.reason?.stack||event.reason)));
const profile=document.querySelector('[data-person]').dataset.person;
const other=document.querySelectorAll('[data-person]')[1].dataset.person;
localStorage.setItem('planner-last-profile',profile);
const session={access_token:'mock-token',refresh_token:'mock-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'mock-user',email:profile+'@planer.app'}};
const starts=new Date();starts.setHours(14,0,0,0);
const title='<img src=x onerror="window.injected=true"> & test';
const base={starts_at:starts.toISOString(),duration_minutes:60,space:'shared',created_by:profile,done:false,deleted:false,version:1,updated_at:new Date().toISOString()};
const rows=new Map([
  ['10000000-0000-4000-8000-000000000001',{...base,id:'10000000-0000-4000-8000-000000000001',title,notes:''}],
  ['10000000-0000-4000-8000-000000000002',{...base,id:'10000000-0000-4000-8000-000000000002',title:'Foreign visible',created_by:other,notes:''}],
  ['10000000-0000-4000-8000-000000000003',{...base,id:'10000000-0000-4000-8000-000000000003',title:'Deadline '+title,notes:'[[deadline]]{"reminder":0}',starts_at:new Date(Date.now()+3600000).toISOString()}],
  ['10000000-0000-4000-8000-000000000004',{...base,id:'10000000-0000-4000-8000-000000000004',title:'Smoke task',notes:'__todo__',space:profile}],
]);
smoke.hasEvent=title=>[...rows.values()].some(row=>row.title===title&&!row.deleted);
smoke.countEvents=title=>[...rows.values()].filter(row=>row.title===title&&!row.deleted).length;
Object.defineProperty(navigator,'onLine',{get:()=>!smoke.offline});
window.supabase={createClient(_url,_key,options){
  smoke.persisted=options.auth.persistSession&&options.auth.autoRefreshToken;
  return {auth:{getSession:async()=>({data:{session}}),refreshSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}}),signInWithPassword:async()=>({data:{session}}),updateUser:async()=>({data:{user:session.user}}),signOut:async()=>({error:null})},from(table){
    let selection='*',filters=[],ids=null,limit=Infinity,patch=null,mode='read',single=false;
    const query={select(value='*'){selection=value;return this;},order(){return this;},limit(value){limit=value;return this;},
      eq(key,value){filters.push(row=>row[key]===value);return this;},gt(key,value){filters.push(row=>row[key]>value);return this;},not(){filters.push(row=>!(row.notes||'').startsWith('[[invitation]]'));return this;},in(_key,value){ids=value;return this;},
      insert(value){mode='insert';patch=value;return this;},upsert(value){mode='upsert';patch=value;return this;},update(value){mode='update';patch=value;return this;},delete(){mode='delete';return this;},
      single(){single=true;return this;},maybeSingle(){single=true;return this;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        if(smoke.offline)return {data:null,error:{message:'offline',status:503},status:503};
        if(table!=='planner_events'){if(mode!=='read')smoke.writes++;return {data:[],error:null,status:200};}
        let result=[...rows.values()].filter(row=>filters.every(fn=>fn(row))&&(!ids||ids.includes(row.id))).sort((a,b)=>a.id.localeCompare(b.id));
        if(mode==='insert'||mode==='upsert'){const items=Array.isArray(patch)?patch:[patch];for(const row of items)rows.set(row.id,{...row});result=items;}
        if(mode==='update'){result=result.map(row=>({...row,...patch}));for(const row of result)rows.set(row.id,row);}
        if(mode==='delete'){for(const row of result)rows.delete(row.id);result=[];}
        if(selection==='id'&&ids&&mode==='read')result=ids.map(id=>({id})); // old schedule seeds already exist
        result=result.slice(0,limit).map(row=>selection==='*'?{...row}:Object.fromEntries(selection.split(',').map(key=>[key,row[key]])));
        return {data:single?result[0]||null:result,error:null,status:200};
      }).then(resolve,reject);},
    };return query;
  }};
}};
const realFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin)return realFetch(input,init);
  if(smoke.offline)throw Error('offline');
  if(url.pathname==='/google/status')return Response.json({connected:false,conflicts:[]});
  if(url.pathname==='/google/sync')return Response.json({ok:true});
  throw Error('External request blocked by local smoke test');
};
Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({}),ready:Promise.resolve({showNotification:async()=>{}})}});
Object.defineProperty(window,'Notification',{value:{permission:'denied',requestPermission:async()=> 'denied'}});
