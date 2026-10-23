import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarSnapshotReader} from '../worker/calendar-store.mjs';
import {syncCalendars} from '../worker/calendar.js';

const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'key'};
const event=(id,version=1)=>({id,version,updated_at:'2026-10-23T10:00:00Z',title:'Event',notes:'Long description '.repeat(100),deleted:false});
function fixture(initial){
  let rows=initial,fail=false;const calls=[];
  return {calls,set(value){rows=value;},fail(value){fail=value;},async admin(_env,path){
    const url=new URL('https://db.test/'+path),q=url.searchParams,selection=q.get('select');calls.push({selection,path});
    if(fail&&selection==='*')throw Error('network unavailable');
    let result=rows.filter(row=>!q.has('id')||(q.get('id').startsWith('gt.')?row.id>q.get('id').slice(3):q.get('id').slice(4,-1).split(',').includes(row.id)))
      .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Number(q.get('limit')||Infinity));
    return structuredClone(selection==='*'?result:result.map(row=>Object.fromEntries(selection.split(',').map(key=>[key,row[key]]))));
  }};
}
test('warm server calendar cycle transfers revisions only; changed/new/deleted rows are retained correctly',async()=>{
  const f=fixture([event('a'),event('b')]),read=createCalendarSnapshotReader(f.admin);
  await read(env);f.calls.length=0;
  const unchanged=await read(env);assert.equal(unchanged.length,2);assert.deepEqual(f.calls.map(c=>c.selection),['id,version,updated_at']);
  f.set([{...event('a',2),title:'Changed'},event('c'),{...event('b',2),deleted:true}]);f.calls.length=0;
  const updated=await read(env);assert.equal(updated.find(r=>r.id==='a').title,'Changed');assert.equal(updated.find(r=>r.id==='b').deleted,true);assert.equal(updated.length,3);
  assert.equal(f.calls.filter(c=>c.selection==='*').length,1);
  f.set([event('c')]);assert.deepEqual((await read(env)).map(r=>r.id),['c']);
});
test('server cache includes rows beyond default page limits',async()=>{
  const rows=Array.from({length:1001},(_,i)=>event(String(i).padStart(4,'0'))),f=fixture(rows),read=createCalendarSnapshotReader(f.admin);
  assert.equal((await read(env)).length,1001);assert.equal(f.calls.filter(c=>c.selection!=='*').length,3);
  f.calls.length=0;assert.equal((await read(env)).length,1001);assert.equal(f.calls.filter(c=>c.selection==='*').length,0);
});
test('manual and periodic rebuild recover edits without revision changes',async()=>{
  let clock=0;const f=fixture([event('a')]),read=createCalendarSnapshotReader(f.admin,{now:()=>clock,fullRefreshMs:100});
  await read(env);f.set([{...event('a'),title:'Unversioned edit'}]);assert.equal((await read(env))[0].title,'Event');
  assert.equal((await read(env,{force:true}))[0].title,'Unversioned edit');
  f.set([{...event('a'),title:'Later edit'}]);clock=101;assert.equal((await read(env))[0].title,'Later edit');
});
test('failed body reads never return stale data and next read rebuilds safely',async()=>{
  const f=fixture([event('a')]),read=createCalendarSnapshotReader(f.admin);await read(env);
  f.set([event('a',2)]);f.fail(true);await assert.rejects(read(env),/network/);
  f.fail(false);assert.equal((await read(env))[0].version,2);
});
test('cache does not cross backend credentials and cached rows cannot be mutated by consumers',async()=>{
  const f=fixture([event('a')]),read=createCalendarSnapshotReader(f.admin);
  const rows=await read(env);rows[0].title='local mutation';assert.equal((await read(env))[0].title,'Event');
  f.calls.length=0;await read({...env,SUPABASE_SERVICE_ROLE_KEY:'rotated'});assert.equal(f.calls.filter(c=>c.selection==='*').length,1);
});
test('oversized snapshots are not retained in worker memory',async()=>{
  const f=fixture([event('a')]),read=createCalendarSnapshotReader(f.admin,{maxBytes:10});await read(env);f.calls.length=0;
  await read(env);assert.equal(f.calls.filter(c=>c.selection==='*').length,1);
});
test('overlapping calendar cycles share one backend read and one Google scan',async()=>{
  const original=globalThis.fetch;let tokenReads=0,googleReads=0;
  const settings={...env,SUPABASE_URL:'https://concurrent.test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'};
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/planner_google_tokens')){tokenReads++;return Response.json([{owner:'self',calendar_id:'calendar',access_token:'token',expires_at:Date.now()+600000}]);}
    if(url.includes('/planner_events')||url.includes('/planner_google_links'))return Response.json([]);
    if(url.includes('googleapis.com')){googleReads++;return Response.json({items:[]});}
    throw Error('Unexpected request');
  };
  try{await Promise.all([syncCalendars(settings),syncCalendars(settings),syncCalendars(settings)]);assert.equal(tokenReads,1);assert.equal(googleReads,1);}
  finally{globalThis.fetch=original;}
});
