import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {jsonResponse,safeSupabaseFetch,publicError} from '../public/api.mjs';
import {checkedJson} from '../worker/api-errors.mjs';

test('HTML and malformed API responses are replaced with a readable error',async()=>{
  for(const text of ['<!DOCTYPE html><html>gateway error</html>','not json']){
    await assert.rejects(jsonResponse(new Response(text)),error=>!error.message.includes('<')&&error.message.includes('Сервер'));
    await assert.rejects(checkedJson(new Response(text)),/Сервер/);
  }
  assert.equal((await jsonResponse(Response.json({ok:true}))).ok,true);
  assert.ok(!publicError('502 <!doctype html>').includes('doctype'));
});
test('Supabase transport does not expose an HTML gateway response',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>unavailable</html>',{status:502});
  try{const result=await safeSupabaseFetch('https://example.test');assert.equal(result.status,503);assert.equal((await result.json()).code,'SERVICE_UNAVAILABLE');}finally{globalThis.fetch=original;}
});
test('offline service worker only substitutes HTML for page navigation, never API or JS',async()=>{
  const handlers={},shell=new Response('<html>cached app</html>',{headers:{'Content-Type':'text/html'}}),puts=[];
  const cache={match:async request=>new URL(typeof request==='string'?request:request.url||request.href).pathname==='/planner/'?shell.clone():undefined,put:async(...args)=>puts.push(args)};
  vm.runInNewContext(await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,Response,console,self:{location:new URL('https://example.test/planner/sw.js'),addEventListener:(type,fn)=>handlers[type]=fn},caches:{open:async()=>cache},fetch:async()=>{throw Error('offline');}});
  const call=async request=>{let result;handlers.fetch({request,respondWith:promise=>result=promise});return result&&await result;};
  assert.equal(await call({url:'https://api.example.test/google/status',method:'GET',mode:'cors'}),undefined);
  assert.equal(await call({url:'https://example.test/sb/rest/v1/events',method:'GET',mode:'cors'}),undefined);
  const script=await call({url:'https://example.test/planner/api.mjs',method:'GET',mode:'cors'});assert.equal(script.status,503);assert.ok(!(await script.text()).includes('<html'));
  const page=await call({url:'https://example.test/planner/?view=invites',method:'GET',mode:'navigate'});assert.match(await page.text(),/cached app/);assert.equal(puts.length,0);
});
test('offline update retains the previous SDK cache instead of activating a broken app shell',async()=>{
  const source=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  for(const available of [true,false]){
    const handlers={},stored=[],sdk=new Response('window.supabase={}',{headers:{'Content-Type':'text/javascript'}});
    const cache={put:async(url)=>stored.push(String(url))};
    vm.runInNewContext(source,{URL,Response,console,self:{location:new URL('https://example.test/planner/sw.js'),addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:async()=>{}},
      caches:{open:async()=>cache,match:async()=>available?sdk.clone():undefined},fetch:async url=>{if(String(url).includes('cdn.jsdelivr.net'))throw Error('CDN offline');return new Response('asset',{headers:{'Content-Type':'text/javascript'}});}});
    let installed;handlers.install({waitUntil(value){installed=value;}});
    if(available){await installed;assert.ok(stored.some(url=>url.includes('cdn.jsdelivr.net')));}
    else await assert.rejects(installed,/Offline SDK unavailable/);
  }
});
