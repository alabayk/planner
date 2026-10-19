import {eventEnd,withTiming,dateKey} from './event-model.mjs';
export function attachResize(item,event,{state,save,render}){
  if(event.createdBy!==state.user)return;
  const dayEnd=new Date(dateKey(state.date)+'T00:00:00');dayEnd.setDate(dayEnd.getDate()+1);
  if(eventEnd(event)>dayEnd)return; // Resize the final segment of a multi-day event.
  const handle=document.createElement('span');handle.className='resizeHandle';handle.tabIndex=0;handle.setAttribute('role','slider');handle.setAttribute('aria-label','Изменить время окончания');handle.setAttribute('aria-valuetext',eventEnd(event).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}));
  handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','5');handle.setAttribute('aria-valuemax',String(Math.round((dayEnd-new Date(event.startsAt))/60000)));handle.setAttribute('aria-valuenow',String(Math.round((eventEnd(event)-new Date(event.startsAt))/60000)));
  let drag=null;
  handle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
  handle.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);drag={y:e.clientY,scroll:window.scrollY,end:eventEnd(event),height:item.style.height};state.resizing=true;item.classList.add('resizing');});
  handle.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();e.stopPropagation();
    const minutes=Math.round(((e.clientY-drag.y+window.scrollY-drag.scroll)*60/56)/5)*5;
    const start=new Date(event.startsAt),end=new Date(Math.min(dayEnd.getTime(),Math.max(start.getTime()+5*60000,drag.end.getTime()+minutes*60000)));
    drag.next=end;item.style.height=`${Math.max(22,parseFloat(drag.height)+(end-drag.end)*56/3600000)}px`;
    handle.setAttribute('aria-valuetext',end.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}));handle.setAttribute('aria-valuenow',String(Math.round((end-start)/60000)));handle.dataset.time=end.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
    if(e.clientY>window.innerHeight-50)window.scrollBy(0,12);else if(e.clientY<70)window.scrollBy(0,-12);
  });
  const finish=async(e,cancel)=>{if(!drag)return;e.preventDefault();e.stopPropagation();const current=drag;drag=null;state.resizing=false;item.classList.remove('resizing');delete handle.dataset.time;
    if(cancel||!current.next||current.next.getTime()===current.end.getTime()){item.style.height=current.height;return;}
    try{await save(withTiming({...event,_base:event},new Date(event.startsAt),current.next));}catch{render();}
  };
  handle.addEventListener('pointerup',e=>finish(e,false));handle.addEventListener('pointercancel',e=>finish(e,true));
  handle.addEventListener('keydown',async e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const end=new Date(Math.max(new Date(event.startsAt).getTime()+300000,Math.min(dayEnd.getTime(),eventEnd(event).getTime()+(e.key==='ArrowUp'?-15:15)*60000)));await save(withTiming({...event,_base:event},new Date(event.startsAt),end));});
  item.append(handle);
}
