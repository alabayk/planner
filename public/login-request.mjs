// Never retry a password request while the previous SDK request may still hold
// the Auth lock. The transport has its own abort; this deadline only bounds UI.
export function createLoginRequest(auth,{timeout=20000,timers=globalThis}={}){
  let pending=null;
  return function signIn(email,password){
    if(pending)return pending.visible;
    const entry={};pending=entry;
    const request=Promise.resolve().then(()=>auth.signInWithPassword({email,password})).then(result=>{if(result.error)throw result.error;return result;});
    request.then(()=>{if(pending===entry)pending=null;},()=>{if(pending===entry)pending=null;});
    let timer;
    entry.visible=Promise.race([request,new Promise((_,reject)=>{timer=timers.setTimeout(()=>{const error=new Error('AUTH_TIMEOUT');error.code='AUTH_TIMEOUT';reject(error);},timeout);})]).finally(()=>timers.clearTimeout(timer));
    return entry.visible;
  };
}
