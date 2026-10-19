import test from 'node:test';
import assert from 'node:assert/strict';
import {withTiming,eventEnd,eventMeta,occursOn,clipToDay,occurrences,seriesTag,seriesInfo,stripEventMeta,isAllDay,dateKey} from '../public/event-model.mjs';
import {googleBody,plannerFields} from '../worker/google-event-model.mjs';
const base={id:'event-id',title:'Событие',notes:'Описание',startsAt:'2026-10-19T10:00:00Z',durationMinutes:60};
test('legacy events keep their original end and description',()=>{assert.equal(eventEnd(base).toISOString(),'2026-10-19T11:00:00.000Z');assert.equal(isAllDay(base),false);assert.equal(stripEventMeta(base.notes),'Описание');});
test('multi-day event fits legacy database constraints and covers every intersecting day',()=>{
  const event=withTiming(base,new Date('2026-10-19T20:00:00'),new Date('2026-10-22T00:00:00'));
  assert.equal(event.durationMinutes,1440);assert.equal(eventEnd(event).getTime(),new Date('2026-10-22T00:00:00').getTime());
  assert.equal(occursOn(event,new Date('2026-10-20T12:00:00')),true);assert.equal(occursOn(event,new Date('2026-10-21T12:00:00')),true);assert.equal(occursOn(event,new Date('2026-10-22T12:00:00')),false);
});
test('all-day end is exclusive and day selection has no extra trailing day',()=>{
  const event=withTiming(base,new Date('2026-10-19T00:00:00'),new Date('2026-10-22T00:00:00'),true);
  assert.deepEqual(eventMeta(event),{allDay:true,startDate:'2026-10-19',endDate:'2026-10-22'});assert.equal(occursOn(event,new Date('2026-10-22T00:00:00')),false);
});
test('clipping includes the part of a night-spanning event on the second day',()=>{
  const event=withTiming(base,new Date('2026-10-19T23:00:00'),new Date('2026-10-20T08:00:00'));
  assert.deepEqual(clipToDay(event,new Date('2026-10-20T12:00:00')),{start:0,end:120});
});
test('23:59 reaches the bottom of the day grid',()=>{
  const event=withTiming(base,new Date('2026-10-19T22:00:00'),new Date('2026-10-19T23:59:00'));
  assert.equal(clipToDay(event,new Date('2026-10-19T12:00:00')).end,1079);
});
test('native Google all-day export/import retains the complete date interval',()=>{
  const event=withTiming(base,new Date('2026-10-19T00:00:00'),new Date('2026-10-22T00:00:00'),true),remote=googleBody({id:base.id,title:base.title,notes:event.notes,starts_at:event.startsAt,duration_minutes:event.durationMinutes});
  assert.deepEqual(remote.start,{date:'2026-10-19'});assert.deepEqual(remote.end,{date:'2026-10-22'});assert.equal(remote.description,'Описание');
  const imported=plannerFields({...remote,summary:base.title});assert.deepEqual(eventMeta(imported),eventMeta(event));
});
test('Google timed multi-day events retain exact end time and hidden series metadata',()=>{
  const series=seriesTag('series-id',{kind:'weekly',until:'2026-12-31'}),event=withTiming({...base,notes:'Описание'+series+'\n[[planner:both]]'},new Date('2026-10-19T20:00:00'),new Date('2026-10-22T09:00:00'));
  const row={id:base.id,title:base.title,notes:event.notes,starts_at:event.startsAt,duration_minutes:event.durationMinutes};
  const remote=googleBody(row);assert.equal(remote.end.dateTime,eventEnd(event).toISOString());assert.equal(remote.description,'Описание');
  const fields=plannerFields({...remote,summary:base.title},row);assert.equal(seriesInfo(fields).id,'series-id');assert.ok(fields.notes.includes('[[planner:both]]'));assert.equal(eventEnd({startsAt:fields.starts_at,durationMinutes:fields.duration_minutes,notes:fields.notes}).getTime(),eventEnd(event).getTime());
});
test('monthly day 31 skips months without that day',()=>{assert.deepEqual(occurrences(new Date('2026-01-31T10:00:00'),{kind:'monthly',until:'2026-05-31'}).map(dateKey),['2026-01-31','2026-03-31','2026-05-31']);});
test('last day of month includes February correctly',()=>{assert.deepEqual(occurrences(new Date('2026-01-19T10:00:00'),{kind:'monthly',monthMode:'lastDay',until:'2026-03-31'}).map(dateKey),['2026-01-31','2026-02-28','2026-03-31']);});
test('custom weekday repetition respects the every-two-weeks interval',()=>{assert.deepEqual(occurrences(new Date('2026-10-19T10:00:00'),{kind:'customWeekly',every:2,days:[1,3],until:'2026-11-04'}).map(dateKey),['2026-10-19','2026-10-21','2026-11-02','2026-11-04']);});
test('last weekday rule selects the last Monday of each month',()=>{assert.deepEqual(occurrences(new Date('2026-10-19T10:00:00'),{kind:'monthly',monthMode:'lastWeekday',until:'2026-12-31'}).map(dateKey),['2026-10-26','2026-11-30','2026-12-28']);});
test('too many occurrences and oversized metadata fail before writing',()=>{assert.throws(()=>occurrences(new Date('2026-01-01T10:00:00'),{kind:'daily',until:'2028-01-01'}),/500/);assert.throws(()=>withTiming({...base,notes:'a'.repeat(600)},new Date('2026-10-19T00:00:00'),new Date('2026-10-22T00:00:00'),true),/600/);});
