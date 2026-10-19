const unavailable='Сервер временно недоступен. Попробуйте обновить позже.';
export function publicError(error){const text=String(error?.message||error||'');return /<\s*!doctype|<\s*html|<\s*head|<\s*body|Unexpected token.*<|not valid JSON|JSON\.parse|Failed to fetch|Load failed|fetch failed/i.test(text)?unavailable:text.slice(0,240)||unavailable;}
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
  try{
    const response=await fetch(input,init),type=response.headers.get('content-type')||'';
    if(type.includes('text/html')||/^\s*</.test(await response.clone().text()))return new Response(JSON.stringify({message:unavailable,error:unavailable,code:'SERVICE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    return response;
  }catch{return new Response(JSON.stringify({message:unavailable,error:unavailable,code:'SERVICE_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
}
