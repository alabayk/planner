import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCompactSnapshot} from '../public/compact-sync.mjs';
import {calendarSyncDue} from '../worker/traffic-policy.mjs';
const row=(id,version=1)=>({id,version,updated_at:'2026-10-21T10:00:00Z',notes:'Long description '.repeat(30),title:'Event',deleted:false});
const convert=record=>({...record,updatedAt:record.updated_at});
function fixture(rows){
 const calls=[];let failBodies=false;
 return {calls,fail(){failBodies=true;},client:{from(table){const query={table,selection:'*',after:'',limit:Infinity,ids:null,active:false,exclude:false};return {
 select(value){query.selection=value;return this;},order(){return this;},limit(n){query.limit=n;return this;},eq(key,value){if(key==='deleted'&&value===false)query.active=true;return this;},not(){query.exclude=true;return this;},gt(key,value){assert.equal(key,'id');query.after=value;return this;},in(key,ids){assert.equal(key,'id');query.ids=ids;return this;},
 then(resolve,reject){calls.push({...query});if(failBodies&&query.selection==='*')return Promise.resolve({error:Error('offline')}).then(resolve,reject);let data=rows.filter(r=>(!query.active||!r.deleted)&&(!query.exclude||!r.notes.startsWith('[[invitation]]'))&&(!query.after||r.id>query.after)&&(!query.ids||query.ids.includes(r.id))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,query.limit);if(query.selection!=='*')data=data.map(r=>Object.fromEntries(query.selection.split(',').map(key=>[key,r[key]])));return Promise.resolve({data,error:null}).then(resolve,reject);}
 };}}};
}
test('unchanged poll transfers revisions only, without downloading titles and descriptions',async()=>{
 const rows=[row('a'),row('b')],f=fixture(rows),snapshot=await readCompactSnapshot(f.client,{table:'planner_events',cached:rows.map(convert),fromRow:convert,activeOnly:true});
 assert.equal(snapshot.downloaded,0);assert.equal(snapshot.changed,false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].selection,'id,version,updated_at');assert.equal(snapshot.rows[0].notes,rows[0].notes);
});
test('only changed and new bodies are loaded; absent and inaccessible IDs are removed',async()=>{
 const rows=[row('a',2),row('b'),row('c')],f=fixture(rows),cached=[convert(row('a')),convert(row('b')),convert(row('gone'))];
 const result=await readCompactSnapshot(f.client,{table:'planner_events',cached,fromRow:convert,activeOnly:true});assert.equal(result.downloaded,2);assert.deepEqual(f.calls.filter(c=>c.ids).flatMap(c=>c.ids),['a','c']);assert.deepEqual(result.rows.map(r=>r.id),['a','b','c']);
});
test('keyset pagination does not stop at a default API page limit',async()=>{
 const rows=Array.from({length:7},(_,i)=>row(String(i))),f=fixture(rows);const result=await readCompactSnapshot(f.client,{table:'planner_events',pageSize:3,activeOnly:true});assert.equal(result.rows.length,7);assert.deepEqual(f.calls.filter(c=>!c.ids).map(c=>c.after),['','2','5']);
});
test('soft-deleted and internal invitation records do not download bodies',async()=>{
 const rows=[row('a'),{...row('b'),deleted:true},{...row('c'),notes:'[[invitation]]{}'}],f=fixture(rows);const result=await readCompactSnapshot(f.client,{table:'planner_events',activeOnly:true});assert.deepEqual(result.rows.map(r=>r.id),['a']);
});
test('offline chat messages with an old creation date are not skipped',async()=>{
 const rows=[{id:'a',created_at:'2026-10-21',body:'known'},{id:'b',created_at:'2026-09-01',body:'sent after offline'}],f=fixture(rows);const result=await readCompactSnapshot(f.client,{table:'planner_messages',metadata:'id',cached:[rows[0]]});assert.equal(result.rows.length,2);assert.deepEqual(f.calls[1].ids,['b']);
});
test('failed body request never returns a partial snapshot for cache replacement',async()=>{
 const f=fixture([row('a',2)]);f.fail();await assert.rejects(readCompactSnapshot(f.client,{table:'planner_events',cached:[convert(row('a'))]}),/offline/);
});
test('manual full refresh can recover a row edited without its revision changing',async()=>{
 const f=fixture([row('a')]);const result=await readCompactSnapshot(f.client,{table:'planner_events',cached:[convert(row('a'))],force:true});assert.equal(result.downloaded,1);
});
test('heavy calendar scan runs every five minutes, not on every reminder tick',()=>{
 const base=Date.UTC(2026,9,21,12,0);assert.equal(calendarSyncDue(base),true);for(let minute=1;minute<5;minute++)assert.equal(calendarSyncDue(base+minute*60000),false);assert.equal(calendarSyncDue(base+300000),true);
});
test('live timer is started at application startup, not only at midnight',async()=>{
 const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.split('\n').find(line=>line.startsWith('async function start(){'));assert.match(start,/liveSync\.start\(\)/);assert.ok(!start.includes("addEventListener('online',sync)"));
});
