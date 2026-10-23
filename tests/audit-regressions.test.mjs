import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import webpush from 'web-push';
import worker from '../worker/index.js';
import {handleCalendarRequest} from '../worker/calendar.js';
import {escapeHtml,writeTransaction} from '../public/ui-safety.mjs';
import {createDeadlineScheduler} from '../public/deadline-scheduler.mjs';
import {createSharedNotifications} from '../public/shared-notifications.mjs';

test('event titles are treated as text in monthly previews, including quotes and tags',async()=>{
  assert.equal(escapeHtml('<img onerror="bad()"> & \'quoted\''),'&lt;img onerror=&quot;bad()&quot;&gt; &amp; &#39;quoted&#39;');
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const month=source.split('\n').find(line=>line.startsWith('function renderMonth('));
  assert.match(month,/escapeHtml\(e.title\)/);assert.match(month,/escapeHtml\(due\[0\].title\)/);
});
test('aborted device writes reject instead of leaving the interface waiting forever',async()=>{
  const error=Error('QuotaExceededError'),database={transaction(){const tx={error,abort(){queueMicrotask(()=>tx.onabort());}};queueMicrotask(()=>tx.onabort());return tx;}};
  await assert.rejects(writeTransaction(database,'events',()=>{}),/QuotaExceeded/);
});
function reminderFixture(){
  const flags=new Map(),calls=[];let failing=false;
  const client={from(){return {
    delete(){calls.push({action:'delete'});return this;},eq(){return Promise.resolve({error:failing?Error('read-only'):null});},
    upsert(jobs,options){calls.push({action:'upsert',jobs,options});return Promise.resolve({error:failing?Error('read-only'):null});},
  };}};
  const scheduler=createDeadlineScheduler({client,requireSession:async()=>({user:{id:'self-id'}}),profile:()=> 'self',storage:{getItem:key=>flags.get(key),setItem:(key,value)=>flags.set(key,value)},now:()=>Date.parse('2026-10-23T10:00:00Z')});
  const event={id:'deadline',createdBy:'self',title:'Due',startsAt:'2026-10-23T11:00:00Z',notes:'[[deadline]]{"reminder":15}',space:'self'};
  return {scheduler,event,calls,flags,fail(value){failing=value;}};
}
test('offline deadline scheduling is retried and unchanged reminders cause no repeated writes',async()=>{
  const f=reminderFixture();f.fail(true);await assert.rejects(f.scheduler.queue(f.event),/read-only/);assert.equal(f.flags.has('queued-deadline:self:deadline'),false);
  f.fail(false);await f.scheduler.reconcile([f.event]);assert.equal(f.calls.at(-1).jobs.length,3);
  f.calls.length=0;await f.scheduler.reconcile([f.event]);assert.equal(f.calls.length,0);
});
test('edited offline deadlines replace old jobs even on a device without a reminder marker',async()=>{
  const f=reminderFixture();await f.scheduler.reconcile([f.event],{replaceIds:new Set([f.event.id])});assert.equal(f.calls[0].action,'delete');
  f.calls.length=0;await f.scheduler.reconcile([{...f.event,startsAt:'2026-10-23T12:00:00Z'}]);assert.equal(f.calls[0].action,'delete');
});
test('failed reminder deletion never records success or inserts a conflicting schedule',async()=>{
  const f=reminderFixture();await f.scheduler.queue(f.event);const prior=f.flags.get('queued-deadline:self:deadline');f.calls.length=0;f.fail(true);
  await assert.rejects(f.scheduler.queue({...f.event,deleted:true}),/read-only/);assert.equal(f.flags.get('queued-deadline:self:deadline'),prior);assert.equal(f.calls.length,1);
});
test('failed cancellation survives event-cache pruning and is retried later',async()=>{
  const f=reminderFixture();await f.scheduler.queue(f.event);f.fail(true);await assert.rejects(f.scheduler.queue({...f.event,deleted:true}),/read-only/);
  f.fail(false);f.calls.length=0;await f.scheduler.reconcile([]);assert.deepEqual(f.calls.map(call=>call.action),['delete']);
  f.calls.length=0;await f.scheduler.reconcile([]);assert.equal(f.calls.length,0);
});
test('unconfirmed and conflicting offline edits do not schedule a reminder before event upload',async()=>{
  const f=reminderFixture();await f.scheduler.queue(f.event,true,{defer:true});assert.equal(f.calls.length,0);
  await f.scheduler.reconcile([],{blockedIds:new Set([f.event.id])});assert.equal(f.calls.length,0);
  await f.scheduler.reconcile([f.event]);assert.equal(f.calls.at(-1).action,'upsert');
});
test('completed deadlines cancel reminders and old reminder times are not replayed',async()=>{
  const f=reminderFixture();await f.scheduler.reconcile([{...f.event,done:true}]);assert.deepEqual(f.calls.map(call=>call.action),['delete']);
  f.calls.length=0;await f.scheduler.queue({...f.event,startsAt:'2026-10-23T10:01:00Z'});assert.deepEqual(f.calls.at(-1).jobs.map(job=>job.kind),['deadline_due']);
});
test('foreign deadlines are not scheduled by this profile',async()=>{
  const f=reminderFixture();await f.scheduler.reconcile([{...f.event,createdBy:'other'}]);assert.equal(f.calls.length,0);
});
test('shared-event pushes survive offline, retry with a stable job ID and stop after acknowledgement',async()=>{
  const flags=new Map(),calls=[];let fail=true;
  const queue=createSharedNotifications({client:{from(){return {upsert:async(job,options)=>{calls.push({job,options});return {error:fail?Error('offline'):null};}};}},requireSession:async()=>({user:{id:'self'}}),storage:{getItem:key=>flags.get(key),setItem:(key,value)=>flags.set(key,value)},profile:()=> 'self',uuid:()=> 'stable-job'});
  const event={id:'shared',createdBy:'self',space:'shared',notes:'\n[[planner:both]]',title:'Event'};
  await queue.queue(event,{defer:true});assert.equal(calls.length,0);
  await queue.reconcile([event],{blockedIds:new Set([event.id])});assert.equal(calls.length,0);
  await assert.rejects(queue.reconcile([event]),/offline/);fail=false;await queue.reconcile([event]);
  assert.equal(calls[0].job.id,calls[1].job.id);assert.equal(calls[1].options.onConflict,'id');assert.equal(calls[1].options.ignoreDuplicates,true);
  await queue.reconcile([event]);assert.equal(calls.length,2);
  await queue.queue(event,{defer:true});await queue.reconcile([{...event,notes:''}]);assert.equal(calls.length,2);
});
test('temporary Auth outages are not reported as an expired session',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({message:'temporary outage'},{status:503});
  try{const result=await worker.fetch(new Request('https://worker.test/',{method:'POST',headers:{Authorization:'Bearer token'},body:'{"action":"test"}'}),{SUPABASE_URL:'https://db.test'});assert.notEqual(result.status,401);}
  finally{globalThis.fetch=original;}
});
test('manual Google refresh reports a failed cycle rather than success',async()=>{
  const original=globalThis.fetch,log=console.error;console.error=()=>{};
  globalThis.fetch=async input=>String(input).includes('/planner_google_tokens')?Response.json([{owner:'self',calendar_id:'cal',refresh_token:'bad',expires_at:0}]):Response.json({error:'invalid_grant'},{status:400});
  try{const result=await handleCalendarRequest(new Request('https://worker.test/google/sync',{method:'POST'}),{GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_OWNER_EMAILS:'{}',SUPABASE_URL:'https://failed-sync.test',SUPABASE_SERVICE_ROLE_KEY:'test'},{id:'self'});assert.equal(result.status,503);assert.ok((await result.json()).error);}
  finally{globalThis.fetch=original;console.error=log;}
});
for(const scenario of ['transient failure','subscriptions unavailable','success','permanently expired'])test('queued push: '+scenario,async()=>{
  const original=globalThis.fetch,send=webpush.sendNotification,vapid=webpush.setVapidDetails,log=console.error;let acknowledged=false,payload;
  webpush.setVapidDetails=()=>{};console.error=()=>{};
  webpush.sendNotification=async(_subscription,body)=>{payload=JSON.parse(body);if(scenario==='transient failure')throw Object.assign(Error('temporary'),{statusCode:503});if(scenario==='permanently expired')throw Object.assign(Error('gone'),{statusCode:410});};
  globalThis.fetch=async(input,init)=>{
    const url=String(input);if(url.includes('/push_subscriptions'))return Response.json(scenario==='subscriptions unavailable'?{error:'unavailable'}:[{subscription:{}}],{status:scenario==='subscriptions unavailable'?503:200});
    if(init?.method==='PATCH'){acknowledged=true;return Response.json({});}
    if(url.includes('/push_jobs'))return Response.json([{id:'job',audience:'self',kind:'deadline',created_by:'self',title:'Due'}]);throw Error('Unexpected request');
  };
  try{let promise;await worker.scheduled({scheduledTime:60000},{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'key'},{waitUntil(value){promise=value;}});
    if(scenario==='subscriptions unavailable')await assert.rejects(promise,/subscriptions unavailable/);else await promise;
    assert.equal(acknowledged,['success','permanently expired'].includes(scenario));if(payload)assert.equal(payload.url,'./');
  }finally{globalThis.fetch=original;webpush.sendNotification=send;webpush.setVapidDetails=vapid;console.error=log;}
});
