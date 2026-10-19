import {dateKey} from './event-model.mjs';
const weekdays=['воскресень','понедельник','вторник','сред','четверг','пятниц','суббот'];
const months=['январ','феврал','март','апрел','мая','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const dayPattern='понедельник(?:ам)?|вторник(?:ам)?|сред(?:а|у|ам)|четверг(?:ам)?|пятниц(?:а|у|ам)|суббот(?:а|у|ам)|воскресень(?:е|ям)';
function validDate(year,month,day){const date=new Date(year,month-1,day,12);if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)throw new Error('Такой даты нет. Проверьте число и месяц.');return date;}
function clock(hour,minute=0){hour=Number(hour);minute=Number(minute||0);if(hour>23||minute>59)throw new Error('Время должно быть от 00:00 до 23:59.');return [hour,minute];}
// Deliberately local and deterministic: unsupported phrases remain visible for review.
export function parseQuickEvent(input,now=new Date()){
  const original=String(input||'').trim();if(!original)throw new Error('Введите название, дату и время события.');
  const warnings=[],urls=original.match(/https?:\/\/[^\s<>]+/gi)||[];
  let rest=original.replace(/https?:\/\/[^\s<>]+/gi,' ').replace(/ё/gi,'е'),date=null,time=null,endClock=null,duration=60,allDay=false,rule='none';
  const take=(pattern,apply)=>{const match=rest.match(pattern);if(!match)return false;apply(match);rest=rest.slice(0,match.index)+' '+rest.slice(match.index+match[0].length);return true;};
  const today=new Date(now);today.setHours(12,0,0,0);
  take(/(?:^|\s)(?:весь день|на весь день)(?=$|\s|[,;])/i,()=>allDay=true);
  take(/(?:^|\s)(?:каждый день|ежедневно)(?=$|\s|[,;])/i,()=>rule='daily');
  take(/(?:^|\s)(?:по будням|каждый будний день)(?=$|\s|[,;])/i,()=>rule='weekdays');
  const repeatWeek=new RegExp('(?:^|\\s)(?:кажд(?:ый|ую|ое)|по)\\s+('+dayPattern+')(?=$|\\s|[,;])','i');
  take(repeatWeek,m=>{const target=weekdays.findIndex(stem=>m[1].toLowerCase().startsWith(stem));date=new Date(today);date.setDate(date.getDate()+(target-date.getDay()+7)%7);rule='weekly';});
  take(/(?:^|\s)(?:каждую неделю|еженедельно)(?=$|\s|[,;])/i,()=>rule='weekly');
  take(/(?:^|\s)(?:каждый месяц|ежемесячно)(?=$|\s|[,;])/i,()=>rule='monthly');
  let explicitDate=false;
  take(/(?:^|\s)(?:в\s+)?(\d{4})-(\d{2})-(\d{2})(?=$|\s|[,;])/i,m=>{date=validDate(+m[1],+m[2],+m[3]);explicitDate=true;});
  if(!explicitDate)take(/(?:^|\s)(?:в\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?=$|\s|[,;])/i,m=>{date=validDate(m[3]?+m[3]:today.getFullYear(),+m[2],+m[1]);if(!m[3]&&date<today)date=validDate(today.getFullYear()+1,+m[2],+m[1]);explicitDate=true;});
  if(!explicitDate)take(new RegExp('(?:^|\\s)(?:в\\s+)?(\\d{1,2})\\s+('+months.map(m=>m+'[а-я]*').join('|')+')(?:\\s+(\\d{4})(?:\\s+года)?)?(?=$|\\s|[,;])','i'),m=>{const month=months.findIndex(stem=>m[2].toLowerCase().startsWith(stem))+1;date=validDate(m[3]?+m[3]:today.getFullYear(),month,+m[1]);if(!m[3]&&date<today)date=validDate(today.getFullYear()+1,month,+m[1]);explicitDate=true;});
  take(/(?:^|\s)(послезавтра|завтра|сегодня)(?=$|\s|[,;])/i,m=>{if(explicitDate){warnings.push('Указано несколько дат — проверьте начало.');return;}date=new Date(today);date.setDate(date.getDate()+({сегодня:0,завтра:1,послезавтра:2}[m[1].toLowerCase()]));});
  take(new RegExp('(?:^|\\s)(?:в|во)\\s+('+dayPattern+')(?=$|\\s|[,;])','i'),m=>{if(explicitDate){warnings.push('Проверьте соответствие даты дню недели.');return;}const target=weekdays.findIndex(stem=>m[1].toLowerCase().startsWith(stem));date=new Date(today);date.setDate(date.getDate()+(target-date.getDay()+7)%7);});
  take(/(?:^|\s)(?:с\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:до|[–—-])\s*(\d{1,2})(?::(\d{2}))?(?=$|\s|[,;])/i,m=>{time=clock(m[1],m[2]);endClock=clock(m[3],m[4]);});
  if(!time)take(/(?:^|\s)в\s+(\d{1,2})(?::(\d{2}))?(?=$|\s|[,;])/i,m=>time=clock(m[1],m[2]));
  if(!time)take(/(?:^|\s)(\d{1,2}):(\d{2})(?=$|\s|[,;])/i,m=>time=clock(m[1],m[2]));
  const durationPattern=/(?:^|\s)на\s+(?:(полтора|полчаса|час)(?:\s+часа)?|((?:\d+)(?:[.,]\d+)?)\s*(час(?:а|ов)?|ч(?:\.)?|минут(?:у|ы)?|мин(?:\.)?))(?=$|\s|[,;])/i;
  take(durationPattern,m=>{const value=m[1]?.toLowerCase();duration=value==='полтора'?90:value==='полчаса'?30:value==='час'?60:Number(m[2].replace(',','.'))*(/^ч/i.test(m[3])?60:1);if(duration<5||duration>10080||!Number.isInteger(duration))throw new Error('Выберите длительность от 5 минут до 7 дней.');if(endClock)warnings.push('Указаны конец и длительность — использовано время конца.');});
  if(!date){date=new Date(today);warnings.push('Дата не указана — выбрано сегодня.');}
  let start=null,end=null;
  if(allDay){if(time)warnings.push('Для события на весь день время не применяется.');start=new Date(date);start.setHours(0,0,0,0);end=new Date(start);end.setDate(end.getDate()+1);}
  else if(time){start=new Date(date);start.setHours(...time,0,0);end=new Date(start.getTime()+duration*60000);if(endClock){end=new Date(date);end.setHours(...endClock,0,0);if(end<=start){end.setDate(end.getDate()+1);warnings.push('Конец раньше начала — выбран следующий день.');}}}
  else warnings.push(`Время не распознано — выберите дату ${dateKey(date)} и время в редакторе.`);
  if(start&&start<now)warnings.push('Начало уже в прошлом — проверьте дату и время.');
  if(rule!=='none')warnings.push('Повтор заполнен. Проверьте дату окончания серии в редакторе.');
  if(/кажд|еженед|ежемес|\b\d{1,2}:\d{2}\b/i.test(rest))warnings.push('Часть условий не распознана — проверьте оставшийся текст.');
  let title=rest.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g,'').replace(/\s+/g,' ');
  if(!title){title='';warnings.push('Добавьте название события.');}
  if(title.length>120){title=title.slice(0,120);warnings.push('Название сокращено до 120 символов.');}
  const notes=original.replace(/\[\[/g,'［［').slice(0,600);if(original.length>600)warnings.push('Исходный текст в описании сокращён до 600 символов.');
  return {title,date:dateKey(date),start,end,allDay,rule,notes,urls,warnings};
}
