export class SessionRequired extends Error{constructor(){super('Сессия истекла. Войдите в Планер снова. Сохранённые данные и очередь изменений останутся на устройстве.');this.code='AUTH_REQUIRED';this.status=401;}}
const invalid=error=>error?.status===401||/refresh_token_not_found|refresh_token_already_used|invalid_grant|session_not_found|invalid_refresh_token/i.test(error?.code||'')||/invalid refresh token|refresh token.*(?:not found|already used)/i.test(error?.message||'');
export function createSessionManager(auth,{now=()=>Date.now()}={}){
  let running=null;
  async function read(force=false){
    const result=await auth.getSession();if(result.error){if(invalid(result.error))throw new SessionRequired();throw result.error;}
    let session=result.data?.session;if(!session)throw new SessionRequired();
    if(force||session.expires_at&&Number(session.expires_at)*1000<=now()+30000){
      if(!session.refresh_token)throw new SessionRequired();
      const refreshed=await auth.refreshSession();if(refreshed.error){if(invalid(refreshed.error))throw new SessionRequired();throw refreshed.error;}session=refreshed.data?.session;
    }
    if(!session?.access_token)throw new SessionRequired();return session;
  }
  async function requireSession(){if(running)return running;running=read();try{return await running;}finally{running=null;}}
  async function refresh(){if(running)await running;running=read(true);try{return await running;}finally{running=null;}}
  return {requireSession,refresh};
}
