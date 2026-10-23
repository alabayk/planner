import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import worker from '../worker/index.js';
import {createSessionManager} from '../public/session.mjs';
import {WEEKLY_SCHEDULE,queueWeeklySchedule,scheduleConfirmed} from '../public/schedule-20261026.mjs';
const valid={access_token:'test',refresh_token:'test-refresh',expires_at:200,user:{email:'self@planer.app'}};
test('near-expiry session is refreshed once for concurrent requests',async()=>{
 let refreshed=0;const manager=createSessionManager({getSession:async()=>({data:{session:{...valid,expires_at:1}}}),refreshSession:async()=>{refreshed++;return {data:{session:valid}};}},{now:()=>100000});
 const results=await Promise.all([manager.requireSession(),manager.requireSession()]);assert.equal(refreshed,1);assert.equal(results[0].access_token,'test');
});
test('missing or revoked session requests login without clearing user data',async()=>{
 for(const result of [{data:{session:null}},{error:{code:'refresh_token_not_found',status:400}}]){
 const manager=createSessionManager({getSession:async()=>result});await assert.rejects(manager.requireSession(),error=>error.code==='AUTH_REQUIRED'&&error.message.includes('очередь'));
 }
});
test('server rejection can force a refresh despite a misleading local expiry time',async()=>{
 let refreshed=0;const manager=createSessionManager({getSession:async()=>({data:{session:valid}}),refreshSession:async()=>{refreshed++;return {data:{session:{...valid,access_token:'renewed'}}};}},{now:()=>100000});
 await manager.requireSession();assert.equal(refreshed,0);assert.equal((await manager.refresh()).access_token,'renewed');assert.equal(refreshed,1);
});
test('temporary auth outage is not mistaken for a revoked session',async()=>{
 let attempts=0;const manager=createSessionManager({getSession:async()=>{if(!attempts++)return {error:Error('network timeout')};return {data:{session:valid}};}},{now:()=>100000});
 await assert.rejects(manager.requireSession(),/network/);assert.equal((await manager.requireSession()).access_token,'test');
});
test('weekly schedule contains exactly the approved 18 shared classes and no Tuesday class',()=>{
 assert.equal(WEEKLY_SCHEDULE.length,18);assert.equal(new Set(WEEKLY_SCHEDULE.map(row=>row.id)).size,18);
 assert.ok(WEEKLY_SCHEDULE.every(row=>row.space==='shared'&&row.createdBy==='ksusha'&&row.durationMinutes===80));
 assert.ok(WEEKLY_SCHEDULE.every(row=>!row.startsAt.startsWith('2026-10-27')&&!/Русский|самоподготовки/.test(row.title)));
 const final=WEEKLY_SCHEDULE.at(-1);assert.equal(final.startsAt,'2026-10-31T09:30:00.000Z');assert.equal(new Date(new Date(final.startsAt).getTime()+final.durationMinutes*60000).toISOString(),'2026-10-31T10:50:00.000Z');
 assert.equal(scheduleConfirmed(WEEKLY_SCHEDULE.map(row=>row.id)),true);assert.equal(scheduleConfirmed(WEEKLY_SCHEDULE.slice(1).map(row=>row.id)),false);
});
test('schedule is queued once without a network call, even before re-login',async()=>{
 const events=[],outbox=[],flags=new Map(),storage={getItem:key=>flags.get(key),setItem:(key,value)=>flags.set(key,value)};let calls=0;
 const options={profile:'self',storage,all:async table=>table==='events'?events:outbox,saveMany:async(rows,config)=>{assert.equal(config.flush,false);calls++;events.push(...rows);outbox.push(...rows);}};
 await queueWeeklySchedule(options);await queueWeeklySchedule(options);assert.equal(calls,1);assert.equal(outbox.length,18);
});
test('existing and intentionally deleted schedule IDs are not queued again',async()=>{
 const flags=new Map(),storage={getItem:key=>flags.get(key),setItem:(key,value)=>flags.set(key,value)};let count=0;
 await queueWeeklySchedule({profile:'self',storage,all:async table=>table==='events'?WEEKLY_SCHEDULE.map(row=>({...row,deleted:true})):[],saveMany:async()=>count++});assert.equal(count,0);
});
test('removed sections return 410 without authentication or database traffic',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No database calls allowed');};
 try{for(const path of ['/invites/list','/invites/status','/sb/rest/v1/planner_messages?select=*']){const result=await worker.fetch(new Request('https://worker.test'+path),{});assert.equal(result.status,410);}assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('deployed client and offline cache do not load retired modules or tables',async()=>{
 const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'),sw=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
 assert.ok(!/planner_messages|installCollaboration|startChatSync|state\.chat|state\.invites/.test(app));assert.ok(!/collaboration\.mjs|invite-model\.mjs/.test(sw));assert.match(app,/queueWeeklySchedule/);assert.match(app,/scheduleConfirmed\(snapshot\.serverIds/);
});
