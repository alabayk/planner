import {apiJson,publicError} from './api.mjs';
import {eventMeta,eventEnd,timeLabel,dateKey,plusDays} from './event-model.mjs';
const $=selector=>document.querySelector(selector),localInput=value=>{const d=new Date(value);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const statusText=(item)=>item.working?'Ответ сохраняется…':({pending:item.incoming?'Ждёт вашего ответа':'Ждёт ответа',accepted:item.incoming?'Вы участвуете':'Участие подтверждено',declined:item.incoming?'Вы отклонили':'Приглашение отклонено',proposed:item.incoming?'Ваше предложение времени':'Предложено другое время',cancelled:'Приглашение отменено'}[item.state]||'');
export function installCollaboration({state,client,url,render,openEditor,closeEditor,sync,flush,all,applySnapshots}){
  let items=[],loadedFor='',running=null,lastError='',activeEvent=null,pendingCount=null,lastListAt=0,lastStatusAt=0;
  const nav=document.createElement('button');nav.dataset.view='invites';nav.innerHTML='<i>✉</i><span>Вместе</span><b id="inviteBadge" hidden></b>';document.querySelector('footer').append(nav);
  const hint=document.createElement('p');hint.id='eventParticipation';hint.className='eventParticipation';$('#copy').before(hint);
  const modal=document.createElement('dialog');modal.id='proposalDialog';modal.innerHTML='<form><h2>Предложить другое время</h2><label>Начало<input name="start" type="datetime-local" required></label><label>Конец<input name="end" type="datetime-local" required></label><p role="alert" hidden></p><div class="actions"><button type="button" class="proposalCancel">Отмена</button><button type="submit" class="primary">Предложить</button></div></form>';document.body.append(modal);
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  async function request(path,body){const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('Нужно войти в планер заново');return apiJson(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  function badge(){const count=pendingCount??items.filter(item=>item.incoming&&item.state==='pending'||!item.incoming&&item.state==='proposed').length,b=$('#inviteBadge');b.hidden=!count;b.textContent=count>9?'9+':count;}
  async function refresh(force=false){
    if(!state.user||document.hidden&&!force)return;if(running){await running;if(!force)return;}
    const owner=state.user,detailed=force||state.invites||$('#editor').open;
    if(!force&&Date.now()-(detailed?lastListAt:lastStatusAt)<(detailed?60000:300000))return;
    if(detailed)lastListAt=Date.now();else lastStatusAt=Date.now();
    if(loadedFor!==owner){loadedFor=owner;try{items=JSON.parse(localStorage.getItem('planner-invites:'+owner)||'[]');}catch{items=[];}badge();}
    running=(async()=>{try{const result=await request(detailed?'/invites/list':'/invites/status');if(state.user!==owner)return;if(!detailed){pendingCount=result.pending;badge();return;}pendingCount=null;const changed=JSON.stringify(items)!==JSON.stringify(result.items||[])||!!lastError;items=result.items||[];await applySnapshots?.(items.map(item=>item.event));lastError='';localStorage.setItem('planner-invites:'+owner,JSON.stringify(items));badge();if(state.invites&&(changed||force))render();if(activeEvent)configureEvent(activeEvent);}catch(error){lastError=publicError(error);if(state.invites)render();}})();
    try{await running;}finally{running=null;}
  }
  function show(){state.invites=true;state.chat=state.tasks=state.all=state.month=false;document.querySelectorAll('footer [data-view]').forEach(button=>button.classList.toggle('active',button===nav));render();window.scrollTo({top:0,behavior:'smooth'});refresh(true);}
  nav.onclick=show;
  async function send(event){
    await flush();if((await all('outbox')).some(job=>job.id===event.id))throw new Error('Сначала сохраните событие и разрешите конфликт, если он есть');
    const latest=state.events.find(row=>row.id===event.id)||event;
    const result=await request('/invites/send',{eventId:event.id,eventVersion:latest.version});await refresh(true);closeEditor();show();
    if(!result.queued){lastError='Приглашение сохранено. Уведомление будет отправлено повторно автоматически.';render();}
  }
  function configureEvent(event){
    activeEvent=event||null;const button=$('#copy');hint.textContent='';hint.hidden=false;
    if(!event){hint.textContent='Чтобы пригласить участника, сохраните событие и откройте его снова.';return;}
    const invitation=items.find(item=>item.event.id===event.id),joined=event.space==='shared'&&(event.notes||'').includes('[[planner:both]]');
    hint.textContent=invitation?statusText(invitation):joined?'Событие добавлено обоим участникам':'Без подтверждённого участника';
    if(invitation&&['pending','proposed','accepted'].includes(invitation.state)){button.hidden=false;button.textContent=event.createdBy===state.user?'Управлять приглашением':'Ответить на приглашение';}
    else if(event.createdBy===state.user&&!joined){button.hidden=false;button.textContent='Пригласить на событие';}
  }
  const legacyCopy=$('#copy').onclick;
  $('#copy').onclick=async()=>{
    const event=state.editing;if(!event)return;const button=$('#copy');button.disabled=true;
    try{
      await refresh(true);const invitation=items.find(item=>item.event.id===event.id&&['pending','proposed','accepted'].includes(item.state));
      if(invitation){closeEditor();show();return;}
      if(event.createdBy===state.user&&!(event.notes||'').includes('[[planner:both]]')){await send(event);return;}
      await legacyCopy?.();
    }catch(error){hint.textContent=publicError(error);}finally{button.disabled=false;}
  };
  async function answer(item,action,proposal){
    const result=await request('/invites/respond',{id:item.id,rev:item.rev,eventVersion:item.event.version,action,...(proposal?{proposal}:{})});
    await refresh(true);await sync();if(state.invites)render();return result;
  }
  function propose(item){
    const form=modal.querySelector('form'),start=form.elements.start,end=form.elements.end,meta=eventMeta(item.event),error=form.querySelector('p');error.hidden=true;
    start.type=end.type=meta.allDay?'date':'datetime-local';start.value=meta.allDay?meta.startDate:localInput(item.event.startsAt);end.value=meta.allDay?plusDays(meta.endDate,-1):localInput(eventEnd(item.event));
    form.onsubmit=async event=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('.primary');button.disabled=true;try{const proposal=meta.allDay?{startDate:start.value,endDate:plusDays(end.value,1)}:{start:new Date(start.value).toISOString(),end:new Date(end.value).toISOString()};await answer(item,'propose',proposal);modal.close();}catch(failure){error.hidden=false;error.textContent=publicError(failure);}finally{button.disabled=false;}};
    modal.querySelector('.proposalCancel').onclick=()=>modal.close();modal.showModal();
  }
  function renderView(){
    $('#dateTitle').textContent='Вместе';$('#dateTitle').disabled=true;$('.weekbar').hidden=true;$('#days').hidden=true;$('#allDates').hidden=true;$('#add').hidden=true;
    const box=$('#spaces');box.replaceChildren();const panel=node('section',undefined,'collaborationView'),head=node('div',undefined,'collaborationHead');head.append(node('h2','Приглашения'));const refreshButton=node('button','Обновить');refreshButton.onclick=()=>refresh(true);head.append(refreshButton);panel.append(head);
    if(lastError)panel.append(node('p',lastError,'collaborationError'));
    const sorted=[...items].sort((a,b)=>(['pending','proposed'].includes(b.state)?1:0)-(['pending','proposed'].includes(a.state)?1:0)||new Date(a.event.startsAt)-new Date(b.event.startsAt));
    if(!sorted.length)panel.append(node('p','Приглашений пока нет. Откройте своё сохранённое событие и нажмите «Пригласить на событие».','empty'));
    for(const item of sorted){
      const card=node('article',undefined,'invitationCard');card.append(node('small',item.incoming?'Входящее':'Отправленное'),node('h3',item.event.title),node('p',timeLabel(item.event)),node('strong',statusText(item),'participationStatus'));
      if(item.proposal){const p=item.proposal;{const text=p.allDay?`${p.startDate} — ${plusDays(p.endDate,-1)} · весь день`:`${new Date(p.start).toLocaleString('ru')} — ${new Date(p.end).toLocaleString('ru')}`;card.append(node('p','Предложение: '+text));}}
      const actions=node('div',undefined,'invitationActions'),error=node('p','', 'collaborationError');
      const add=(title,action)=>{const button=node('button',title);button.type='button';button.disabled=item.working;button.onclick=async()=>{button.disabled=true;error.textContent='';try{await answer(item,action);}catch(failure){await refresh(true);lastError=publicError(failure);render();}finally{button.disabled=false;}};actions.append(button);};
      if(item.incoming&&item.state==='pending'){add('Принять','accept');add('Отклонить','decline');const alternative=node('button','Предложить время');alternative.disabled=item.working;alternative.onclick=()=>propose(item);actions.append(alternative);}
      if(item.incoming&&item.state==='accepted')add('Убрать у меня','decline');
      if(item.incoming&&item.state==='proposed')add('Отозвать участие','decline');
      if(!item.incoming&&item.state==='proposed'){add('Принять время','acceptProposal');add('Оставить прежнее время','rejectProposal');}
      if(!item.incoming&&['pending','accepted','proposed'].includes(item.state))add(item.state==='accepted'?'Убрать участника':'Отменить приглашение','cancel');
      const open=node('button','Открыть событие');open.onclick=()=>openEditor(item.event);actions.append(open);card.append(actions,error);panel.append(card);
    }
    box.append(panel);renderFree(box);badge();
  }
  function renderFree(box){
    const section=node('section',undefined,'freeTimePanel');section.innerHTML='<h2>Общее свободное время</h2><p>Учитываются занятость обоих участников и события на весь день. Названия личных событий не раскрываются.</p><form><label>С даты<input name="date" type="date" required></label><label>Проверить дней<select name="days"><option value="1">Один день</option><option value="7">Неделю</option></select></label><label>Длительность<select name="duration"><option value="30">30 минут</option><option value="60" selected>1 час</option><option value="90">1,5 часа</option><option value="120">2 часа</option></select></label><div class="freeBounds"><label>Не раньше<input name="from" type="time" value="09:00" required></label><label>Не позже<input name="to" type="time" value="22:00" required></label></div><button type="submit">Найти общее время</button></form><div class="freeResults" aria-live="polite"></div>';
    const form=section.querySelector('form'),results=section.querySelector('.freeResults');form.elements.date.value=dateKey(state.date);
    form.onsubmit=async event=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;results.textContent='Ищем…';try{
      const result=await request('/invites/free',Object.fromEntries(new FormData(form)));results.replaceChildren();
      if(!result.slots.length)results.textContent='Общих окон нужной длительности не найдено. Попробуйте другие даты или время.';
      for(const slot of result.slots){const pick=node('button',`${new Date(slot.start).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} — ${new Date(slot.end).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}`);pick.onclick=()=>{
        state.invites=false;state.date=new Date(slot.start);document.querySelectorAll('footer [data-view]').forEach(tab=>tab.classList.toggle('active',tab.dataset.view==='day'));render();openEditor(null);$('#startsAt').value=localInput(slot.start);$('#startsAt').dispatchEvent(new Event('input',{bubbles:true}));$('#endsAt').value=localInput(slot.end);$('#endsAt').dispatchEvent(new Event('input',{bubbles:true}));
      };results.append(pick);}
    }catch(failure){results.textContent=publicError(failure);}finally{button.disabled=false;}};box.append(section);
  }
  setInterval(()=>{if(state.user&&!document.hidden)refresh();},60000);
  window.addEventListener('online',()=>refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  if(new URLSearchParams(location.search).get('view')==='invites'){state.invites=true;document.querySelectorAll('footer [data-view]').forEach(button=>button.classList.toggle('active',button===nav));}
  return {refresh,render:renderView,badge,configureEvent};
}
