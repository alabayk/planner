import {EVENT_FIELDS,mergeFields,sameFields} from './sync-core.mjs';

const labels={title:'Название',notes:'Описание',startsAt:'Начало',durationMinutes:'Длительность',space:'Видимость',createdBy:'Владелец',done:'Выполнение',deleted:'Удаление'};
export function createEventSync({client,state,all,put,remove,dbp,render,fromRow,toRow}){
  let running=null;
  const snapshot=e=>Object.fromEntries(['id','version','updatedAt',...EVENT_FIELDS].map(k=>[k,e[k]]));
  async function read(id){const {data,error}=await client.from('planner_events').select('*').eq('id',id).maybeSingle();if(error)throw error;return data?fromRow(data):null;}
  async function acknowledge(job,saved){
    const database=await dbp;
    await new Promise((resolve,reject)=>{
      const tx=database.transaction(['events','outbox'],'readwrite'),queue=tx.objectStore('outbox'),request=queue.get(job.id);
      request.onsuccess=()=>{
        const current=request.result;
        if(!current)return;
        if(current.mutationId===job.mutationId){queue.delete(job.id);tx.objectStore('events').put(saved);}
        else{
          // Keep edits made while the preceding request was in flight.
          const delta=mergeFields(job,current,saved);
          const next={...current,...delta.merged,id:current.id,base:snapshot(saved),mutationId:current.mutationId};
          for(const key of EVENT_FIELDS)if(!sameFields(job,current,[key]))next[key]=current[key];
          queue.put(next);tx.objectStore('events').put(next);
        }
      };
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    const current=(await all('events')).find(e=>e.id===job.id);
    if(current)state.events=state.events.filter(e=>e.id!==job.id).concat(current);
  }
  async function post(job){
    if(job.conflict)return null;
    for(let attempt=0;attempt<4;attempt++){
      const remote=await read(job.id);
      if(remote&&sameFields(remote,job)){await acknowledge(job,remote);return remote;}
      let desired=job;
      if(remote){
        const base=job.base||(Number(job.version)===Number(remote.version)?snapshot(remote):null);
        const result=base?mergeFields(base,job,remote):{conflicts:EVENT_FIELDS.filter(k=>!sameFields(job,remote,[k]))};
        if(result.conflicts.length){
          const current=(await all('outbox')).find(e=>e.id===job.id);
          if(current?.mutationId===job.mutationId)await put('outbox',[{...job,conflict:{remote:snapshot(remote),fields:result.conflicts}}]);
          await show();return null;
        }
        desired={...result.merged,id:job.id,version:remote.version};
      }else if(job.base){
        await put('outbox',[{...job,conflict:{remote:{...job.base,deleted:true},fields:['deleted']}}]);await show();return null;
      }
      const row=toRow(desired);
      const query=remote
        ?client.from('planner_events').update(row).eq('id',job.id).eq('version',remote.version).select().maybeSingle()
        :client.from('planner_events').insert(row).select().single();
      const {data,error}=await query;
      if(error){if(error.code==='23505')continue;throw error;}
      if(!data)continue;
      const saved=fromRow(data);await acknowledge(job,saved);return saved;
    }
    throw new Error('Событие меняется на другом устройстве. Повторим сохранение.');
  }
  async function flush(){
    if(running)return running;
    running=(async()=>{
      let failure;
      for(let pass=0;pass<4;pass++){
        const jobs=(await all('outbox')).filter(e=>!e.conflict);
        if(!jobs.length)break;
        for(const job of jobs)try{await post(job);}catch(error){failure=error;}
        if(failure)break;
      }
      await show();if(failure)throw failure;
    })();
    try{return await running;}finally{running=null;}
  }
  async function save(event){
    const editing=[state.editing,state.taskEditing,state.deadlineEditing].find(e=>e?.id===event.id);
    const editingBase=event._base?snapshot(event._base):editing?snapshot(editing):null;
    const queued=(await all('outbox')).find(e=>e.id===event.id);
    const previous=state.events.find(e=>e.id===event.id);
    const {_base,...cleanEvent}=event;
    const job={...cleanEvent,version:event.version||0,base:queued?.base||editingBase||(previous?.version&&previous.version===event.version?snapshot(previous):null),mutationId:crypto.randomUUID()};
    state.events=state.events.filter(e=>e.id!==job.id).concat(job);
    const database=await dbp;await new Promise((resolve,reject)=>{const tx=database.transaction(['events','outbox'],'readwrite');tx.objectStore('events').put(job);tx.objectStore('outbox').put(job);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});render();await show();
    try{await flush();render();}catch{await show('Нет связи. Изменения сохранены на устройстве и будут отправлены повторно.');}
  }
  function panel(){let node=document.getElementById('syncIssues');if(!node){node=document.createElement('section');node.id='syncIssues';node.className='syncIssues';document.getElementById('offline').after(node);}return node;}
  async function show(message=''){
    const jobs=await all('outbox'),node=panel();node.replaceChildren();
    if(!jobs.length&&!message){node.hidden=true;return;}
    node.hidden=false;const status=document.createElement('p');
    status.textContent=message||`Ожидают сохранения: ${jobs.length}`;node.append(status);
    for(const job of jobs.filter(e=>e.conflict)){
      const box=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Нужно выбрать версию: ${job.title}`;box.append(summary);
      for(const key of job.conflict.fields){
        const line=document.createElement('p');
        const value=v=>key==='deleted'?(v?'удалено':'сохранено'):key==='space'?(v==='shared'?'все':'только я'):typeof v==='boolean'?(v?'да':'нет'):String(v??'');
        line.textContent=`${labels[key]||key}: на устройстве «${value(job[key])}», на сервере «${value(job.conflict.remote[key])}»`;box.append(line);
      }
      for(const [choice,text]of [['local','Оставить моё'],['remote','Принять с сервера']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;
        button.onclick=async()=>{button.disabled=true;try{
          const current=(await all('outbox')).find(e=>e.id===job.id);if(current?.mutationId!==job.mutationId)return;
          const remote=await read(job.id);if(!remote)throw new Error('Событие недоступно. Повторите после обновления.');
          if(remote.version!==job.conflict.remote.version){
            const check=job.base?mergeFields(job.base,job,remote):{conflicts:EVENT_FIELDS.filter(k=>!sameFields(job,remote,[k]))};
            await put('outbox',[{...job,conflict:{remote:snapshot(remote),fields:check.conflicts.length?check.conflicts:job.conflict.fields}}]);
            await show('На сервере появились новые изменения. Проверьте обновлённые варианты.');return;
          }
          let resolved;
          if(job.conflict.fields.includes('deleted'))resolved=choice==='local'?snapshot(job):snapshot(remote);
          else{resolved=mergeFields(job.base||remote,job,remote).merged;for(const key of job.conflict.fields)resolved[key]=choice==='local'?job[key]:remote[key];}
          const next={...resolved,id:job.id,version:remote.version,base:snapshot(remote),mutationId:crypto.randomUUID()};
          await put('outbox',[next]);await put('events',[next]);state.events=state.events.filter(e=>e.id!==job.id).concat(next);
          await flush();render();
        }catch(error){await show(error.message);}finally{button.disabled=false;}};
        box.append(button);
      }
      node.append(box);
    }
    const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить отправку';retry.onclick=async()=>{retry.disabled=true;try{await flush();render();}catch(error){await show(error.message);}finally{retry.disabled=false;}};node.append(retry);
  }
  async function applyRemote(remote){
    const database=await dbp;
    await new Promise((resolve,reject)=>{
      const tx=database.transaction(['events','outbox'],'readwrite'),events=tx.objectStore('events'),queue=tx.objectStore('outbox');
      const storedRequest=events.getAll(),pendingRequest=queue.getAll();let stored,pending;
      const apply=()=>{if(!stored||!pending)return;const pendingIds=new Set(pending.map(e=>e.id)),byId=new Map(stored.map(e=>[e.id,e]));
        for(const row of remote)if(!pendingIds.has(row.id)&&Number(row.version)>=Number(byId.get(row.id)?.version||0))events.put(row);
      };
      storedRequest.onsuccess=()=>{stored=storedRequest.result;apply();};pendingRequest.onsuccess=()=>{pending=pendingRequest.result;apply();};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    const pendingIds=new Set((await all('outbox')).map(e=>e.id)),remoteIds=new Set(remote.map(e=>e.id));
    state.events=(await all('events')).filter(e=>pendingIds.has(e.id)||remoteIds.has(e.id));
  }
  async function saveMany(events){
    const queued=new Map((await all('outbox')).map(e=>[e.id,e]));
    const jobs=events.map(event=>{
      const previous=state.events.find(e=>e.id===event.id),prior=queued.get(event.id);
      const {_base,...cleanEvent}=event;
      return {...cleanEvent,version:event.version||0,base:prior?.base||(event._base?snapshot(event._base):previous?.version&&previous.version===event.version?snapshot(previous):null),mutationId:crypto.randomUUID()};
    });
    const database=await dbp;await new Promise((resolve,reject)=>{const tx=database.transaction(['events','outbox'],'readwrite');for(const job of jobs){tx.objectStore('events').put(job);tx.objectStore('outbox').put(job);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    const ids=new Set(jobs.map(e=>e.id));state.events=state.events.filter(e=>!ids.has(e.id)).concat(jobs);render();await show();
    flush().then(()=>render()).catch(()=>show('Серия сохранена на устройстве и будет отправлена при восстановлении связи.'));
  }
  return {save,post,flush,show,applyRemote,saveMany};
}
