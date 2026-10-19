import {eventMeta,eventEnd,withTiming,plusDays} from './event-model.mjs';
export const INVITE_TAG='[[invitation]]',BOTH='\n[[planner:both]]';
export const isInviteRow=row=>(row.notes||'').startsWith(INVITE_TAG);
export function readInvite(row){try{return isInviteRow(row)?JSON.parse(row.notes.slice(INVITE_TAG.length)):null;}catch{return null;}}
export function inviteNotes(data){const notes=INVITE_TAG+JSON.stringify(data);if(notes.length>600)throw new Error('Слишком много данных приглашения');return notes;}
export const participant=event=>event.space==='shared'&&(event.notes||'').includes(BOTH);
const failure=message=>{const error=new Error(message);error.status=409;throw error;};
export function normalizedProposal(proposal,event){
  const allDay=!!eventMeta(event).allDay;
  const start=allDay?new Date(proposal?.startDate+'T00:00:00'):new Date(proposal?.start);
  const end=allDay?new Date(proposal?.endDate+'T00:00:00'):new Date(proposal?.end);
  const timed=withTiming({notes:''},start,end,allDay);
  if(end-start>366*86400000)failure('Период не должен превышать год');
  return allDay?{allDay:true,startDate:eventMeta(timed).startDate,endDate:eventMeta(timed).endDate}:{start:start.toISOString(),end:end.toISOString()};
}
export function transition(data,action,actor,payload,event){
  const owner=event.created_by||event.createdBy,recipient=data.to,isOwner=actor===owner,isRecipient=actor===recipient;
  if(data.op)failure('Предыдущий ответ ещё сохраняется. Повторите через несколько секунд');
  if(action==='accept'&&isRecipient&&data.state==='pending')return {state:'accepted',target:owner};
  if(action==='decline'&&isRecipient&&['pending','proposed','accepted'].includes(data.state))return {state:'declined',target:owner};
  if(action==='propose'&&isRecipient&&data.state==='pending')return {state:'proposed',proposal:normalizedProposal(payload,event),target:owner};
  if(action==='acceptProposal'&&isOwner&&data.state==='proposed')return {state:'accepted',proposal:data.proposal,target:recipient};
  if(action==='rejectProposal'&&isOwner&&data.state==='proposed')return {state:'pending',target:recipient};
  if(action==='cancel'&&isOwner&&['pending','proposed','accepted'].includes(data.state))return {state:'cancelled',target:recipient};
  failure('Приглашение уже изменилось или это действие недоступно');
}
export function eventForAction(event,data,action,proposal){
  let next={...event};
  if(action==='acceptProposal'){
    const start=proposal.allDay?new Date(proposal.startDate+'T00:00:00'):new Date(proposal.start),end=proposal.allDay?new Date(proposal.endDate+'T00:00:00'):new Date(proposal.end);
    next=withTiming(next,start,end,!!proposal.allDay);
  }
  if(action==='accept'||action==='acceptProposal'){next.space='shared';next.notes=(next.notes||'').replace(BOTH,'')+BOTH;}
  if(['decline','cancel'].includes(action)&&data.state==='accepted'){next.notes=(next.notes||'').replace(BOTH,'');next.space=data.originalSpace||'shared';}
  return next;
}
export function actionApplied(event,data,action,proposal){
  if(action==='accept')return participant(event);
  if(['decline','cancel'].includes(action))return data.state!=='accepted'||!participant(event);
  if(action==='acceptProposal'){
    const expected=eventForAction(event,data,action,proposal),actualMeta=eventMeta(event),expectedMeta=eventMeta(expected);
    return participant(event)&&(proposal.allDay?actualMeta.startDate===expectedMeta.startDate&&actualMeta.endDate===expectedMeta.endDate:new Date(event.startsAt).getTime()===new Date(expected.startsAt).getTime()&&eventEnd(event).getTime()===eventEnd(expected).getTime());
  }
  return true;
}
export function freeSlots(rows,{date,days=1,duration=60,from='09:00',to='22:00'}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(from)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(to)||from>=to)throw new Error('Проверьте дату и границы времени');
  days=Number(days);duration=Number(duration);if(!Number.isInteger(days)||days<1||days>7||!Number.isInteger(duration)||duration<15||duration>720)throw new Error('Выберите 1–7 дней и длительность от 15 до 720 минут');
  const busy=rows.filter(row=>!row.deleted&&!isInviteRow(row)&&row.notes!=='__todo__'&&!(row.notes||'').startsWith('[[deadline]]')).map(row=>{
    const event={startsAt:row.starts_at||row.startsAt,durationMinutes:row.duration_minutes||row.durationMinutes,notes:row.notes},meta=eventMeta(event);
    return meta.allDay?[new Date(meta.startDate+'T00:00:00+03:00').getTime(),new Date(meta.endDate+'T00:00:00+03:00').getTime()]:[new Date(event.startsAt).getTime(),eventEnd(event).getTime()];
  });
  const slots=[];
  for(let offset=0;offset<days;offset++){
    const key=plusDays(date,offset),start=new Date(key+'T'+from+':00+03:00').getTime(),end=new Date(key+'T'+to+':00+03:00').getTime(),intervals=busy.filter(([a,b])=>a<end&&b>start).sort((a,b)=>a[0]-b[0]);let cursor=Math.max(start,Math.ceil(Date.now()/900000)*900000);
    for(const [a,b]of [...intervals,[end,end]]){if(a-cursor>=duration*60000&&slots.length<24)slots.push({start:new Date(cursor).toISOString(),end:new Date(cursor+duration*60000).toISOString(),freeUntil:new Date(Math.min(a,end)).toISOString()});cursor=Math.max(cursor,b);}
  }
  return slots;
}
