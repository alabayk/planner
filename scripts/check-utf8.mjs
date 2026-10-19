import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../public/',import.meta.url);
let checked=0;
for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isFile()||! /\.(m?js|html|css|webmanifest|svg)$/.test(entry.name))continue;
  const file=new URL(entry.name,root),text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file));
  if(/\uFFFD|ђ|Рџ|Р»Р|СЃС/.test(text))throw new Error(`Damaged UTF-8 text: ${fileURLToPath(file)}`);
  checked++;
}
const index=await readFile(new URL('index.html',root),'utf8');
if(!index.includes('Кто ты?')||!index.includes('charset="utf-8"'))throw new Error('Russian login text or UTF-8 declaration missing');
console.log(`UTF-8 verified: ${checked} public files`);
