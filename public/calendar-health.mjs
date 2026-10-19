import {apiJson} from './api.mjs';
let running=null;
export async function refreshCalendarConnection({client,url,sync}){
  if(running)return running;
  running=check({client,url,sync});try{return await running;}finally{running=null;}
}
async function check({client,url,sync}){
  const button=document.getElementById('connectCalendar'),label=button.querySelector('span');
  const {data:{session}}=await client.auth.getSession();if(!session)return;
  let warning=document.getElementById('calendarWarning');
  if(!warning){warning=document.createElement('section');warning.id='calendarWarning';warning.className='calendarWarning';document.getElementById('offline').after(warning);}
  try{
    const headers={Authorization:`Bearer ${session.access_token}`};
    const result=await apiJson(url+'/google/status',{headers,timeout:15000});button.disabled=!!result.connected&&!result.requiresReconnect;
    button.classList.toggle('connected',button.disabled);
    label.textContent=result.requiresReconnect?'Переподключить Google Calendar':result.connected?'Google Calendar подключён':'Подключить Google Calendar';
    button.querySelector('i').textContent=button.disabled?'✓':'→';
    warning.replaceChildren();warning.hidden=!(result.requiresReconnect||result.conflicts?.length||result.checkError);
    if(warning.hidden)return;
    const text=document.createElement('p');
    text.textContent=result.requiresReconnect?'Доступ к Google Calendar истёк. Переподключите календарь, чтобы возобновить синхронизацию.':result.checkError?'Google Calendar временно недоступен. Подключение сохранено; проверим повторно.':'Есть изменения Google Calendar, для которых нужно выбрать версию.';
    warning.append(text);
    if(result.requiresReconnect){const reconnect=document.createElement('button');reconnect.textContent='Переподключить Google';reconnect.onclick=()=>button.click();warning.append(reconnect);}
    for(const conflict of result.conflicts||[]){
      const box=document.createElement('details'),summary=document.createElement('summary');summary.textContent=conflict.title||'Конфликт события';box.append(summary);
      const compare=document.createElement('p');
      const describe=row=>row.deleted?'Удалено':`${row.title||'Событие'} · ${new Date(row.starts_at).toLocaleString('ru')} · ${row.duration_minutes} мин.\n${row.notes||''}`;
      compare.textContent=`Планер: ${describe(conflict.local)}\nGoogle: ${describe(conflict.remote)}`;box.append(compare);
      for(const [choice,title]of [['planner','Оставить из планера'],['google','Принять из Google']]){
        const pick=document.createElement('button');pick.textContent=title;
        pick.onclick=async()=>{pick.disabled=true;try{
          const {data:{session:current}}=await client.auth.getSession();
          await apiJson(url+'/google/resolve',{method:'POST',headers:{Authorization:`Bearer ${current.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({id:conflict.id,choice})});
          await refreshCalendarConnection({client,url,sync});await sync();
        }catch(error){compare.textContent=error.message;}finally{pick.disabled=false;}};box.append(pick);
      }
      warning.append(box);
    }
  }catch{warning.hidden=false;warning.textContent='Не удалось проверить подключение Google Calendar. Повторим проверку при восстановлении связи.';}
}
