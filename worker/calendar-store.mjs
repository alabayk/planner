import {readCompactSnapshot} from '../public/compact-sync.mjs';

// Best-effort isolate cache, not a source of truth: every cycle checks DB revisions.
// A cold isolate or a periodic/manual full refresh safely rebuilds it without SQL.
export function createCalendarSnapshotReader(admin,{now=()=>Date.now(),fullRefreshMs=30*60000,maxBytes=8*1024*1024}={}){
  let scope;
  return async function read(env,{force=false}={}){
    if(!scope||scope.url!==env.SUPABASE_URL||scope.key!==env.SUPABASE_SERVICE_ROLE_KEY)
      scope={url:env.SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY,rows:[],fullAt:null,running:null};
    const state=scope;
    if(state.running)return state.running;
    const full=force||state.fullAt===null||now()-state.fullAt>=fullRefreshMs;
    const client={from(table){
      const query=new URLSearchParams();
      return {
        select(value){query.set('select',value);return this;},
        order(key){query.set('order',key+'.asc');return this;},
        limit(value){query.set('limit',String(value));return this;},
        gt(key,value){query.set(key,'gt.'+value);return this;},
        in(key,values){query.set(key,'in.('+values.join(',')+')');return this;},
        then(resolve,reject){return admin(env,table+'?'+query).then(data=>({data,error:null})).then(resolve,reject);},
      };
    }};
    state.running=(async()=>{
      const result=await readCompactSnapshot(client,{table:'planner_events',cached:state.rows,force:full});
      if(new TextEncoder().encode(JSON.stringify(result.rows)).byteLength<=maxBytes){
        state.rows=result.rows;if(full)state.fullAt=now();
      }else{state.rows=[];state.fullAt=null;}
      return result.rows.map(row=>({...row}));
    })();
    try{return await state.running;}
    catch(error){state.rows=[];state.fullAt=null;throw error;}
    finally{state.running=null;}
  };
}
