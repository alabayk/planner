import {parseQuickEvent} from './quick-event-parser.mjs';
import {dateKey} from './event-model.mjs';
const $=selector=>document.querySelector(selector),localInput=date=>new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
export function installQuickEvent({openEditor}){
  const choose=$('#addChooser .addKinds'),button=document.createElement('button');button.type='button';button.id='addQuickEvent';button.innerHTML='<b>Одной строкой</b><span>Написать или вставить текст</span>';choose.prepend(button);
  const modal=document.createElement('dialog');modal.id='quickEventDialog';modal.innerHTML='<form class="quickEventForm"><div class="sheet"><h2>Событие одной строкой</h2><button type="button" class="close" aria-label="Закрыть">×</button></div><label>Что запланировать?<textarea maxlength="2000" rows="4" required placeholder="Завтра в 19 тренировка на час"></textarea></label><p class="quickEventHelp">Например: «В пятницу с 14 до 16 встреча» или «Каждый вторник в 10 занятие на полтора часа». Сначала откроется черновик для проверки.</p><button type="button" class="clipboardButton">Вставить из буфера</button><p class="quickEventError" role="alert" hidden></p><div class="actions"><button type="submit" class="primary">Заполнить редактор</button></div></form>';document.body.append(modal);
  const form=modal.querySelector('form'),input=form.querySelector('textarea'),error=form.querySelector('[role=alert]'),clipboard=form.querySelector('.clipboardButton');
  const review=document.createElement('div');review.className='quickEventReview';review.hidden=true;review.setAttribute('role','status');$('#eventForm .sheet').after(review);
  const showError=text=>{error.hidden=!text;error.textContent=text;};
  button.onclick=()=>{$('#addChooser').close();showError('');modal.showModal();input.focus();};
  modal.querySelector('.close').onclick=()=>modal.close();
  clipboard.onclick=async()=>{showError('');try{if(!navigator.clipboard?.readText)throw Error();const value=await navigator.clipboard.readText();if(!value.trim()){showError('Буфер пуст. Скопируйте текст или вставьте его вручную.');return;}input.value=value.slice(0,2000);input.focus();}catch{showError('Не удалось прочитать буфер. Нажмите на поле и выберите «Вставить».');input.focus();}};
  // Clear previous review when the ordinary event editor is opened.
  $('#editor').addEventListener('close',()=>{review.hidden=true;review.replaceChildren();});
  form.onsubmit=event=>{
    event.preventDefault();if(!form.reportValidity())return;
    try{
      const draft=parseQuickEvent(input.value);modal.close();openEditor(null);
      $('#title').value=draft.title;$('#notes').value=draft.notes;
      const start=draft.start||new Date(draft.date+'T09:00:00'),end=draft.end||new Date(start.getTime()+3600000);
      $('#startsAt').value=localInput(start);$('#endsAt').value=localInput(end);
      $('#startsAt').dispatchEvent(new Event('input',{bubbles:true}));$('#endsAt').value=localInput(end);$('#endsAt').dispatchEvent(new Event('input',{bubbles:true}));
      if(draft.allDay){$('#allDayEvent').checked=true;$('#allDayEvent').dispatchEvent(new Event('change',{bubbles:true}));}
      const until=new Date(start);until.setMonth(until.getMonth()+3);$('#repeatUntil').value=dateKey(until);$('#repeatRule').value=draft.rule;$('#repeatRule').dispatchEvent(new Event('change',{bubbles:true}));
      if(!draft.start&&!draft.allDay){$('#startsAt').value='';$('#endsAt').value='';}
      review.replaceChildren();const heading=document.createElement('strong');heading.textContent='Черновик из текста — проверьте перед сохранением';review.append(heading);
      for(const text of draft.warnings){const note=document.createElement('p');note.textContent=text;review.append(note);}review.hidden=false;
      requestAnimationFrame(()=>{if(!draft.title)$('#title').focus();else if(!draft.start)$('#startsAt').focus();});
    }catch(failure){showError(failure.message||'Не удалось разобрать текст. Попробуйте указать дату и время явно.');}
  };
}
