const unavailable='Сервер временно недоступен. Попробуйте обновить позже.';
export function publicError(error){const text=String(error?.message||error||'');if(/row.level security/i.test(text))return 'Запись отклонена правилами доступа. Проверьте профиль и видимость события.';if(error?.code==='42501'||/permission denied/i.test(text))return 'Нет прав доступа к данным. Нужно выполнить repair-access.sql в SQL Editor проекта. VPN эту ошибку не исправит.';if(/jwt expired|invalid jwt|refresh token.*(?:invalid|not found)/i.test(text))return 'Сессия истекла. Войдите в Планер снова.';return /<\s*!doctype|<\s*html|<\s*head|<\s*body|Unexpected token.*<|not valid JSON|JSON\.parse|Failed to fetch|Load failed|fetch failed/i.test(text)?unavailable:text.slice(0,240)||unavailable;}
export async function jsonResponse(response){
  const text=await response.text();let result;
  try{if(/^\s*</.test(text))throw Error();result=text?JSON.parse(text):{};}catch{const error=new Error(unavailable);error.status=response.status||502;throw error;}
  if(!response.ok){const error=new Error(publicError(result.error?.message||result.error||result.message||(response.status===401?'Сессия истекла. Войдите снова.':unavailable)));error.status=response.status;throw error;}
  return result;
}
export async function apiJson(url,options={}){
  const {timeout=20000,...init}=options,controller=new AbortController(),abort=()=>controller.abort();
  if(init.signal){if(init.signal.aborted)controller.abort();else init.signal.addEventListener('abort',abort,{once:true});}
  const timer=setTimeout(abort,timeout);
  try{return await jsonResponse(await fetch(url,{...init,cache:'no-store',headers:{Accept:'application/json',...init.headers},signal:controller.signal}));}
  catch(error){if(error.status)throw error;throw new Error(publicError(error?.name==='AbortError'?unavailable:error));}
  finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}
export async function safeSupabaseFetch(input,init){
  const controller=new AbortController(),parent=init?.signal||(typeof input==='object'?input.signal:null),abort=()=>controller.abort(),timer=setTimeout(abort,12000);
  if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
  try{
    const response=await fetch(input,{...init,signal:controller.signal,cache:'no-store'}),type=response.headers.get('content-type')||'';
    if(type.includes('text/html')||/^\s*</.test(await response.clone().text()))return new Response(JSON.stringify({message:unavailable,error:unavailable,code:'SERVICE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    return response;
  }catch{return new Response(JSON.stringify({message:unavailable,error:unavailable,code:'SERVICE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
  finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}
