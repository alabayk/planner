import test from 'node:test';import assert from 'node:assert/strict';
import {refreshWithCalendar} from '../public/refresh-result.mjs';
import {syncCalendars} from '../worker/calendar.js';
test('a Google failure does not label a successful database refresh as failed',async()=>{
 let reads=0;const result=await refreshWithCalendar({sync:async()=>{reads++;return true;},calendar:async()=>{throw Error('Google unavailable');}});
 assert.equal(reads,2);assert.equal(result.latest,true);assert.match(result.calendarError.message,/Google unavailable/);
});
test('an initial database failure never claims a successful refresh',async()=>{
 let calls=0;await assert.rejects(refreshWithCalendar({sync:async()=>false,calendar:async()=>calls++}),/базы/);assert.equal(calls,0);
});
test('manual owner sync ignores an unrelated expired account; cron still reports its failure',async()=>{
 const original=globalThis.fetch,log=console.error;console.error=()=>{};
 const env={SUPABASE_URL:'https://scoped.test',SUPABASE_SERVICE_ROLE_KEY:'key',GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret'};
 globalThis.fetch=async input=>{const url=String(input);if(url.includes('planner_google_tokens'))return Response.json([{owner:'self',calendar_id:'cal',access_token:'token',expires_at:Date.now()+600000},{owner:'other',calendar_id:'bad',expires_at:0,refresh_token:'expired'}]);if(url.includes('oauth2.googleapis'))return Response.json({error:'invalid_grant'},{status:400});if(url.includes('googleapis.com/calendar'))return Response.json({items:[]});return Response.json([]);};
 try{assert.equal((await syncCalendars(env,{owner:'self'})).ok,true);const cron=await syncCalendars(env);assert.equal(cron.ok,false);assert.equal(cron.failed,1);}finally{globalThis.fetch=original;console.error=log;}
});
