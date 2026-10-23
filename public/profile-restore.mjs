// A saved profile is only a local UI hint. Server operations still validate Auth.
export function createProfileRestore({storage,profiles,requireSession,onRestore,onChoose,onSlow,timers=globalThis,slowAfter=4000}){
  let cancelled=false,running=null,timer=null;
  const clear=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null;};
  async function restore(){
    const cached=storage.getItem('planner-last-profile');
    if(profiles.includes(cached)){await onRestore(cached);return true;}
    timer=timers.setTimeout(()=>{if(!cancelled)onSlow();},slowAfter);
    let session;
    try{session=await requireSession();}
    catch{if(!cancelled)onChoose();return false;}
    finally{clear();}
    if(cancelled)return false;
    const profile=profiles.find(value=>session.user?.email===value+'@planer.app');
    if(!profile){onChoose();return false;}
    storage.setItem('planner-last-profile',profile);
    await onRestore(profile);return true;
  }
  return {
    start(){return running||(running=restore());},
    choose(){cancelled=true;clear();onChoose();},
  };
}
