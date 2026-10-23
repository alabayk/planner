// Persist side effects separately from event edits; a retry uses the same job ID.
export function createSharedNotifications({client,requireSession,storage,profile,uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}){
  const running=new Map(),key=()=>`pending-shared-notifications:${profile()}`;
  const read=()=>{try{return JSON.parse(storage.getItem(key())||'{}');}catch{return {};}};
  function forget(record){const records=read();if(records[record.eventId]?.id===record.id){delete records[record.eventId];storage.setItem(key(),JSON.stringify(records));}}
  function deliver(record){
    if(running.has(record.id))return running.get(record.id);
    const task=(async()=>{
      const session=await requireSession(),{error}=await client.from('push_jobs').upsert({id:record.id,created_by:session.user.id,target_user_id:record.targetUserId,
        audience:record.targetUserId?'self':'other',kind:'shared',title:record.title,deliver_at:record.createdAt},{onConflict:'id',ignoreDuplicates:true});
      if(error)throw error;forget(record);
    })();
    running.set(record.id,task);return task.finally(()=>{if(running.get(record.id)===task)running.delete(record.id);});
  }
  async function queue(event,{title,targetUserId=null,defer=false}={}){
    const record={id:uuid(),eventId:event.id,targetUserId,title:title||event.title,createdAt:now()},records=read();records[event.id]=record;storage.setItem(key(),JSON.stringify(records));
    if(!defer)await deliver(record);
  }
  async function reconcile(events,{blockedIds=new Set()}={}){
    const byId=new Map(events.map(event=>[event.id,event]));
    for(const record of Object.values(read())){
      if(blockedIds.has(record.eventId))continue;
      const event=byId.get(record.eventId);
      if(!event||event.deleted||event.createdBy!==profile()||event.space!=='shared'||!(event.notes||'').includes('[[planner:both]]')){forget(record);continue;}
      await deliver(record);
    }
  }
  return {queue,reconcile};
}
