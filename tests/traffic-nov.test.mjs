import test from 'node:test';import assert from 'node:assert/strict';
import {createGoogleDeltaReader} from '../worker/google-delta.mjs';
import {meteredFetch,flushTraffic,trafficBudget,trafficState} from '../worker/traffic-meter.mjs';
import {createLinkReader} from '../worker/link-store.mjs';
test('a new isolate restores the Google cursor together with its complete snapshot',async()=>{
 let saved;const storage={get:async()=>saved,set:async(_key,value)=>saved=structuredClone(value),delete:async()=>saved=null};
 await createGoogleDeltaReader({storage})('cal',async()=>({items:[{id:'kept'}],nextSyncToken:'persisted'}),async()=>[]);
 let cursor;const rows=await createGoogleDeltaReader({storage})('cal',async query=>{cursor=query.syncToken;return {items:[],nextSyncToken:'next'};},async()=>[]);
 assert.equal(cursor,'persisted');assert.equal(rows.has('kept'),true);
});
test('Google delta retains unchanged items, cancellations and uses a stable cursor on every page',async()=>{
 const read=createGoogleDeltaReader(),calls=[];let stage=0;
 const list=async query=>{calls.push(query);if(!stage)return {items:[{id:'a'},{id:'b'}],nextSyncToken:'first'};if(!query.pageToken)return {items:[{id:'a',status:'cancelled'}],nextPageToken:'page2'};return {items:[{id:'c'}],nextSyncToken:'last'};};
 await read('cal',list,async()=>[]);stage=1;const rows=await read('cal',list,async()=>[]);assert.equal(rows.size,3);assert.equal(rows.get('a').status,'cancelled');assert.equal(calls[1].syncToken,'first');assert.equal(calls[2].syncToken,'first');
});
test('expired Google cursor rebuilds the snapshot, while failed pages never advance it',async()=>{
 const read=createGoogleDeltaReader();await read('cal',async()=>({items:[{id:'old'}],nextSyncToken:'old'}),async()=>[]);
 const rows=await read('cal',async query=>{if(query.syncToken)throw Error('Google 410: gone');return {items:[{id:'new'}],nextSyncToken:'new'};},async()=>[]);assert.deepEqual([...rows.keys()],['new']);
 await assert.rejects(read('cal',async()=>{throw Error('Google 503: down');},async()=>[]),/503/);
 let cursor;await read('cal',async query=>{cursor=query.syncToken;return {items:[],nextSyncToken:'recovered'};},async()=>[]);assert.equal(cursor,undefined);
});
test('changed recurring master removes old instances before rebuilding',async()=>{
 const read=createGoogleDeltaReader();let run=0;
 const list=async()=>({items:[{id:'series',recurrence:['RRULE:FREQ=DAILY']}],nextSyncToken:'cursor'+run});
 await read('cal',list,async()=>[{id:'old',recurringEventId:'series'}]);run++;
 const rows=await read('cal',list,async()=>[{id:'new',recurringEventId:'series'}]);assert.deepEqual([...rows.keys()],['new']);
});
test('missing link migration uses the legacy read rather than breaking sync',async()=>{
 let checks=0,full=0;const read=createLinkReader(async(_env,path)=>{if(path.includes('version')){checks++;throw Error('Database 400: 42703 version missing');}full++;return [];});
 const env={SUPABASE_URL:'https://legacy.invalid',SUPABASE_SERVICE_ROLE_KEY:'key'};await read(env,'self');await read(env,'self');assert.equal(checks,1);assert.equal(full,2);
});
test('meter retries the same batch id and enables budget mode without blocking reminders',async()=>{
 const original=globalThis.fetch,env={SUPABASE_URL:'https://meter.invalid',SUPABASE_SERVICE_ROLE_KEY:'key'},ids=[];let fail=true;
 globalThis.fetch=async(_url,init)=>{if(init?.body){ids.push(JSON.parse(init.body).batch_id);if(fail)return Response.json({}, {status:503});return Response.json({bytes:4000000001});}return Response.json({ok:true});};
 try{await meteredFetch(env,env.SUPABASE_URL+'/rest/v1/planner_events');await flushTraffic(env);fail=false;trafficState(env).retryAt=0;await flushTraffic(env);assert.equal(ids[0],ids[1]);assert.equal(trafficBudget(env).economy,true);assert.equal(trafficBudget(env).measured,true);}finally{globalThis.fetch=original;}
});
