export const SCHEDULE_WEEK='26–31 октября',SCHEDULE_VERSION='20261026-v1';
const entries=[
 ['26','09:00','Иностранный язык (китайский)','Практическое занятие'],
 ['26','10:30','Иностранный язык (китайский)','Практическое занятие'],
 ['26','12:30','Линейная алгебра','Лекция · Ауд. 1.401'],
 ['28','09:00','Микроэкономика 1','Лекция · Ауд. 1.401'],
 ['28','10:30','Иностранный язык (китайский)','Практическое занятие'],
 ['28','12:00','Физическая культура и спорт','Практическое занятие'],
 ['28','14:00','Математический анализ','Лекция · Ауд. 1.401'],
 ['28','15:30','Развитие цифровой экономики (национальный и международный опыт)','Семинар · Ауд. 1.304'],
 ['29','09:00','Микроэкономика 1','Семинар · Ауд. 1.504'],
 ['29','10:30','Микроэкономика 1','Семинар · Ауд. 1.504'],
 ['29','12:30','История России','Семинар · Ауд. 1.504'],
 ['29','14:00','История России','Семинар · Ауд. 1.504'],
 ['29','15:30','Развитие цифровой экономики (национальный и международный опыт)','Зачёт · Ауд. 1.301'],
 ['30','10:00','Иностранный язык (китайский)','Практическое занятие'],
 ['30','11:30','Иностранный язык (китайский)','Практическое занятие'],
 ['31','09:30','Линейная алгебра','Семинар · Ауд. 1.302'],
 ['31','11:00','Право','Семинар · Ауд. 1.302'],
 ['31','12:30','Физическая культура и спорт','Практическое занятие']
];
export const WEEKLY_SCHEDULE=entries.map(([day,time,title,notes],index)=>({id:`b26e1026-2026-4000-8000-${String(index+1).padStart(12,'0')}`,title,notes,startsAt:new Date(`2026-10-${day}T${time}:00+03:00`).toISOString(),durationMinutes:80,space:'shared',createdBy:'ksusha',done:false,deleted:false,version:0}));
export async function queueWeeklySchedule({profile,all,saveMany,storage=localStorage}){
  const marker=`schedule-queued:${SCHEDULE_VERSION}:${profile}`;
  if(storage.getItem(marker)==='1')return;
  const existing=new Set([...(await all('events')),...(await all('outbox'))].map(row=>row.id));
  const missing=WEEKLY_SCHEDULE.filter(row=>!existing.has(row.id));
  if(missing.length)await saveMany(missing,{flush:false});
  storage.setItem(marker,'1');
}
export function scheduleConfirmed(ids){const present=new Set(ids);return WEEKLY_SCHEDULE.every(row=>present.has(row.id));}
