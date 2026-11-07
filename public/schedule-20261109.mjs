import {queueWeeklySchedule as queuePreviousSchedule} from './schedule-20261026.mjs';
export const SCHEDULE_WEEK='9–14 ноября',SCHEDULE_VERSION='20261109-v1';
const entries=[
  [
    "09",
    "09:00",
    "Иностранный язык (китайский)",
    "Практическое занятие"
  ],
  [
    "09",
    "10:30",
    "Иностранный язык (китайский)",
    "Практическое занятие"
  ],
  [
    "09",
    "12:30",
    "Экономика и внешнеэкономические связи Китая",
    "Лекция · Ауд. 1.401"
  ],
  [
    "09",
    "14:00",
    "Экономика и внешнеэкономические связи Китая",
    "Лекция · Ауд. 1.401"
  ],
  [
    "11",
    "09:00",
    "Микроэкономика 1",
    "Лекция · Ауд. 1.401"
  ],
  [
    "11",
    "10:30",
    "Иностранный язык (китайский)",
    "Практическое занятие"
  ],
  [
    "11",
    "12:00",
    "Элективные курсы по физической культуре и спорту",
    "Практическое занятие"
  ],
  [
    "11",
    "14:00",
    "Линейная алгебра",
    "Лекция · Ауд. 1.401"
  ],
  [
    "11",
    "15:30",
    "Линейная алгебра",
    "Семинар · Ауд. 1.305"
  ],
  [
    "12",
    "10:30",
    "Микроэкономика 1",
    "Семинар · Ауд. 1.305"
  ],
  [
    "12",
    "12:30",
    "Микроэкономика 1",
    "Семинар · Ауд. 1.305"
  ],
  [
    "12",
    "14:00",
    "История России",
    "Лекция · Ауд. 1.401"
  ],
  [
    "12",
    "15:30",
    "История России",
    "Лекция · Ауд. 1.401"
  ],
  [
    "13",
    "10:00",
    "Иностранный язык (китайский)",
    "Практическое занятие"
  ],
  [
    "13",
    "11:30",
    "Иностранный язык (китайский)",
    "Практическое занятие"
  ],
  [
    "14",
    "12:30",
    "Физическая культура и спорт",
    "Практическое занятие"
  ]
];
export const WEEKLY_SCHEDULE=entries.map(([day,time,title,notes],index)=>({id:`b26e1109-2026-4000-8000-${String(index+1).padStart(12,'0')}`,title,notes,startsAt:new Date(`2026-11-${day}T${time}:00+03:00`).toISOString(),durationMinutes:80,space:'shared',createdBy:'ksusha',done:false,deleted:false,version:0}));
export async function queueWeeklySchedule({profile,all,saveMany,storage=localStorage}){
  await queuePreviousSchedule({profile,all,saveMany,storage});
  const marker=`schedule-queued:${SCHEDULE_VERSION}:${profile}`;
  if(storage.getItem(marker)==='1')return;
  const existing=new Set([...(await all('events')),...(await all('outbox'))].map(row=>row.id));
  const missing=WEEKLY_SCHEDULE.filter(row=>!existing.has(row.id));
  if(missing.length)await saveMany(missing,{flush:false});
  storage.setItem(marker,'1');
}
export function scheduleConfirmed(ids){const present=new Set(ids);return WEEKLY_SCHEDULE.every(row=>present.has(row.id));}
