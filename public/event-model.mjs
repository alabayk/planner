const META=/\n?\[\[event:([^\]]+)\]\]/g;
const SERIES=/\n?\[\[series:([^:\]]+):([^\]]+)\]\]/g;
export const dateKey=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
export function plusDays(value,days){const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+days);return dateKey(d);}
export function eventMeta(event){try{const match=[...(event.notes||'').matchAll(META)].at(-1),meta=match?JSON.parse(decodeURIComponent(match[1])):{};if(meta.allDay&&(!/^\d{4}-\d{2}-\d{2}$/.test(meta.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(meta.endDate)||meta.endDate<=meta.startDate))return {};if(meta.end&&!Number.isFinite(new Date(meta.end).getTime()))return {};return meta;}catch{return {};}}
export function stripEventMeta(notes){return (notes||'').replace(META,'');}
export const isAllDay=event=>!!eventMeta(event).allDay;
export function eventEnd(event){const meta=eventMeta(event);return meta.allDay?new Date(meta.endDate+'T00:00:00'):meta.end?new Date(meta.end):new Date(new Date(event.startsAt).getTime()+event.durationMinutes*60000);}
export function occursOn(event,date){
  const day=dateKey(date),meta=eventMeta(event);
  if(meta.allDay)return day>=meta.startDate&&day<meta.endDate;
  const start=new Date(day+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+1);
  return new Date(event.startsAt)<end&&eventEnd(event)>start;
}
export function withTiming(event,start,end,allDay=false){
  const from=new Date(start),to=new Date(end),minutes=Math.round((to-from)/60000);
  if(!Number.isFinite(minutes)||minutes<5)throw new Error('Конец должен быть минимум на 5 минут позже начала');
  let notes=stripEventMeta(event.notes),meta={};
  if(allDay)meta={allDay:true,startDate:dateKey(from),endDate:dateKey(to)};
  else if(minutes>1440)meta={end:to.toISOString()};
  if(Object.keys(meta).length)notes+='\n[[event:'+encodeURIComponent(JSON.stringify(meta))+']]';
  if(notes.length>600)throw new Error('Сократите описание: вместе с настройками события оно не должно превышать 600 символов');
  return {...event,startsAt:from.toISOString(),durationMinutes:Math.min(1440,minutes),notes};
}
export function timeLabel(event){
  const meta=eventMeta(event),start=new Date(event.startsAt),end=eventEnd(event),time=d=>d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}),date=d=>d.toLocaleDateString('ru',{day:'numeric',month:'short'});
  if(meta.allDay)return plusDays(meta.endDate,-1)===meta.startDate?'Весь день':`${date(new Date(meta.startDate+'T12:00:00'))} — ${date(new Date(plusDays(meta.endDate,-1)+'T12:00:00'))} · весь день`;
  return dateKey(start)===dateKey(end)?`${time(start)}–${time(end)}`:`${date(start)} ${time(start)} — ${date(end)} ${time(end)}`;
}
export function clipToDay(event,date,startHour=6){
  const start=new Date(dateKey(date)+'T00:00:00');start.setHours(startHour);const end=new Date(dateKey(date)+'T00:00:00');end.setDate(end.getDate()+1);
  return {start:Math.max(0,(new Date(event.startsAt)-start)/60000),end:Math.min((end-start)/60000,(eventEnd(event)-start)/60000)};
}
export function seriesInfo(event){try{const match=[...(event.notes||'').matchAll(SERIES)].at(-1);if(!match)return null;let rule;try{rule=JSON.parse(decodeURIComponent(match[2]));}catch{rule={kind:match[2]};}return {id:match[1],rule};}catch{return null;}}
export const stripSeries=notes=>(notes||'').replace(SERIES,'');
export const seriesTag=(id,rule)=>'\n[[series:'+id+':'+encodeURIComponent(JSON.stringify(rule))+']]';

// Explicit end dates keep a finite, reviewable set of offline-ready occurrences.
export function occurrences(start,rule){
  const first=new Date(start),until=new Date((rule.until||dateKey(first))+'T23:59:59'),kind=rule.kind;
  if(!Number.isFinite(until.getTime())||until<first)throw new Error('Дата окончания повторов должна быть не раньше начала');
  if(until.getFullYear()-first.getFullYear()>5)throw new Error('Выберите период повторения не длиннее 5 лет');
  const every=Number(rule.every||1);if(!Number.isInteger(every)||every<1||every>99)throw new Error('Интервал повторения: от 1 до 99');
  const weekdays=rule.days?.map(Number)||[first.getDay()],out=[];
  if(kind==='customWeekly'&&!weekdays.length)throw new Error('Выберите хотя бы один день недели');
  const firstDay=new Date(first);firstDay.setHours(12,0,0,0);
  const monday=new Date(firstDay);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  for(let day=new Date(firstDay);day<=until;day.setDate(day.getDate()+1)){
    const dayNumber=Math.round((Date.UTC(day.getFullYear(),day.getMonth(),day.getDate())-Date.UTC(first.getFullYear(),first.getMonth(),first.getDate()))/86400000);
    const monthNumber=(day.getFullYear()-first.getFullYear())*12+day.getMonth()-first.getMonth();
    const week=Math.floor((Date.UTC(day.getFullYear(),day.getMonth(),day.getDate())-Date.UTC(monday.getFullYear(),monday.getMonth(),monday.getDate()))/604800000);
    const last=new Date(day.getFullYear(),day.getMonth()+1,0).getDate();let match=false;
    if(kind==='daily')match=dayNumber%every===0;
    else if(kind==='weekdays')match=day.getDay()>0&&day.getDay()<6&&week%every===0;
    else if(kind==='weekly'||kind==='biweekly')match=day.getDay()===first.getDay()&&week%(kind==='biweekly'?2:every)===0;
    else if(kind==='customWeekly')match=week%every===0&&weekdays.includes(day.getDay());
    else if(kind==='monthly'){
      const mode=rule.monthMode||'date';match=monthNumber%every===0&&(mode==='lastDay'?day.getDate()===last:mode==='lastWeekday'?day.getDay()===first.getDay()&&day.getDate()+7>last:mode==='nthWeekday'?day.getDay()===first.getDay()&&Math.floor((day.getDate()-1)/7)===Math.floor((first.getDate()-1)/7):day.getDate()===first.getDate());
    }else if(kind==='yearly')match=(day.getFullYear()-first.getFullYear())%every===0&&day.getMonth()===first.getMonth()&&day.getDate()===first.getDate();
    else throw new Error('Неизвестное правило повторения');
    if(match){const occurrence=new Date(day);occurrence.setHours(first.getHours(),first.getMinutes(),first.getSeconds(),0);if(occurrence>=first)out.push(occurrence);}
    if(out.length>500)throw new Error('Получается больше 500 событий. Сократите период или увеличьте интервал');
  }
  if(!out.length)throw new Error('В выбранном диапазоне нет подходящих дат');return out;
}
