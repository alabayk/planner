import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createProfileRestore} from '../public/profile-restore.mjs';

function fixture({cached,requireSession=async()=>({user:{email:'self@planer.app'}})}={}){
  const saved=new Map(cached?[['planner-last-profile',cached]]:[]),opened=[],chosen=[],slow=[];
  let timer=null;const controller=createProfileRestore({profiles:['self','other'],storage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},requireSession,
    onRestore:async profile=>opened.push(profile),onChoose:()=>chosen.push(true),onSlow:()=>slow.push(true),
    timers:{setTimeout(fn){timer=fn;return 1;},clearTimeout(){timer=null;}}});
  return {controller,saved,opened,chosen,slow,elapsed(){timer?.();}};
}
test('remembered profile opens the calendar immediately without waiting for Auth/network',async()=>{
  let requests=0;const f=fixture({cached:'self',requireSession:async()=>{requests++;throw Error('offline');}});
  await f.controller.start();assert.deepEqual(f.opened,['self']);assert.equal(requests,0);assert.equal(f.chosen.length,0);
});
test('existing session from an earlier version restores the profile without showing the chooser',async()=>{
  const f=fixture();await Promise.all([f.controller.start(),f.controller.start()]);
  assert.deepEqual(f.opened,['self']);assert.equal(f.saved.get('planner-last-profile'),'self');assert.equal(f.chosen.length,0);
});
test('slow session recovery offers manual entry but never flashes the profile chooser',async()=>{
  let finish;const f=fixture({requireSession:()=>new Promise(resolve=>finish=resolve)}),pending=f.controller.start();
  f.elapsed();assert.equal(f.slow.length,1);assert.equal(f.chosen.length,0);
  finish({user:{email:'self@planer.app'}});await pending;assert.deepEqual(f.opened,['self']);assert.equal(f.chosen.length,0);
});
test('manual entry cannot be interrupted by a late session restore',async()=>{
  let finish;const f=fixture({requireSession:()=>new Promise(resolve=>finish=resolve)}),pending=f.controller.start();
  f.controller.choose();finish({user:{email:'self@planer.app'}});await pending;
  assert.equal(f.chosen.length,1);assert.equal(f.opened.length,0);assert.equal(f.saved.size,0);
});
test('missing session and unknown identities show the chooser instead of opening another profile',async()=>{
  for(const requireSession of [async()=>{throw Error('AUTH_REQUIRED');},async()=>({user:{email:'self@unrelated.test'}})]){
    const f=fixture({requireSession});await f.controller.start();assert.equal(f.opened.length,0);assert.equal(f.chosen.length,1);
  }
});
test('initial HTML hides the chooser and offline cache includes the new restore code',async()=>{
  const index=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8'),sw=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(index,/<section id="chooser" hidden>/);assert.match(index,/id="sessionLoading"/);assert.match(sw,/'\.\/profile-restore\.mjs'/);
  assert.match(index,/app\.js\?v=73/);assert.match(sw,/app\.js\?v=73/);
});
