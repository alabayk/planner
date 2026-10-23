// Isolated headless Chrome, local fixtures and mocked backend only; no user profile.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const fixture=pathname==='/__stub.js'?'ui-stub.js':pathname==='/__checks.js'?'ui-checks.js':null;
    const file=fixture?path.join(root,'tests/fixtures',fixture):path.join(root,'public',pathname==='/'?'index.html':pathname);
    if(!file.startsWith(root))throw Error('Invalid path');
    let body=await fs.readFile(file);
    if(pathname==='/')body=Buffer.from(body.toString('utf8').replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/__stub.js').replace('</body>','<script type="module" src="/__checks.js"></script></body>'));
    res.writeHead(200,{'Content-Type':(mime[path.extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'planner-smoke-'));
try{
  const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true});
  let launchError;child.on('error',error=>launchError=error);child.stdout.resume();child.stderr.resume();
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100));let port;
  let socket;
  try{
    for(let i=0;i<100&&!port;i++){if(launchError)throw launchError;try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}if(!port)await pause();}
    if(!port)throw Error('Browser did not start');
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let sequence=0;const pending=new Map();
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const job=pending.get(message.id);if(job){pending.delete(message.id);message.error?job.reject(Error(message.error.message)):job.resolve(message.result);}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setTimezoneOverride',{timezoneId:'Europe/Moscow'});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});let encoded;
    for(let i=0;i<300&&!encoded;i++){const reply=await send('Runtime.evaluate',{expression:'document.getElementById("smokeResults")?.dataset.result',returnByValue:true});encoded=reply.result?.value;if(!encoded)await pause();}
    if(!encoded)throw Error('Browser did not complete UI checks');
    const result=JSON.parse(decodeURIComponent(encoded));console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;
  }finally{socket?.close();child.kill();}
}finally{server.close();console.log('Isolated browser profile retained for diagnostics: '+profile);}
