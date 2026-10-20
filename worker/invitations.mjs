import {INVITE_TAG,readInvite,inviteNotes,isInviteRow,transition,eventForAction,actionApplied,freeSlots} from '../public/invite-model.mjs';
import {importId} from '../public/sync-core.mjs';
import {checkedJson,safeError} from './api-errors.mjs';
const profiles=['vanya','ksusha'],uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const profile=user=>profiles.find(value=>user?.email===value+'@planer.app')||'';
const fail=(message,status=409)=>{const error=new Error(message);error.status=status;throw error;};
const response=(body,status=200)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
async function admin(env,path,init={}){return checkedJson(await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...init,signal:AbortSignal.timeout(12000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...init.headers}}));}
// Internal coordination records stay hidden even in older calendar clients.
async function recordList(env){return admin(env,`planner_events?select=*&notes=like.${encodeURIComponent(INVITE_TAG)}*&deleted=eq.true&order=updated_at.desc&limit=500`);}
async function getEvent(env,id){if(!uuid.test(id||''))fail('Событие не найдено',404);return (await admin(env,`planner_events?id=eq.${id}&select=*`))[0];}
async function update(env,row,patch){return (await admin(env,`planner_events?id=eq.${row.id}&version=eq.${row.version}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...patch,version:Number(row.version)+1,updated_at:new Date().toISOString()})}))[0];}
const object=row=>({id:row.id,title:row.title,notes:row.notes,startsAt:row.starts_at,durationMinutes:row.duration_minutes,space:row.space,createdBy:row.created_by,done:row.done,deleted:row.deleted,version:row.version,updatedAt:row.updated_at});
async function saveRecord(env,row,data){return update(env,row,{notes:inviteNotes(data)});}
async function pairedEvent(env,record){const data=readInvite(record),event=await getEvent(env,data?.event);if(!event||event.deleted||event.created_by!==record.created_by||isInviteRow(event))fail('Событие удалено или недоступно',404);return event;}
const noticeText=(kind,title)=>({send:'Приглашение на событие',accept:'Участие подтверждено',decline:'Приглашение отклонено',propose:'Предложено другое время',acceptProposal:'Новое время подтверждено',rejectProposal:'Предложение времени отклонено',cancel:'Приглашение отменено'}[kind]||'Приглашение изменено')+': '+title.slice(0,100);
async function notification(env,record,users=null){
  const data=readInvite(record);if(!data?.notice||data.op)return record;
  if(!users)users=(await checkedJson(await fetch(env.SUPABASE_URL+'/auth/v1/admin/users?page=1&per_page=1000',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}}))).users||[];
  const target=users.find(user=>user.email===data.notice.to+'@planer.app'),sender=users.find(user=>user.email===data.notice.from+'@planer.app');
  if(!target||!sender)throw new Error('Не найден аккаунт для уведомления');
  const id=await importId('invitation-notice',record.id+':'+data.rev);
  await admin(env,'push_jobs?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id,event_id:data.event,created_by:sender.id,target_user_id:target.id,audience:'invite:'+record.id+':'+data.rev,kind:'invite',title:data.notice.text,deliver_at:new Date().toISOString()})});
  const next={...data};delete next.notice;return await saveRecord(env,record,next)||record;
}
async function complete(env,record){
  const data=readInvite(record),op=data?.op;if(!op)return record;
  const row=await pairedEvent(env,record),event=object(row),clean={...data};delete clean.op;
  const change=transition(clean,op.kind,op.actor,op.proposal,event),desired=eventForAction(event,clean,op.kind,change.proposal);
  const modifies=['accept','acceptProposal'].includes(op.kind)||['decline','cancel'].includes(op.kind)&&data.state==='accepted';
  if(modifies&&!actionApplied(event,clean,op.kind,change.proposal)){
    if(Number(row.version)!==Number(op.sourceVersion))fail('Событие изменилось. Обновите приглашение и ответьте заново');
    if(desired.notes.length>600)fail('Для приглашения нужно сократить описание события');
    const saved=await update(env,row,{notes:desired.notes,space:desired.space,starts_at:desired.startsAt,duration_minutes:desired.durationMinutes});
    if(!saved)fail('Событие изменилось. Повторите после обновления');
  }
  const next={...clean,state:change.state,rev:Number(data.rev)+1,notice:{to:change.target,from:op.actor,text:noticeText(op.kind,row.title)}};
  if(op.kind==='propose')next.proposal=change.proposal;else delete next.proposal;
  const saved=await saveRecord(env,record,next);return saved||await getEvent(env,record.id);
}
export async function processInvitations(env){
  const records=await recordList(env);
  for(let record of records)try{
    if(readInvite(record)?.op)try{record=await complete(env,record);}catch(error){if(error.status===409||error.status===404){const data=readInvite(record);delete data.op;await saveRecord(env,record,data);}throw error;}
    await notification(env,record);
  }catch(error){console.error(JSON.stringify({event:'invitation-retry',message:safeError(error)}));}
}
export async function handleInvitations(request,env,user){
  const actor=profile(user);if(!user?.id||!profiles.includes(actor))return response({error:'Нужно войти в планер'},401);
  const path=new URL(request.url).pathname;
  try{
    if(path==='/invites/list'&&request.method==='GET'){
      const records=(await recordList(env)).filter(record=>{const data=readInvite(record);return record.created_by===actor||data?.to===actor;});
      const items=[];
      for(const record of records)try{const event=await pairedEvent(env,record),data=readInvite(record);items.push({id:record.id,rev:data.rev,state:data.state,working:!!data.op,proposal:data.proposal||null,incoming:data.to===actor,event:object(event)});}catch(error){if(error.status!==404)throw error;}
      return response({items});
    }
    if(path==='/invites/free'&&request.method==='POST'){
      const query=await request.json(),rows=[];
      for(let offset=0;offset<5000;offset+=1000){const page=await admin(env,`planner_events?select=*&deleted=eq.false&order=id&limit=1000&offset=${offset}`);rows.push(...page.filter(row=>profiles.includes(row.created_by)));if(page.length<1000)break;if(offset===4000)fail('Слишком много событий для поиска. Попробуйте позже',503);}
      return response({slots:freeSlots(rows,query)});
    }
    if(path==='/invites/send'&&request.method==='POST'){
      const body=await request.json(),event=await getEvent(env,body.eventId);
      if(!event||event.deleted||isInviteRow(event)||event.notes==='__todo__'||event.notes.startsWith('[[deadline]]'))fail('Событие недоступно',404);
      if(event.created_by!==actor)fail('Пригласить может только владелец события',403);
      if(Number(body.eventVersion)!==Number(event.version))fail('Событие изменилось. Откройте его заново');
      if(object(event).notes.includes('\n[[planner:both]]'))fail('Событие уже добавлено обоим участникам');
      if(event.notes.length+18>600)fail('Перед отправкой приглашения немного сократите описание');
      const id=await importId('invitation',event.id),existing=await getEvent(env,id),previous=readInvite(existing||{}),to=profiles.find(value=>value!==actor);
      if(previous?.op)fail('Предыдущий ответ ещё сохраняется');
      let record=existing;
      if(!previous||!['pending','proposed','accepted'].includes(previous.state)){
        const data={event:event.id,to,state:'pending',rev:Number(previous?.rev||0)+1,originalSpace:event.space,notice:{to,from:actor,text:noticeText('send',event.title)}};
        if(existing)record=await saveRecord(env,existing,data);
        else record=(await admin(env,'planner_events?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id,title:'Приглашение',notes:inviteNotes(data),starts_at:event.starts_at,duration_minutes:5,space:actor,created_by:actor,done:false,deleted:true,version:1,updated_at:new Date().toISOString()})}))[0]||await getEvent(env,id);
        if(!record)fail('Приглашение изменилось. Повторите');
      }
      try{record=await notification(env,record);}catch{}
      return response({ok:true,queued:!readInvite(record)?.notice});
    }
    if(path==='/invites/respond'&&request.method==='POST'){
      const body=await request.json();let record=await getEvent(env,body.id);if(!record||!isInviteRow(record))fail('Приглашение не найдено',404);
      const data=readInvite(record),event=await pairedEvent(env,record);
      if(actor!==record.created_by&&actor!==data.to)fail('Приглашение недоступно',403);
      if(data.op){if(data.op.actor!==actor||data.op.kind!==body.action)fail('Предыдущий ответ ещё сохраняется');}
      else{
        if(Number(body.rev)!==Number(data.rev)||Number(body.eventVersion)!==Number(event.version))fail('Приглашение изменилось. Обновите список');
        const change=transition(data,body.action,actor,body.proposal,object(event));
        const next={...data,op:{kind:body.action,actor,sourceVersion:event.version}};delete next.notice;
        if(body.action==='propose')next.op.proposal=change.proposal;
        record=await saveRecord(env,record,next);if(!record)fail('Другой ответ уже сохраняется. Обновите список');
      }
      try{record=await complete(env,record);}catch(error){if(error.status===409){const latest=readInvite(record);delete latest.op;await saveRecord(env,record,latest);}throw error;}
      try{await notification(env,record);}catch{}
      return response({ok:true});
    }
    return response({error:'Действие недоступно'},405);
  }catch(error){return response({error:safeError(error)},error.status||503);}
}
