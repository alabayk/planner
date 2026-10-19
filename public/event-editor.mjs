import {dateKey,plusDays,eventEnd,eventMeta,isAllDay,withTiming,stripEventMeta,stripSeries,seriesInfo,seriesTag,occurrences} from './event-model.mjs';
import {importId} from './sync-core.mjs';
const $=selector=>document.querySelector(selector),localInput=date=>{const d=new Date(date);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function installEventEditor({state,saveSeries,closeEditor,ensureNotifications,linkedCopies}){
  const form=$('#eventForm');let source=null,manualEnd=false;
  $('.eventTimes').insertAdjacentHTML('beforebegin','<label class="allDayChoice"><input id="allDayEvent" type="checkbox">Весь день</label><div id="allDayDates" class="eventDateRange" hidden><label>С даты<input id="eventStartDate" type="date"></label><label>По дату включительно<input id="eventEndDate" type="date"></label></div>');
  $('.repeatFields').insertAdjacentHTML('beforebegin','<label id="seriesScopeField" hidden>Изменить<select id="seriesScope"><option value="one">Только это событие</option><option value="future">Это и последующие</option></select></label>');
  $('#repeatRule').insertAdjacentHTML('beforeend','<option value="customWeekly">По выбранным дням недели</option><option value="yearly">Каждый год</option>');
  $('.repeatFields').insertAdjacentHTML('beforeend','<label id="repeatIntervalField" hidden>Интервал<input id="repeatEvery" type="number" min="1" max="99" value="1"><small>Количество дней, недель, месяцев или лет</small></label><label id="repeatMonthField" hidden>В месяце<select id="repeatMonthMode"><option value="date">В это число</option><option value="lastDay">В последний день месяца</option><option value="nthWeekday">В такой же по счёту день недели</option><option value="lastWeekday">В последний такой день недели</option></select></label><fieldset id="repeatWeekdays" hidden><legend>Дни недели</legend>'+[[1,'Пн'],[2,'Вт'],[3,'Ср'],[4,'Чт'],[5,'Пт'],[6,'Сб'],[0,'Вс']].map(([n,label])=>`<label><input type="checkbox" value="${n}">${label}</label>`).join('')+'</fieldset><p id="repeatPreview" class="repeatPreview" aria-live="polite"></p>');
  $('.mainActions').insertAdjacentHTML('beforebegin','<p id="eventError" class="loginError" role="alert" hidden></p>');
  const showError=text=>{$('#eventError').hidden=!text;$('#eventError').textContent=text;};
  function timing(){
    if($('#allDayEvent').checked){const start=$('#eventStartDate').value,last=$('#eventEndDate').value;if(!start||!last||last<start)throw new Error('Последняя дата не должна быть раньше первой');return {start:new Date(start+'T00:00:00'),end:new Date(plusDays(last,1)+'T00:00:00'),allDay:true};}
    return {start:new Date($('#startsAt').value),end:new Date($('#endsAt').value),allDay:false};
  }
  function rule(){return {kind:$('#repeatRule').value,every:Number($('#repeatEvery').value),until:$('#repeatUntil').value,monthMode:$('#repeatMonthMode').value,days:Array.from($('#repeatWeekdays input:checked'),e=>Number(e.value))};}
  function update(){
    const allDay=$('#allDayEvent').checked,foreign=!!source&&source.createdBy!==state.user;
    $('.eventTimes').hidden=allDay;$('#allDayDates').hidden=!allDay;
    for(const id of ['#startsAt','#endsAt']){$(id).required=!allDay;$(id).disabled=allDay||foreign;}
    for(const id of ['#eventStartDate','#eventEndDate']){$(id).required=allDay;$(id).disabled=!allDay||foreign;}
    const one=!!seriesInfo(source||{})&&$('#seriesScope').value==='one',repeated=$('#repeatRule').value!=='none';
    $('#repeatRule').disabled=foreign||one;
    $('#repeatEvery').disabled=foreign||one||!repeated||$('#repeatRule').value==='biweekly';
    $('#repeatUntil').disabled=foreign||one||!repeated;
    $('#repeatMonthMode').disabled=foreign||one||$('#repeatRule').value!=='monthly';
    $('#repeatUntilField').hidden=!repeated;$('#repeatUntil').required=repeated&&!one&&!foreign;
    $('#repeatIntervalField').hidden=!repeated||$('#repeatRule').value==='biweekly';
    $('#repeatMonthField').hidden=$('#repeatRule').value!=='monthly';$('#repeatWeekdays').hidden=$('#repeatRule').value!=='customWeekly';
    $('#repeatWeekdays').disabled=foreign||one||$('#repeatRule').value!=='customWeekly';
    if(repeated&&!$('#repeatUntil').value){const date=new Date($('#startsAt').value||Date.now());date.setMonth(date.getMonth()+3);$('#repeatUntil').value=dateKey(date);}
    const preview=$('#repeatPreview');preview.textContent='';
    if(one)preview.textContent='Изменения затронут только выбранное событие серии.';
    else if(repeated)try{const list=occurrences(timing().start,rule());preview.textContent=`Событий: ${list.length}. Первое: ${list[0].toLocaleDateString('ru')}. Последнее: ${list.at(-1).toLocaleDateString('ru')}.`;}catch(error){preview.textContent=error.message;}
  }
  function open(event){
    source=event?structuredClone(event):null;manualEnd=!!event;showError('');
    const meta=eventMeta(event||{}),start=event?new Date(event.startsAt):new Date($('#startsAt').value),end=event?eventEnd(event):new Date($('#endsAt').value);
    $('#allDayEvent').checked=!!meta.allDay;$('#allDayEvent').disabled=!!event&&event.createdBy!==state.user;
    $('#startsAt').value=localInput(start);$('#endsAt').value=localInput(end);
    $('#eventStartDate').value=meta.startDate||dateKey(start);$('#eventEndDate').value=meta.endDate?plusDays(meta.endDate,-1):dateKey(new Date(end-1));
    const series=seriesInfo(event||{});$('#seriesScopeField').hidden=!series;$('#seriesScope').value='one';
    $('#repeatRule').value=series?.rule?.kind||'none';$('#repeatEvery').value=series?.rule?.every||1;$('#repeatMonthMode').value=series?.rule?.monthMode||'date';
    const siblings=series?state.events.filter(e=>!e.deleted&&seriesInfo(e)?.id===series.id):[];
    $('#repeatUntil').value=series?.rule?.until||(siblings.length?dateKey(new Date(Math.max(...siblings.map(e=>new Date(e.startsAt))))):'');
    $('#repeatWeekdays input').checked=false;document.querySelectorAll('#repeatWeekdays input').forEach(input=>{input.checked=(series?.rule?.days||[start.getDay()]).includes(Number(input.value));});
    update();
  }
  $('#allDayEvent').onchange=()=>{
    if($('#allDayEvent').checked){$('#eventStartDate').value=$('#startsAt').value.slice(0,10);$('#eventEndDate').value=dateKey(new Date(new Date($('#endsAt').value)-1));}
    else{const start=new Date($('#eventStartDate').value+'T09:00:00'),end=new Date($('#eventEndDate').value+'T10:00:00');$('#startsAt').value=localInput(start);$('#endsAt').value=localInput(end>start?end:new Date(start.getTime()+3600000));manualEnd=dateKey(start)!==dateKey(end);}
    update();
  };
  $('#startsAt').oninput=()=>{const start=new Date($('#startsAt').value),end=new Date($('#endsAt').value);if(Number.isNaN(start.getTime()))return;if(!manualEnd||!Number.isFinite(end.getTime())||end<=start){$('#endsAt').value=localInput(new Date(start.getTime()+3600000));manualEnd=false;}$('#endsAt').setCustomValidity('');update();};
  $('#endsAt').oninput=()=>{manualEnd=true;$('#endsAt').setCustomValidity('');update();};
  $('#eventStartDate').oninput=()=>{if($('#eventEndDate').value<$('#eventStartDate').value)$('#eventEndDate').value=$('#eventStartDate').value;update();};
  for(const id of ['#eventEndDate','#repeatRule','#repeatEvery','#repeatUntil','#repeatMonthMode','#seriesScope'])$(id).onchange=update;
  $('#repeatWeekdays').onchange=update;
  form.onsubmit=async event=>{
    event.preventDefault();showError('');if(!form.reportValidity())return;
    if(source&&source.createdBy!==state.user){showError('Это событие можно изменить только в профиле владельца');return;}
    const button=form.querySelector('.primary');button.disabled=true;
    try{
      const range=timing(),old=source||{},series=seriesInfo(old),future=!!series&&$('#seriesScope').value==='future';
      const tagBoth=(old.notes||'').includes('[[planner:both]]')&&$('#space').value==='shared'?'\n[[planner:both]]':'';
      const base={...old,id:$('#eventId').value,title:$('#title').value.trim(),notes:$('#notes').value.trim()+tagBoth,space:$('#space').value,createdBy:old.createdBy||state.user,done:old.done||false,deleted:false,version:old.version||0};
      if(!base.title)throw new Error('Введите название события');
      const repeat=(!series||future)&&$('#repeatRule').value!=='none',items=[];
      if(repeat){
        const config=rule(),dates=occurrences(range.start,config),seriesId=series?.id||crypto.randomUUID(),duration=range.end-range.start;
        const dayCount=Math.round((Date.UTC(range.end.getFullYear(),range.end.getMonth(),range.end.getDate())-Date.UTC(range.start.getFullYear(),range.start.getMonth(),range.start.getDate()))/86400000);
        for(const [index,start]of dates.entries()){
          const existing=future?state.events.find(e=>!e.deleted&&seriesInfo(e)?.id===seriesId&&new Date(e.startsAt).getTime()===start.getTime()):null;
          const id=index===0?base.id:existing?.id||await importId(base.createdBy,`series:${seriesId}:${start.toISOString()}`);
          const end=range.allDay?new Date(plusDays(dateKey(start),dayCount)+'T00:00:00'):new Date(start.getTime()+duration);
          const next=withTiming({...base,id,version:index===0?base.version:existing?.version||0,notes:base.notes+seriesTag(seriesId,config),_base:index===0?source:existing||null},start,end,range.allDay);items.push(next);
        }
      }else{
        if(series&&!future)base.notes+=seriesTag(series.id,series.rule);
        items.push(withTiming({...base,_base:source},range.start,range.end,range.allDay));
      }
      if(future){const kept=new Set(items.map(e=>e.id));for(const previous of state.events)if(!previous.deleted&&seriesInfo(previous)?.id===series.id&&new Date(previous.startsAt)>=new Date(old.startsAt)&&!kept.has(previous.id))items.push({...previous,deleted:true,_base:previous});}
      if(!repeat&&!future)for(const copy of linkedCopies?.(old)||[]){
        const copySeries=seriesInfo(copy),notes=$('#notes').value.trim()+((copy.notes||'').includes('[[planner:both]]')?'\n[[planner:both]]':'')+(copySeries?seriesTag(copySeries.id,copySeries.rule):'');
        items.push(withTiming({...copy,title:base.title,notes,done:base.done,_base:copy},range.start,range.end,range.allDay));
      }
      if(base.space==='shared')ensureNotifications().catch(()=>{});
      await saveSeries(items);closeEditor();
    }catch(error){showError(error.message||'Не удалось сохранить событие');}finally{button.disabled=false;}
  };
  return {open};
}
