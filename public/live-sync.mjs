// HTTP polling is the fallback when WebSocket upgrades cannot pass the proxy.
export function createLiveSync({run,isActive=()=>true,interval=30000,idleInterval=300000,maxInterval=900000,timers=globalThis,now=()=>Date.now()}){
  let running=null,timer=null,started=false,nextAt=0,delay=interval;
  async function tick(force=true){
    if(!isActive())return false;if(running)return running;if(!force&&now()<nextAt)return false;
    running=Promise.resolve().then(run).catch(()=>false);
    try{const result=await running;delay=result===false?Math.min(maxInterval,Math.max(interval*2,delay*2)):result?.changed===false?Math.min(idleInterval,Math.max(interval,delay*2)):interval;nextAt=now()+delay;return result;}
    finally{running=null;}
  }
  function start(){if(started)return;started=true;nextAt=now()+interval;timer=timers.setInterval(()=>tick(false),interval);}
  function stop(){if(timer!==null)timers.clearInterval(timer);timer=null;started=false;}
  return {start,stop,tick};
}
