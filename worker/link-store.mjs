import {readCompactSnapshot} from '../public/compact-sync.mjs';
export function createLinkReader(admin){
  let scope='',cache=new Map(),legacyUntil=0;
  return async(env,owner)=>{
    const key=env.SUPABASE_URL+'|'+env.SUPABASE_SERVICE_ROLE_KEY;if(scope!==key){scope=key;cache=new Map();legacyUntil=0;}
    const filter='owner=eq.'+encodeURIComponent(owner),full=()=>admin(env,'planner_google_links?select=*&'+filter);
    if(Date.now()<legacyUntil)return full();
    const client={from(){const params=new URLSearchParams(filter);return {
      select(value){params.set('select',value==='*'?'*,id:planner_id':'id:planner_id,version,updated_at');return this;},order(){params.set('order','planner_id.asc');return this;},limit(n){params.set('limit',n);return this;},gt(_key,v){params.set('planner_id','gt.'+v);return this;},in(_key,v){params.set('planner_id','in.('+v.join(',')+')');return this;},
      then(resolve,reject){return admin(env,'planner_google_links?'+params).then(data=>({data,error:null})).then(resolve,reject);}
    };}};
    try{const result=await readCompactSnapshot(client,{table:'planner_google_links',cached:cache.get(owner)||[]});cache.set(owner,result.rows);return result.rows;}
    catch(error){if(/Database 400:.*(42703|version|updated_at|PGRST)/s.test(error.message)){legacyUntil=Date.now()+15*60000;return full();}throw error;}
  };
}
