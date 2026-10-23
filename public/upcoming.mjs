import {upcomingSummary,startsIn} from './upcoming-model.mjs';
import {timeLabel} from './event-model.mjs';
const $=selector=>document.querySelector(selector);
const node=(tag,text,cls)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(cls)element.className=cls;return element;};
export function installUpcoming({state,openEditor,openDeadline,save,closeMenu,refresh}){
  const menu=node('button',undefined,'menuItem');menu.type='button';menu.id='openUpcoming';menu.append(node('span','Ближайшее'),node('i','›'));$('#openProfile').before(menu);
  const modal=node('dialog');modal.id='upcomingDialog';modal.setAttribute('aria-labelledby','upcomingTitle');document.body.append(modal);
  let deepLink=new URLSearchParams(location.search).get('view')==='upcoming';
  const openEvent=event=>{modal.close();openEditor(event);};
  const openDue=event=>{modal.close();openDeadline(event);};
  function show(){closeMenu();draw();if(!modal.open)modal.showModal();}
  menu.onclick=show;
  function eventButton(event){const button=node('button',undefined,'upcomingEvent');button.type='button';button.append(node('small',startsIn(event)),node('strong',event.title),node('span',timeLabel(event)));button.onclick=()=>openEvent(event);return button;}
  function draw(){
    const data=upcomingSummary(state.events,state.user),box=node('section',undefined,'upcomingSheet');
    const head=node('div',undefined,'sheet'),title=node('h2','Ближайшее');title.id='upcomingTitle';const close=node('button','×','close');close.type='button';close.setAttribute('aria-label','Закрыть');close.onclick=()=>modal.close();head.append(title,close);box.append(head);
    box.append(node('p',new Date().toLocaleDateString('ru',{weekday:'long',day:'numeric',month:'long'}),'upcomingDate'));
    if(!navigator.onLine||!$('#offline').hidden)box.append(node('p','Нет свежего подключения · показаны сохранённые данные','upcomingOffline'));
    const next=node('section',undefined,'upcomingNext');next.append(node('h3','Следующее событие'));next.append(data.next?eventButton(data.next):node('p','Предстоящих событий пока нет'));box.append(next);
    const stats=node('div',undefined,'upcomingStats');stats.append(node('span',`Событий сегодня: ${data.today.length}`),node('span',`Дел: ${data.tasks.length}`),node('span',`Просрочено: ${data.overdue}`));box.append(stats);
    const events=node('section');events.append(node('h3','Далее'));for(const event of data.upcoming.slice(1,4))events.append(eventButton(event));if(data.upcoming.length<2)events.append(node('p','Других ближайших событий нет','upcomingEmpty'));box.append(events);
    const tasks=node('section');tasks.append(node('h3','Мои дела'));
    for(const task of data.tasks.slice(0,6)){
      const row=node('div',undefined,'upcomingTask'),check=node('button','✓'),text=node('span',task.title),error=node('small','');check.type='button';check.setAttribute('aria-label','Выполнить: '+task.title);
      check.onclick=async()=>{check.disabled=true;try{await save({...task,done:true});if(modal.open)draw();}catch{error.textContent='Не удалось сохранить. Повторите.';check.disabled=false;}};row.append(check,text,error);tasks.append(row);
    }
    if(!data.tasks.length)tasks.append(node('p','Нет незавершённых дел','upcomingEmpty'));if(data.tasks.length>6)tasks.append(node('small',`Ещё ${data.tasks.length-6} — в разделе «Дела»`));box.append(tasks);
    const due=node('section');due.append(node('h3','Дедлайны'));
    for(const deadline of data.deadlines.slice(0,5)){const button=node('button',undefined,'upcomingDue');button.type='button';const expired=new Date(deadline.startsAt)<new Date();button.classList.toggle('overdue',expired);button.append(node('strong',deadline.title),node('span',(expired?'Срок истёк · ':'')+new Date(deadline.startsAt).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})));button.onclick=()=>openDue(deadline);due.append(button);}
    if(!data.deadlines.length)due.append(node('p','Нет активных дедлайнов','upcomingEmpty'));box.append(due);
    const updated=localStorage.getItem(`last-sync-${state.user}`);box.append(node('p',updated?'Данные обновлены: '+new Date(updated).toLocaleString('ru'):'Данные ещё не обновлялись','upcomingFreshness'));
    const reload=node('button','Обновить данные','upcomingRefresh');reload.type='button';reload.onclick=async()=>{reload.disabled=true;try{await refresh();}finally{if(modal.open)draw();}};box.append(reload);
    box.append(node('p','Компактный экран Планера. Это не системный виджет iPhone.','upcomingHelp'));modal.replaceChildren(box);
  }
  function update(){
    const old=$('#upcomingPeek');if(!state.user){old?.remove();if(modal.open)modal.close();return;}
    if(modal.open)draw();
    const calendar=!state.tasks&&!state.all&&!state.month;
    if(calendar){const data=upcomingSummary(state.events,state.user),peek=node('button',undefined,'upcomingPeek');peek.id='upcomingPeek';peek.type='button';peek.append(node('small',data.next?startsIn(data.next):'Ближайшее'),node('strong',data.next?.title||'События, дела и дедлайны'),node('span',`${data.tasks.length} дел · ${data.today.length} событий сегодня  ›`));peek.onclick=show;old?.remove();$('#spaces').prepend(peek);}else old?.remove();
    if(deepLink){deepLink=false;show();}
  }
  setInterval(()=>{if(!document.hidden&&state.user)update();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  return {update};
}
