const tag='[[deadline]]';
export function createDeadlineScheduler({client,requireSession,storage,profile,now=()=>Date.now()}){
  const running=new Map();
  const marker=event=>`queued-deadline:${profile()}:${event.id}`;
  const signature=event=>JSON.stringify([event.title,event.startsAt,event.notes,event.space,!!event.deleted,!!event.done]);
  const pendingKey=()=>`pending-deadlines:${profile()}`;
  const pending=()=>{try{return JSON.parse(storage.getItem(pendingKey())||'{}');}catch{return {};}};
  function remember(event,replace){const records=pending();records[event.id]={event,replace};storage.setItem(pendingKey(),JSON.stringify(records));}
  function forget(event){const records=pending();if(records[event.id]&&signature(records[event.id].event)===signature(event)){delete records[event.id];storage.setItem(pendingKey(),JSON.stringify(records));}}
  async function write(event,replace){
    const key=marker(event),value=signature(event),prior=storage.getItem(key);
    if(!replace&&prior===value)return;
    const cancelled=event.deleted||event.done;
    const session=await requireSession();
    // A changed offline edit must replace the previous reminder, not be ignored
    // by the event_id/audience uniqueness constraint on reconnect.
    if(replace||prior||cancelled){
      const {error}=await client.from('push_jobs').delete().eq('event_id',event.id);
      if(error)throw error;
    }
    if(cancelled){storage.setItem(key,value);return;}
    const due=new Date(event.startsAt).getTime();if(!Number.isFinite(due))throw new Error('Некорректная дата дедлайна');
    let data;try{data=JSON.parse(event.notes.slice(tag.length));}catch{data={};}
    const reminder=Number(data?.reminder),audience=event.space==='shared'?'all':'self';
    const base={created_by:session.user.id,event_id:event.id,title:event.title};
    const jobs=[{...base,audience:audience+'_soon',kind:'deadline_soon',deliver_at:new Date(due-120000).toISOString()},
      {...base,audience:audience+'_due',kind:'deadline_due',deliver_at:new Date(due).toISOString()}];
    if(Number.isFinite(reminder)&&reminder>0)jobs.unshift({...base,audience,kind:'deadline',deliver_at:new Date(due-reminder*60000).toISOString()});
    const future=jobs.filter(job=>new Date(job.deliver_at).getTime()>=now());
    if(future.length){const {error}=await client.from('push_jobs').upsert(future,{onConflict:'event_id,audience',ignoreDuplicates:true});if(error)throw error;}
    storage.setItem(key,value);
  }
  function queue(event,replace=true,{defer=false}={}){
    remember(event,replace);
    if(defer)return Promise.resolve();
    const previous=running.get(event.id)||Promise.resolve(),task=previous.catch(()=>{}).then(()=>write(event,replace)).then(()=>forget(event));
    running.set(event.id,task);
    return task.finally(()=>{if(running.get(event.id)===task)running.delete(event.id);});
  }
  async function reconcile(events,{replaceIds=new Set(),blockedIds=new Set()}={}){
    const records=pending(),merged=new Map([...Object.values(records).map(record=>record.event),...events].map(event=>[event.id,event]));
    for(const event of merged.values())if(!blockedIds.has(event.id)&&event.createdBy===profile()&&(event.notes||'').startsWith(tag)&&
      (records[event.id]||event.deleted||event.done||new Date(event.startsAt).getTime()>now()))await queue(event,replaceIds.has(event.id)||!!records[event.id]?.replace);
  }
  return {queue,reconcile};
}
