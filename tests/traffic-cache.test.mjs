import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinkReader} from '../worker/link-store.mjs';
import {googleCacheStorage} from '../worker/google-cache.mjs';
import {trafficState,trafficBudget} from '../worker/traffic-meter.mjs';

test('cold link reader verifies revisions without redownloading signatures and fetches changed bodies',async()=>{
  const saved=new Map(),storage={get:async key=>structuredClone(saved.get(key)),set:async(key,value)=>saved.set(key,structuredClone(value))};
  const env={SUPABASE_URL:'https://link-cache.test',SUPABASE_SERVICE_ROLE_KEY:'key'},calls=[];
  let rows=[{planner_id:'a',version:1,updated_at:'one',planner_signature:'description'.repeat(100)}];
  const admin=async(_env,path)=>{
    const query=new URL('https://db.test/'+path).searchParams,select=query.get('select');calls.push(select);
    let matches=rows;if(query.has('planner_id'))matches=matches.filter(row=>query.get('planner_id').slice(4,-1).split(',').includes(row.planner_id));
    return matches.map(row=>select.startsWith('*')?{...row,id:row.planner_id}:{id:row.planner_id,version:row.version,updated_at:row.updated_at});
  };
  await createLinkReader(admin,{storage})(env,'owner');calls.length=0;
  assert.equal((await createLinkReader(admin,{storage})(env,'owner'))[0].planner_signature,rows[0].planner_signature);
  assert.deepEqual(calls,['id:planner_id,version,updated_at']);
  rows=[{...rows[0],version:2,planner_signature:'changed'}];calls.length=0;
  assert.equal((await createLinkReader(admin,{storage})(env,'owner'))[0].planner_signature,'changed');assert.equal(calls.length,2);
  rows=[];assert.deepEqual(await createLinkReader(admin,{storage})(env,'owner'),[]);
  calls.length=0;rows=[{planner_id:'b',version:1}];await createLinkReader(admin,{storage})(env,'other');assert.equal(calls.length,2);
});

test('link storage outage never prevents database synchronization',async()=>{
  const storage={get:async()=>{throw Error('cache down');},set:async()=>{throw Error('cache down');}};
  assert.deepEqual(await createLinkReader(async()=>[],{storage})({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'key'},'owner'),[]);
});

test('cache namespaces isolate snapshots and hash backend credentials out of cache URLs',async()=>{
  const previous=globalThis.caches,entries=new Map();
  globalThis.caches={default:{match:async key=>entries.get(key)?.clone(),put:async(key,value)=>entries.set(key,value),delete:async key=>entries.delete(key)}};
  try{
    const events=googleCacheStorage('planner-rows-v1'),links=googleCacheStorage('planner-links-v1'),key='https://db.test|private-credential';
    await events.set(key,{rows:[{id:'a'}]});assert.deepEqual(await events.get(key),{rows:[{id:'a'}]});assert.equal(await links.get(key),null);
    assert.ok([...entries.keys()].every(url=>!url.includes('private-credential')&&!url.includes('db.test')));
  }finally{if(previous===undefined)delete globalThis.caches;else globalThis.caches=previous;}
});

test('daily and monthly economy guards start before the hosting quota is close',()=>{
  const env={SUPABASE_URL:'https://early-budget.test',SUPABASE_SERVICE_ROLE_KEY:'key'},state=trafficState(env);
  state.total=221000000;state.dayTotal=50000000;assert.equal(trafficBudget(env).warning,true);assert.equal(trafficBudget(env).economy,false);
  state.dayTotal=100000000;assert.equal(trafficBudget(env).economy,true);
  state.dayTotal=0;state.total=2000000000;assert.equal(trafficBudget(env).economy,true);
});
