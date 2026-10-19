import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeFields,sameFields,importId} from '../public/sync-core.mjs';
import {readSignature,reconnectNeeded,stableImportedRow} from '../worker/calendar-safety.mjs';
const base={title:'Встреча',notes:'',startsAt:'2026-10-20T10:00:00Z',durationMinutes:60,space:'shared',createdBy:'owner',done:false,deleted:false};
test('different fields are merged without losing either edit',()=>{
  const result=mergeFields(base,{...base,title:'Новое название'},{...base,startsAt:'2026-10-20T11:00:00Z'});
  assert.deepEqual(result.conflicts,[]);assert.equal(result.merged.title,'Новое название');assert.equal(result.merged.startsAt,'2026-10-20T11:00:00Z');
});
test('same-field divergence requires a choice and keeps source snapshots',()=>{
  const local={...base,title:'Вариант 1'},remote={...base,title:'Вариант 2'};
  assert.deepEqual(mergeFields(base,local,remote).conflicts,['title']);assert.equal(local.title,'Вариант 1');assert.equal(remote.title,'Вариант 2');
});
test('identical edits are idempotent',()=>{const changed={...base,done:true};assert.deepEqual(mergeFields(base,changed,changed).conflicts,[]);assert.ok(sameFields(changed,{...changed,version:5}));});
test('delete versus edit never silently discards the edit',()=>{assert.ok(mergeFields(base,{...base,deleted:true},{...base,notes:'New note'}).conflicts.includes('deleted'));});
test('Google imports have stable valid UUIDs scoped to account and source ID',async()=>{
  const id=await importId('owner','google-1');assert.equal(id,await importId('owner','google-1'));assert.notEqual(id,await importId('other','google-1'));assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('an interrupted old import is recovered instead of inserted again',async()=>{
  const fields={title:'Class',notes:'',starts_at:'2026-10-20T10:00:00Z',duration_minutes:90};
  const row={id:'old-id',...fields,created_by:'owner',deleted:false};
  assert.equal((await stableImportedRow('owner',{id:'google-1'},fields,[row])).id,'old-id');
});
test('legacy signatures remain readable until next successful sync',()=>{assert.deepEqual(readSignature('old-hash'),{hash:'old-hash',base:null});assert.deepEqual(readSignature(JSON.stringify({format:2,hash:'h',base:{title:'t'}})).base,{title:'t'});});
test('only authorization errors request reconnection',()=>{assert.ok(reconnectNeeded(new Error('Google token 400: invalid_grant')));assert.ok(reconnectNeeded('Google 401: expired'));assert.ok(!reconnectNeeded('Google 503: temporary outage'));});
