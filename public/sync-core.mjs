export const EVENT_FIELDS = ['title','notes','startsAt','durationMinutes','space','createdBy','done','deleted'];
const equal = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const equalField=(key,a,b)=>['startsAt','starts_at'].includes(key)&&a&&b?new Date(a).getTime()===new Date(b).getTime():equal(a,b);
export const sameFields = (a,b,fields=EVENT_FIELDS) => fields.every(key=>equalField(key,a?.[key],b?.[key]));

export function mergeFields(base,local,remote,fields=EVENT_FIELDS) {
  const merged={...remote},conflicts=[];
  for(const key of fields){
    const ours=!equalField(key,local[key],base[key]),theirs=!equalField(key,remote[key],base[key]);
    if(ours&&theirs&&!equalField(key,local[key],remote[key]))conflicts.push(key);
    else if(ours)merged[key]=local[key];
  }
  const localEdit=fields.some(k=>k!=='deleted'&&!equalField(k,local[k],base[k]));
  const remoteEdit=fields.some(k=>k!=='deleted'&&!equalField(k,remote[k],base[k]));
  if((local.deleted&&!base.deleted&&remoteEdit)||(remote.deleted&&!base.deleted&&localEdit)){
    if(!conflicts.includes('deleted'))conflicts.push('deleted');
  }
  return {merged,conflicts};
}

// A Google event always maps to the same planner UUID, including after a retry.
export async function importId(owner,googleId){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`planner-google:${owner}:${googleId}`)));
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes.slice(0,16),x=>x.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
