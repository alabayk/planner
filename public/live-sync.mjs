// HTTP polling is the fallback when WebSocket upgrades cannot pass the proxy.
export function createLiveSync({run,isActive=()=>true,interval=30000,timers=globalThis}){
  let running=null,timer=null,started=false;
  async function tick(){
    if(!isActive())return false;if(running)return running;
    running=Promise.resolve().then(run).catch(()=>false);
    try{return await running;}finally{running=null;}
  }
  function start(){if(started)return;started=true;timer=timers.setInterval(tick,interval);}
  function stop(){if(timer!==null)timers.clearInterval(timer);timer=null;started=false;}
  return {start,stop,tick};
}
