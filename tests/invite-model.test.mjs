import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,eventForAction,participant,freeSlots,normalizedProposal,inviteNotes,readInvite} from '../public/invite-model.mjs';
import {withTiming,eventMeta} from '../public/event-model.mjs';
const event={id:'event',createdBy:'owner',space:'owner',notes:'description',startsAt:'2030-01-07T07:00:00Z',durationMinutes:60};
const pending={to:'recipient',state:'pending',originalSpace:'owner'};
test('only recipient can accept, and participation begins after accepting',()=>{
  assert.equal(participant(event),false);assert.throws(()=>transition(pending,'accept','owner',null,event));
  assert.equal(transition(pending,'accept','recipient',null,event).state,'accepted');
  const accepted=eventForAction(event,pending,'accept');assert.equal(participant(accepted),true);assert.match(accepted.notes,/description/);
  const declined=eventForAction(accepted,{...pending,state:'accepted'},'decline');assert.equal(participant(declined),false);assert.equal(declined.space,'owner');
  assert.throws(()=>transition({...pending,state:'declined'},'accept','recipient',null,event));
});
test('proposal needs owner approval and preserves all-day date boundaries',()=>{
  const allDay=withTiming(event,new Date('2030-01-07T00:00:00'),new Date('2030-01-09T00:00:00'),true);
  const proposed=transition(pending,'propose','recipient',{startDate:'2030-01-10',endDate:'2030-01-12'},allDay);
  assert.equal(proposed.state,'proposed');assert.throws(()=>transition({...pending,...proposed},'acceptProposal','recipient',null,allDay));
  const change=transition({...pending,...proposed},'acceptProposal','owner',null,allDay);
  const next=eventForAction(allDay,{...pending,...proposed},'acceptProposal',change.proposal);
  assert.equal(eventMeta(next).startDate,'2030-01-10');assert.equal(eventMeta(next).endDate,'2030-01-12');assert.equal(participant(next),true);
  assert.throws(()=>normalizedProposal({start:'bad',end:'bad'},event));
});
test('free time merges both schedules, respects private and multi-day events, and exposes no titles',()=>{
  const rows=[{...event,title:'private',starts_at:'2030-01-07T06:00:00Z',duration_minutes:120},{...event,title:'private2',starts_at:'2030-01-07T07:00:00Z',duration_minutes:120},{...event,notes:'__todo__',starts_at:'2030-01-07T09:00:00Z',duration_minutes:500}];
  const slots=freeSlots(rows,{date:'2030-01-07',from:'09:00',to:'15:00',duration:60});assert.equal(slots[0].start,'2030-01-07T09:00:00.000Z');assert.deepEqual(Object.keys(slots[0]),['start','end','freeUntil']);
  const allDay=withTiming(event,new Date('2030-01-07T00:00:00'),new Date('2030-01-08T00:00:00'),true);
  assert.equal(freeSlots([allDay],{date:'2030-01-07'}).length,0);
});
test('coordination records remain within existing database note limits',()=>{
  const data={event:crypto.randomUUID(),to:'recipient',state:'proposed',rev:1,originalSpace:'shared',proposal:{start:'2030-01-07T10:00:00Z',end:'2030-01-07T11:00:00Z'},op:{kind:'acceptProposal',actor:'owner',sourceVersion:123}};
  const notes=inviteNotes(data);assert.ok(notes.length<=600);assert.deepEqual(readInvite({notes}),data);
});
