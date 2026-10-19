import {eventEnd,occursOn} from './event-model.mjs';
const both=event=>event.space==='shared'&&(event.notes||'').includes('[[planner:both]]');
export function upcomingSummary(rows,user,now=new Date()){
  if(!user)return {next:null,today:[],upcoming:[],tasks:[],deadlines:[],overdue:0};
  const visible=rows.filter(row=>!row.deleted&&!row.done&&(row.space===user||row.space==='shared')&&!(row.notes||'').startsWith('[[invitation]]'));
  const tasks=visible.filter(row=>row.notes==='__todo__'&&row.createdBy===user).sort((a,b)=>new Date(b.startsAt)-new Date(a.startsAt));
  const deadlines=visible.filter(row=>(row.notes||'').startsWith('[[deadline]]')).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
  const merged=new Map();
  for(const row of visible){
    if(row.notes==='__todo__'||(row.notes||'').startsWith('[[deadline]]')||!(row.createdBy===user||both(row)))continue;
    const end=eventEnd(row);if(!Number.isFinite(end.getTime())||end<=now)continue;
    const key=JSON.stringify([row.title,new Date(row.startsAt).getTime(),end.getTime()]),old=merged.get(key);if(!old||both(row))merged.set(key,row);
  }
  const upcoming=[...merged.values()].sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
  return {next:upcoming[0]||null,today:upcoming.filter(row=>occursOn(row,now)),upcoming,tasks,deadlines,overdue:deadlines.filter(row=>new Date(row.startsAt)<now).length};
}
const plural=(value,one,few,many)=>value%10===1&&value%100!==11?one:value%10>=2&&value%10<=4&&(value%100<12||value%100>14)?few:many;
export function startsIn(event,now=new Date()){
  if(new Date(event.startsAt)<=now&&eventEnd(event)>now)return 'Сейчас';
  const minutes=Math.max(1,Math.ceil((new Date(event.startsAt)-now)/60000));
  if(minutes<60)return `Через ${minutes} ${plural(minutes,'минуту','минуты','минут')}`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours<24)return `Через ${hours} ${plural(hours,'час','часа','часов')}${rest?' '+rest+' мин':''}`;
  const days=Math.floor(hours/24);return `Через ${days} ${plural(days,'день','дня','дней')}`;
}
