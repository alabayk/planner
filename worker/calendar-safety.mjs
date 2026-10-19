import {mergeFields,sameFields,importId} from '../public/sync-core.mjs';
export const CALENDAR_FIELDS=['title','notes','starts_at','duration_minutes','deleted'];
export const reconnectNeeded=error=>/invalid_grant|invalid_token|invalid_scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes|Google 401:/.test(String(error?.message||error));
export const calendarSnapshot=row=>Object.fromEntries(CALENDAR_FIELDS.map(key=>[key,row[key]??(key==='notes'?'':key==='deleted'?false:null)]));
export function readSignature(value){try{const parsed=JSON.parse(value);if(parsed.format===2)return parsed;}catch{}return {hash:value,base:null};}
export async function recordConflict(admin,env,row,owner,remote,etag,base){
  const existing=await admin(env,`planner_google_conflicts?select=id,reason&owner=eq.${encodeURIComponent(owner)}&planner_id=eq.${row.id}&resolved_at=is.null`);
  const payload={type:'sync_conflict',local:calendarSnapshot(row),remote:calendarSnapshot(remote),version:row.version,etag,base};
  if(existing.some(entry=>{try{const p=JSON.parse(entry.reason);return p.version===payload.version&&p.etag===etag;}catch{return false;}}))return;
  await admin(env,'planner_google_conflicts',{method:'POST',body:JSON.stringify({planner_id:row.id,owner,reason:JSON.stringify(payload)})});
}
export async function compareAndSet(admin,env,row,patch){
  const rows=await admin(env,`planner_events?id=eq.${row.id}&version=eq.${row.version}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...patch,version:Number(row.version)+1,updated_at:new Date().toISOString()})});
  return rows[0]||null;
}
export async function stableImportedRow(owner,event,fields,rows){
  const id=await importId(owner,event.id);
  const prior=rows.find(row=>row.id===id)||rows.find(row=>row.created_by===owner&&!row.deleted&&sameFields(calendarSnapshot(row),{...fields,deleted:false},CALENDAR_FIELDS));
  return {id:prior?.id||id,prior};
}
export function mergeCalendar(base,row,remote){return mergeFields(calendarSnapshot(base),calendarSnapshot(row),calendarSnapshot(remote),CALENDAR_FIELDS);}
