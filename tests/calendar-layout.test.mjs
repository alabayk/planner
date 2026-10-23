import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const layout=vm.runInNewContext('('+app.split('\n').find(line=>line.startsWith('function calendarLaneLayout('))+')');
test('overlapping day events occupy distinct lanes rather than covering each other',()=>{
  const items=layout([{start:0,end:60},{start:30,end:90},{start:60,end:120}]);
  assert.deepEqual(Array.from(items,item=>item.lanes),[2,2,2]);
  for(const a of items)for(const b of items)if(a!==b&&a.start<b.end&&b.start<a.end)assert.notEqual(a.lane,b.lane);
});
test('back-to-back day events reuse a single lane',()=>{
  const items=layout([{start:0,end:60},{start:60,end:120}]);assert.ok(items.every(item=>item.lanes===1&&item.lane===0));
});
test('separate overlap groups regain full column width',()=>{
  const items=layout([{start:0,end:60},{start:10,end:30},{start:120,end:150}]);assert.equal(items.at(-1).lanes,1);
});
