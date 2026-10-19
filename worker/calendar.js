import {googleBody,plannerFields} from './google-event-model.mjs';
import {CALENDAR_FIELDS,calendarSnapshot,readSignature,recordConflict,compareAndSet,stableImportedRow,mergeCalendar,reconnectNeeded} from './calendar-safety.mjs';
const GOOGLE = "https://www.googleapis.com/calendar/v3";
const BOTH = "\n[[planner:both]]";
const MAX_WRITES = 10;

const ownerOf = user => (user?.email || "").split("@")[0];
const ordinary = row => row.notes !== "__todo__" && !(row.notes || "").startsWith("[[deadline]]");
const shared = row => row.space === "shared" && (row.notes || "").includes(BOTH);
const wanted = (row, owner) => row.created_by === owner || shared(row);
const cleanNotes = value => (value || "").replace(BOTH, "").replace(/\n?\[\[series:[^\]]+\]\]/g, "").trim();

async function hash(row) {
  const value = JSON.stringify([row.title, row.notes || "", row.starts_at, row.duration_minutes, row.deleted]);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function admin(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`Database ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function google(url, token, init = {}) {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`,
    "content-type": "application/json", ...(init.headers || {}) } });
  if (!response.ok && response.status !== 204) throw new Error(`Google ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function accessToken(env, token) {
  if (token.access_token && Number(token.expires_at) > Date.now() + 60000) return token.access_token;
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: token.refresh_token, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!response.ok) throw new Error(`Google token ${response.status}: ${await response.text()}`);
  const result = await response.json();
  await admin(env, `planner_google_tokens?owner=eq.${encodeURIComponent(token.owner)}`, { method: "PATCH",
    body: JSON.stringify({ access_token: result.access_token, expires_at: Date.now() + result.expires_in * 1000, updated_at: new Date().toISOString() }) });
  return result.access_token;
}

const eventUrl = (calendar, id = "") => `${GOOGLE}/calendars/${encodeURIComponent(calendar)}/events${id ? "/" + encodeURIComponent(id) : ""}`;

async function listEvents(token, calendar) {
  const events = new Map(); let pageToken = "";
  do {
    const query = new URLSearchParams({ maxResults: "2500", showDeleted: "true" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await google(`${eventUrl(calendar)}?${query}`, token);
    for(const event of page.items||[]){
      if(!event.recurrence||event.status==='cancelled'){events.set(event.id,event);continue;}
      let instancePage='';const from=new Date();from.setDate(from.getDate()-31);const to=new Date();to.setFullYear(to.getFullYear()+1);
      do{
        const params=new URLSearchParams({maxResults:'2500',showDeleted:'true',timeMin:from.toISOString(),timeMax:to.toISOString()});if(instancePage)params.set('pageToken',instancePage);
        const instances=await google(`${eventUrl(calendar,event.id)}/instances?${params}`,token);
        for(const instance of instances.items||[])events.set(instance.id,instance);instancePage=instances.nextPageToken||'';
      }while(instancePage);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return events;
}

async function saveLink(env, row, owner, event) {
  await admin(env, "planner_google_links?on_conflict=planner_id,owner", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ planner_id: row.id, owner,
      google_id: event.id, planner_signature: JSON.stringify({format:2,hash:await hash(row),base:calendarSnapshot(row),recurring:!!event.recurringEventId}), google_etag: event.etag || null }) });
}
async function conflict(env, plannerId, owner, reason) {
  await admin(env, "planner_google_conflicts", { method: "POST", body: JSON.stringify({ planner_id: plannerId, owner, reason }) });
}

async function syncOwner(env, tokenRow) {
  const owner=tokenRow.owner,token=await accessToken(env,tokenRow),calendar=tokenRow.calendar_id;
  if(!calendar)return;
  const [rows,links]=await Promise.all([admin(env,'planner_events?select=*&order=id'),admin(env,`planner_google_links?select=*&owner=eq.${encodeURIComponent(owner)}`)]);
  const remote=await listEvents(token,calendar),byId=new Map(rows.map(row=>[row.id,row])),byPlanner=new Map(links.map(link=>[link.planner_id,link])),linkedGoogle=new Set(links.map(link=>link.google_id));
  let writes=0;
  for(const [googleId,event]of remote){
    if(writes>=MAX_WRITES)break;
    if(linkedGoogle.has(googleId)||event.status==='cancelled')continue;
    const known=byId.get(event.extendedProperties?.private?.plannerId);
    if(known){if(wanted(known,owner)){await saveLink(env,known,owner,event);writes++;}continue;}
    try{
      const fields=plannerFields(event),{id,prior}=await stableImportedRow(owner,event,fields,rows.filter(candidate=>!byPlanner.has(candidate.id)));
      let row=prior;
      if(!row){
        const inserted=await admin(env,'planner_events?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id,...fields,space:'shared',created_by:owner,done:false,deleted:false,version:1,updated_at:new Date().toISOString()})});
        row=inserted[0]||(await admin(env,`planner_events?id=eq.${id}&select=*`))[0];
      }
      if(!row)throw new Error('Import was not saved');
      await saveLink(env,row,owner,event);linkedGoogle.add(googleId);byPlanner.set(row.id,{planner_id:row.id,google_id:googleId,planner_signature:JSON.stringify({format:2,hash:await hash(row),base:calendarSnapshot(row)}),google_etag:event.etag});writes++;
    }catch(error){await conflict(env,googleId,owner,String(error.message||error));}
  }
  for(const row of rows){
    if(writes>=MAX_WRITES)break;
    if(!ordinary(row))continue;
    const saved=byPlanner.get(row.id),shouldExist=wanted(row,owner);let event=saved&&remote.get(saved.google_id);
    if(saved&&!event){
      const previous=readSignature(saved.planner_signature);
      if(previous.recurring&&await hash(row)===previous.hash)continue;
      try{event=await google(eventUrl(calendar,saved.google_id),token);}catch(error){await conflict(env,row.id,owner,String(error.message||error));continue;}
    }
    if(saved&&!shouldExist&&!row.deleted){
      if(event&&event.status!=='cancelled')await google(eventUrl(calendar,saved.google_id),token,{method:'DELETE',headers:{'If-Match':event.etag}});
      await admin(env,`planner_google_links?planner_id=eq.${row.id}&owner=eq.${encodeURIComponent(owner)}`,{method:'DELETE'});writes++;continue;
    }
    if(!shouldExist&&!saved||!saved&&row.deleted)continue;
    if(saved&&!event){await conflict(env,row.id,owner,'Связанное событие Google не найдено');continue;}
    const signature=saved&&readSignature(saved.planner_signature);
    const plannerChanged=saved&&await hash(row)!==signature.hash;
    const googleChanged=saved&&event.etag!==saved.google_etag;
    if(saved&&event.status==='cancelled'&&row.deleted){await saveLink(env,row,owner,event);continue;}
    if(plannerChanged&&googleChanged){
      const remoteRow=event.status==='cancelled'?{...row,deleted:true}:{...row,...plannerFields(event,row),deleted:false};
      const result=signature.base?mergeCalendar(signature.base,row,remoteRow):{conflicts:['unknownBase']};
      if(result.conflicts.length){await recordConflict(admin,env,row,owner,remoteRow,event.etag,signature.base);continue;}
      const updatedRow=await compareAndSet(admin,env,row,result.merged);if(!updatedRow)continue;
      let updatedEvent;
      if(updatedRow.deleted){if(event.status!=='cancelled')await google(eventUrl(calendar,saved.google_id),token,{method:'DELETE',headers:{'If-Match':event.etag}});updatedEvent={...event,status:'cancelled'};}
      else updatedEvent=await google(eventUrl(calendar,saved.google_id),token,{method:'PATCH',headers:{'If-Match':event.etag},body:JSON.stringify(googleBody(updatedRow))});
      await saveLink(env,updatedRow,owner,updatedEvent);writes++;continue;
    }
    if(googleChanged){
      const patch=event.status==='cancelled'?{deleted:true}:plannerFields(event,row);
      const updated=await compareAndSet(admin,env,row,patch);if(!updated)continue;
      await saveLink(env,updated,owner,event);writes++;continue;
    }
    if(saved&&!plannerChanged){if(!signature.base)await saveLink(env,row,owner,event);continue;}
    if(row.deleted){
      if(event.status!=='cancelled')await google(eventUrl(calendar,saved.google_id),token,{method:'DELETE',headers:{'If-Match':event.etag}});
      await saveLink(env,row,owner,{...event,status:'cancelled'});writes++;
    }else if(saved){
      const updated=await google(eventUrl(calendar,saved.google_id),token,{method:'PATCH',headers:{'If-Match':event.etag},body:JSON.stringify(googleBody(row))});
      await saveLink(env,row,owner,updated);writes++;
    }else{
      const id=`p${row.id.replaceAll('-','').toLowerCase()}`;
      let created;
      try{created=await google(eventUrl(calendar),token,{method:'POST',body:JSON.stringify({id,...googleBody(row)})});}
      catch(error){
        if(!String(error.message).startsWith('Google 409:'))throw error;
        const existing=await google(eventUrl(calendar,id),token);
        if(existing.status==='cancelled'){
          const replacementId=id+'v'+Number(row.version).toString(32);
          try{created=await google(eventUrl(calendar),token,{method:'POST',body:JSON.stringify({id:replacementId,...googleBody(row)})});}
          catch(retryError){if(!String(retryError.message).startsWith('Google 409:'))throw retryError;created=await google(eventUrl(calendar,replacementId),token);}
        }else created=existing;
      }
      await saveLink(env,row,owner,created);writes++;
    }
  }
}

export async function syncCalendars(env) {
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return;
  const tokens=await admin(env,'planner_google_tokens?select=*');
  // One expired account must not stop synchronization for the other accounts.
  for(const token of tokens)try{await syncOwner(env,token);}catch(error){console.error(JSON.stringify({event:'calendar-sync-error',reconnect:reconnectNeeded(error),message:String(error.message||error)}));}
}

export async function handleCalendarRequest(request, env, user) {
  const url = new URL(request.url);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_OWNER_EMAILS)
    return Response.json({ error: "Google Calendar ещё не настроен" }, { status: 503 });
  if (url.pathname === "/google/callback" && request.method === "GET") {
    const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
    const states = await admin(env, `planner_google_states?select=*&state=eq.${encodeURIComponent(state)}`);
    if (!states[0] || new Date(states[0].expires_at) < new Date()) return new Response("Ссылка устарела", { status: 400 });
    const owner = states[0].owner, redirect = `${url.origin}/google/callback`;
    const body = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirect, grant_type: "authorization_code" });
    const exchange = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
    if (!exchange.ok) return new Response(await exchange.text(), { status: 400 });
    const result = await exchange.json(), profile = await google("https://www.googleapis.com/oauth2/v3/userinfo", result.access_token);
    const expected = JSON.parse(env.GOOGLE_OWNER_EMAILS || "{}")[owner]?.toLowerCase();
    if (!expected || profile.email?.toLowerCase() !== expected) return new Response("Выбран другой Google-аккаунт", { status: 403 });
    const old = await admin(env, `planner_google_tokens?select=*&owner=eq.${encodeURIComponent(owner)}`), refresh = result.refresh_token || old[0]?.refresh_token;
    if (!refresh) return new Response("Google не выдал токен обновления", { status: 400 });
    let calendar = old[0]?.calendar_id;
    if (!calendar) {
      try {
        calendar = (await google(`${GOOGLE}/calendars`, result.access_token, { method: "POST",
          body: JSON.stringify({ summary: "Планер — личный календарь", timeZone: "Europe/Moscow" }) })).id;
      } catch (error) {
        if (!String(error?.message || error).includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) throw error;
        calendar = "primary";
      }
    }
    await admin(env, "planner_google_tokens?on_conflict=owner", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ owner, refresh_token: refresh, access_token: result.access_token,
        expires_at: Date.now() + result.expires_in * 1000, calendar_id: calendar, updated_at: new Date().toISOString() }) });
    await admin(env, `planner_google_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE" });
    await syncCalendars(env);
    return new Response("Календарь подключён и синхронизирован. Можно закрыть эту страницу.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if(url.pathname==='/google/status'&&request.method==='GET'){
    if(!user?.id)return Response.json({connected:false},{status:401,headers:{'Access-Control-Allow-Origin':'*'}});
    const owner=ownerOf(user),tokens=await admin(env,`planner_google_tokens?select=*&owner=eq.${encodeURIComponent(owner)}`),row=tokens[0];
    let requiresReconnect=false,checkError=false;
    if(row?.calendar_id)try{
      const token=await accessToken(env,row);
      await google(`${GOOGLE}/calendars/${encodeURIComponent(row.calendar_id)}`,token);
    }catch(error){requiresReconnect=reconnectNeeded(error);checkError=!requiresReconnect;}
    const pending=await admin(env,`planner_google_conflicts?select=id,planner_id,reason&owner=eq.${encodeURIComponent(owner)}&resolved_at=is.null&order=id.desc&limit=100`);
    const seen=new Set(),conflicts=[];
    for(const entry of pending)try{
      const payload=JSON.parse(entry.reason);
      if(payload.type!=='sync_conflict'||seen.has(entry.planner_id))continue;
      seen.add(entry.planner_id);
      conflicts.push({id:entry.id,title:payload.local.title,local:payload.local,remote:payload.remote});
    }catch{}
    return Response.json({syncRevision:65,connected:Boolean(row?.calendar_id)&&!requiresReconnect,requiresReconnect,checkError,updatedAt:row?.updated_at||null,conflicts},{headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.pathname==='/google/resolve'&&request.method==='POST'){
    const headers={'Access-Control-Allow-Origin':'*'};
    if(!user?.id)return Response.json({error:'Unauthorized'},{status:401,headers});
    const {id,choice}=await request.json();
    if(!/^\d+$/.test(String(id))||!['planner','google'].includes(choice))return Response.json({error:'Invalid choice'},{status:400,headers});
    const owner=ownerOf(user),entries=await admin(env,`planner_google_conflicts?select=*&id=eq.${id}&owner=eq.${encodeURIComponent(owner)}&resolved_at=is.null`);
    if(!entries[0])return Response.json({error:'Conflict not found'},{status:404,headers});
    const entry=entries[0],payload=JSON.parse(entry.reason);
    if(payload.type!=='sync_conflict')return Response.json({error:'Unsupported conflict'},{status:400,headers});
    const rows=await admin(env,`planner_events?id=eq.${entry.planner_id}&select=*`),row=rows[0];
    const links=await admin(env,`planner_google_links?planner_id=eq.${entry.planner_id}&owner=eq.${encodeURIComponent(owner)}&select=*`);
    const tokenRows=await admin(env,`planner_google_tokens?owner=eq.${encodeURIComponent(owner)}&select=*`);
    if(!row||!links[0]||!tokenRows[0])return Response.json({error:'Event unavailable'},{status:409,headers});
    const token=await accessToken(env,tokenRows[0]),calendar=tokenRows[0].calendar_id,event=await google(eventUrl(calendar,links[0].google_id),token);
    if(row.version!==payload.version||event.etag!==payload.etag)return Response.json({error:'Event changed; refresh conflicts'},{status:409,headers});
    const merged=payload.base?mergeCalendar(payload.base,row,payload.remote):{merged:calendarSnapshot(row),conflicts:CALENDAR_FIELDS};
    let patch={...merged.merged};
    if(merged.conflicts.includes('deleted'))patch=choice==='planner'?payload.local:payload.remote;
    else for(const key of merged.conflicts)patch[key]=(choice==='planner'?payload.local:payload.remote)[key];
    const updated=await compareAndSet(admin,env,row,patch);
    if(!updated)return Response.json({error:'Event changed; retry'},{status:409,headers});
    let savedEvent=event;
    if(updated.deleted){if(event.status!=='cancelled')await google(eventUrl(calendar,event.id),token,{method:'DELETE',headers:{'If-Match':event.etag}});savedEvent={...event,status:'cancelled'};}
    else if(choice==='planner'||merged.conflicts.length<CALENDAR_FIELDS.length){
      if(event.status==='cancelled'){
        const restoredId='p'+row.id.replaceAll('-','')+'v'+Number(updated.version).toString(32);
        savedEvent=await google(eventUrl(calendar),token,{method:'POST',body:JSON.stringify({id:restoredId,...googleBody(updated)})});
      }else savedEvent=await google(eventUrl(calendar,event.id),token,{method:'PATCH',headers:{'If-Match':event.etag},body:JSON.stringify(googleBody(updated))});
    }
    await saveLink(env,updated,owner,savedEvent);
    await admin(env,`planner_google_conflicts?planner_id=eq.${row.id}&owner=eq.${encodeURIComponent(owner)}&resolved_at=is.null`,{method:'PATCH',body:JSON.stringify({resolved_at:new Date().toISOString()})});
    return Response.json({ok:true},{headers});
  }
  if (url.pathname === "/google/sync" && request.method === "POST") {
    if (!user?.id) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Access-Control-Allow-Origin": "*" } });
    await syncCalendars(env);
    return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (url.pathname !== "/google/connect" || request.method !== "POST") return null;
  if (!user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const owner = ownerOf(user); if (!owner) return Response.json({ error: "Unknown owner" }, { status: 403 });
  const state = crypto.randomUUID();
  await admin(env, "planner_google_states", { method: "POST", body: JSON.stringify({ state, owner, expires_at: new Date(Date.now() + 600000).toISOString() }) });
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/google/callback`,
    response_type: "code", access_type: "offline", prompt: "consent", scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar", state });
  return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
