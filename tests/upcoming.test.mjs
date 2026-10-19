import test from 'node:test';
import assert from 'node:assert/strict';
import {upcomingSummary,startsIn} from '../public/upcoming-model.mjs';
import {withTiming} from '../public/event-model.mjs';
const now=new Date(2026,9,19,12),base={id:'a',title:'Event',space:'self',createdBy:'self',notes:'',startsAt:new Date(2026,9,19,13).toISOString(),durationMinutes:60};
test('summary only includes own and accepted joint events, not merely visible foreign events',()=>{
 const rows=[base,{...base,id:'other',title:'Visible only',createdBy:'other',space:'shared'},{...base,id:'joint',title:'Joint',createdBy:'other',space:'shared',notes:'\n[[planner:both]]'},{...base,id:'private',title:'Private',space:'other',createdBy:'other'}];
 const data=upcomingSummary(rows,'self',now);assert.equal(data.upcoming.length,2);assert.equal(data.today.length,2);assert.equal(data.next.id,'a');assert.equal(upcomingSummary(rows,'',now).next,null);
});
test('expired, deleted, completed and internal rows do not become next event',()=>{
 const rows=[{...base,startsAt:new Date(2026,9,19,9).toISOString()},{...base,deleted:true},{...base,done:true},{...base,notes:'[[invitation]]{}'}];assert.equal(upcomingSummary(rows,'self',now).next,null);
});
test('ongoing multi-day and all-day events remain current until their end',()=>{
 const allDay=withTiming({...base,id:'all-day'},new Date(2026,9,19),new Date(2026,9,20),true);
 const data=upcomingSummary([allDay],'self',now);assert.equal(data.next.id,'all-day');assert.equal(startsIn(data.next,now),'Сейчас');assert.equal(upcomingSummary([allDay],'self',new Date(2026,9,20)).next,null);
});
test('copy of joint event is not counted twice',()=>{
 const joint={...base,id:'joint',space:'shared',notes:'\n[[planner:both]]'};const data=upcomingSummary([base,joint],'self',now);assert.equal(data.upcoming.length,1);assert.equal(data.next.id,'joint');
});
test('own unfinished tasks and visible deadlines are separate from events',()=>{
 const rows=[{...base,notes:'__todo__'},{...base,id:'foreign-task',notes:'__todo__',createdBy:'other',space:'shared'},{...base,id:'due',notes:'[[deadline]]{}',startsAt:new Date(2026,9,19,10).toISOString()},{...base,id:'finished',notes:'__todo__',done:true}];
 const data=upcomingSummary(rows,'self',now);assert.equal(data.tasks.length,1);assert.equal(data.deadlines.length,1);assert.equal(data.overdue,1);assert.equal(data.next,null);
});
test('countdown uses correct minute forms and updates across time boundaries',()=>{
 for(const [minutes,text]of [[1,'Через 1 минуту'],[2,'Через 2 минуты'],[11,'Через 11 минут'],[21,'Через 21 минуту'],[60,'Через 1 час'],[1440,'Через 1 день']])assert.equal(startsIn({...base,startsAt:new Date(+now+minutes*60000).toISOString()},now),text);
});
