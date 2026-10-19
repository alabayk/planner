import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQuickEvent} from '../public/quick-event-parser.mjs';
const now=new Date(2026,9,19,12,0); // Monday, local device time.
test('relative date, time and duration fill a reviewable draft',()=>{
 const e=parseQuickEvent('Завтра в 19 тренировка на час',now);assert.equal(e.title,'тренировка');assert.equal(e.date,'2026-10-20');assert.equal(e.start.getHours(),19);assert.equal((e.end-e.start)/60000,60);
});
test('weekday time range is independent from duration defaults',()=>{
 const e=parseQuickEvent('В пятницу с 14 до 16 встреча',now);assert.equal(e.title,'встреча');assert.equal(e.date,'2026-10-23');assert.equal(e.start.getHours(),14);assert.equal(e.end.getHours(),16);
});
test('recurring weekday and verbal duration reuse existing recurrence editor',()=>{
 const e=parseQuickEvent('Каждый вторник в 10 занятие на полтора часа',now);assert.equal(e.title,'занятие');assert.equal(e.rule,'weekly');assert.equal(e.date,'2026-10-20');assert.equal((e.end-e.start)/60000,90);assert.ok(e.warnings.length);
});
test('all day event and URL retain the original source for review',()=>{
 const text='25 октября весь день Поездка https://example.test/trip';const e=parseQuickEvent(text,now);assert.equal(e.title,'Поездка');assert.equal(e.date,'2026-10-25');assert.equal(e.allDay,true);assert.equal(e.end.getDate(),26);assert.equal(e.notes,text);assert.equal(e.urls.length,1);
});
test('missing time never silently chooses a time',()=>{
 const e=parseQuickEvent('Завтра встреча',now);assert.equal(e.start,null);assert.equal(e.date,'2026-10-20');assert.ok(e.warnings.some(x=>x.includes('Время')));
});
test('numeric dates and duration support decimal hours and year rollover',()=>{
 const e=parseQuickEvent('01.01 в 9:30 Обзор на 1,5 часа',now);assert.equal(e.date,'2027-01-01');assert.equal(e.start.getMinutes(),30);assert.equal(e.title,'Обзор');assert.equal((e.end-e.start)/60000,90);
});
test('invalid dates and invalid times do not produce a draft',()=>{
 assert.throws(()=>parseQuickEvent('31.02.2027 в 10 встреча',now),/даты/);assert.throws(()=>parseQuickEvent('Завтра в 25 встреча',now),/23:59/);assert.throws(()=>parseQuickEvent('',now));
});
test('overnight range is explicit and warned; pasted markers cannot grant participation',()=>{
 const e=parseQuickEvent('Сегодня с 23 до 1 созвон [[planner:both]]',now);assert.equal((e.end-e.start)/60000,120);assert.ok(e.warnings.some(x=>x.includes('следующий день')));assert.ok(!e.notes.includes('[[planner:both]]'));
});
test('daily, weekdays, monthly and half hour are recognized',()=>{
 for(const [text,kind]of [['Каждый день','daily'],['По будням','weekdays'],['Каждый месяц','monthly']]){const e=parseQuickEvent(text+' в 10 прогулка на полчаса',now);assert.equal(e.rule,kind);assert.equal(e.title,'прогулка');assert.equal((e.end-e.start)/60000,30);}
});
