import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInvitations,processInvitations} from '../worker/invitations.mjs';
import {readInvite} from '../public/invite-model.mjs';
const owner={id:'00000000-0000-4000-8000-000000000001',email:'vanya@planer.app'},recipient={id:'00000000-0000-4000-8000-000000000002',email:'ksusha@planer.app'},eventId='10000000-0000-4000-8000-000000000001';
function backend(){
  const rows=new Map([[eventId,{id:eventId,title:'Test',notes:'',starts_at:'2030-01-07T10:00:00Z',duration_minutes:60,space:'vanya',created_by:'vanya',deleted:false,version:1}]]),jobs=new Map();let failFinal=false;
  async function fetcher(input,init={}){
    const url=new URL(input),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
    if(url.pathname.endsWith('/admin/users'))return Response.json({users:[owner,recipient]});
    if(url.pathname.endsWith('/push_jobs')){if(!jobs.has(body.id))jobs.set(body.id,body);return Response.json({});}
    assert.ok(url.pathname.endsWith('/planner_events'));
    const id=url.searchParams.get('id')?.slice(3),version=url.searchParams.get('version')?.slice(3),row=rows.get(id);
    if(method==='POST'){if(rows.has(body.id))return Response.json([]);rows.set(body.id,body);return Response.json([body]);}
    if(method==='PATCH'){
      if(failFinal&&body.notes?.includes('"state":"accepted"')){failFinal=false;return new Response('<html>temporary</html>',{status:503});}
      if(!row||String(row.version)!==version)return Response.json([]);const next={...row,...body};rows.set(id,next);return Response.json([next]);
    }
    if(id)return Response.json(row?[row]:[]);
    const notes=url.searchParams.get('notes');return Response.json([...rows.values()].filter(value=>notes?value.notes.startsWith('[[invitation]]'):!value.deleted));
  }
  return {rows,jobs,fetcher,failFinal:()=>failFinal=true};
}
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'not-a-real-key'};
async function call(path,user,body){return handleInvitations(new Request('https://worker.test/invites/'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),env,user);}
test('send is idempotent; accept adds participation, decline removes only recipient',async()=>{
  const b=backend(),original=globalThis.fetch;globalThis.fetch=b.fetcher;
  try{
    assert.equal((await call('send',owner,{eventId,eventVersion:1})).status,200);assert.equal((await call('send',owner,{eventId,eventVersion:1})).status,200);
    assert.equal(b.rows.size,2);assert.equal(b.jobs.size,1);assert.equal(b.rows.get(eventId).space,'vanya');
    const item=(await (await call('list',recipient)).json()).items[0];assert.equal(item.incoming,true);assert.equal(b.rows.get(item.id).deleted,true);
    assert.equal((await call('respond',owner,{id:item.id,rev:item.rev,eventVersion:1,action:'accept'})).status,409);
    assert.equal((await call('respond',recipient,{id:item.id,rev:item.rev,eventVersion:1,action:'accept'})).status,200);
    assert.equal(b.rows.get(eventId).space,'shared');assert.match(b.rows.get(eventId).notes,/planner:both/);assert.equal(b.jobs.size,2);
    const accepted=(await (await call('list',recipient)).json()).items[0];
    assert.equal((await call('respond',recipient,{id:accepted.id,rev:accepted.rev,eventVersion:accepted.event.version,action:'decline'})).status,200);
    assert.equal(b.rows.get(eventId).space,'vanya');assert.equal(b.rows.get(eventId).deleted,false);assert.equal(b.rows.get(eventId).notes,'');
  }finally{globalThis.fetch=original;}
});
test('stale response does not overwrite source; cron recovers interrupted acceptance without duplicates',async()=>{
  const b=backend(),original=globalThis.fetch;globalThis.fetch=b.fetcher;
  try{
    await call('send',owner,{eventId,eventVersion:1});const item=(await (await call('list',recipient)).json()).items[0];
    assert.equal((await call('respond',recipient,{id:item.id,rev:item.rev,eventVersion:0,action:'accept'})).status,409);
    assert.equal(b.rows.get(eventId).version,1);b.failFinal();
    assert.equal((await call('respond',recipient,{id:item.id,rev:item.rev,eventVersion:1,action:'accept'})).status,503);
    assert.equal(b.rows.get(eventId).version,2);assert.ok(readInvite(b.rows.get(item.id)).op);
    await processInvitations(env);await processInvitations(env);
    assert.equal(b.rows.get(eventId).version,2);assert.equal(readInvite(b.rows.get(item.id)).state,'accepted');assert.equal(b.jobs.size,2);
  }finally{globalThis.fetch=original;}
});
test('unrecognized accounts cannot access invitations or private free-time data',async()=>{
  assert.equal((await call('list',{id:'x',email:'unknown@planer.app'})).status,401);
});
test('background badge reads no paired event bodies and returns no titles',async()=>{
  const b=backend(),original=globalThis.fetch,calls=[];globalThis.fetch=async(input,init)=>{calls.push(new URL(input));return b.fetcher(input,init);};
  try{await call('send',owner,{eventId,eventVersion:1});calls.length=0;const result=await call('status',recipient),body=await result.json();assert.deepEqual(body,{pending:1});assert.equal(calls.length,1);assert.equal(calls[0].searchParams.get('select'),'id,notes,created_by');assert.ok(calls[0].searchParams.get('or').includes('pending'));}finally{globalThis.fetch=original;}
});
