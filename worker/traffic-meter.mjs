const scopes=new Map();
export function trafficState(env){
  const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}).slice(0,7),key=env.SUPABASE_URL;
  let state=scopes.get(key);if(!state||state.month!==month||state.key!==env.SUPABASE_SERVICE_ROLE_KEY){state={month,key:env.SUPABASE_SERVICE_ROLE_KEY,bytes:0,requests:0,total:null,retryAt:0,running:null,pending:null};scopes.set(key,state);}
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});if(state.day!==day){state.day=day;state.dayTotal=0;}
  return state;
}
export async function meteredFetch(env,input,init){
  const response=await fetch(input,init),url=new URL(typeof input==='string'?input:input.url);
  const database=url.origin===new URL(env.SUPABASE_URL).origin;
  if(database){
    const bytes=(await response.clone().arrayBuffer()).byteLength+(typeof init?.body==='string'?new TextEncoder().encode(init.body).length:0),state=trafficState(env);
    state.bytes+=bytes;state.requests++;
    console.log(JSON.stringify({event:'traffic-sample',operation:url.pathname.split('/').slice(0,4).join('/'),bytes,status:response.status}));
  }
  return response;
}
export async function flushTraffic(env){
  const state=trafficState(env);if(state.running)return state.running;if(Date.now()<state.retryAt||!state.requests&&!state.pending)return;
  state.running=(async()=>{
    if(!state.pending){state.pending={batch_id:crypto.randomUUID(),byte_count:state.bytes,request_count:state.requests};state.bytes=0;state.requests=0;}
    try{
      const result=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/planner_record_traffic',{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(state.pending),signal:AbortSignal.timeout(10000)});
      if(!result.ok)throw Error('Traffic SQL unavailable');const data=await result.json();if(!Number.isFinite(Number(data.bytes)))throw Error('Invalid traffic totals');state.total=Number(data.bytes);state.dayTotal=Number(data.day_bytes)||0;state.pending=null;
    }catch{state.retryAt=Date.now()+15*60000;}
  })();try{await state.running;}finally{state.running=null;}
}
export function trafficBudget(env){
  const state=trafficState(env),bytes=(state.total||0)+state.bytes+(state.pending?.byte_count||0);
  const dayBytes=state.dayTotal+state.bytes+(state.pending?.byte_count||0);
  return {month:state.month,bytes,dayBytes,measured:state.total!==null,warning:bytes>=3e9||dayBytes>=1e8,economy:bytes>=4e9||dayBytes>=15e7};
}
