import {eventEnd,eventMeta,withTiming,stripEventMeta,plusDays} from '../public/event-model.mjs';
const SERIES=/\n?\[\[series:[^\]]+\]\]/g;
export function googleBody(row){
  const event={startsAt:row.starts_at,durationMinutes:Number(row.duration_minutes),notes:row.notes||''},meta=eventMeta(event);
  const dates=meta.allDay?{start:{date:meta.startDate},end:{date:meta.endDate}}:{start:{dateTime:new Date(row.starts_at).toISOString()},end:{dateTime:eventEnd(event).toISOString()}};
  return {summary:row.title,description:stripEventMeta(row.notes).replace('\n[[planner:both]]','').replace(SERIES,'').trim(),...dates,extendedProperties:{private:{plannerId:row.id}}};
}
export function plannerFields(event,previous=null){
  if(event.recurrence)throw new Error('Повторяющееся событие должно быть развёрнуто в отдельные даты');
  const allDay=!!event.start?.date;
  const start=allDay?new Date(event.start.date+'T00:00:00'):new Date(event.start?.dateTime);
  const end=allDay?new Date((event.end?.date||plusDays(event.start.date,1))+'T00:00:00'):new Date(event.end?.dateTime);
  const title=event.summary||'Без названия';
  if(title.length>120)throw new Error('Название длиннее 120 символов');
  const inherited=(previous?.notes||'').match(SERIES)?.join('')||'';
  const both=(previous?.notes||'').includes('[[planner:both]]')?'\n[[planner:both]]':'';
  const result=withTiming({notes:(event.description||'')+both+inherited},start,end,allDay);
  return {title,notes:result.notes,starts_at:result.startsAt,duration_minutes:result.durationMinutes};
}
