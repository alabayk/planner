const GOOGLE = "https://www.googleapis.com/calendar/v3";
const BOTH = "\n[[planner:both]]";
const MAX_WRITES = 50;

const ownerOf = user => (user?.email || "").split("@")[0];
const ordinary = row => row.notes !== "__todo__" && !(row.notes || "").startsWith("[[deadline]]");
const shared = row => row.space === "shared" && (row.notes || "").includes(BOTH);
const wanted = (row, owner) => row.created_by === owner || shared(row);
const cleanNotes = value => (value || "").replace(BOTH, "").trim();

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
function googleBody(row) {
  const start = new Date(row.starts_at), end = new Date(start.getTime() + Number(row.duration_minutes) * 60000);
  return { summary: row.title, description: cleanNotes(row.notes), start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() }, extendedProperties: { private: { plannerId: row.id } } };
}
function plannerFields(event) {
  if (event.recurrence || !event.start?.dateTime || !event.end?.dateTime) throw new Error("Повтор или весь день требует ручной проверки");
  const start = new Date(event.start.dateTime), end = new Date(event.end.dateTime), minutes = Math.round((end - start) / 60000);
  if (minutes < 5 || minutes > 1440) throw new Error("Некорректная длительность");
  const title = event.summary || "Без названия", notes = event.description || "";
  if (title.length > 120 || notes.length > 580) throw new Error("Слишком длинный текст");
  return { title, notes, starts_at: start.toISOString(), duration_minutes: minutes };
}

async function listEvents(token, calendar) {
  const events = new Map(); let pageToken = "";
  do {
    const query = new URLSearchParams({ maxResults: "2500", showDeleted: "true" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await google(`${eventUrl(calendar)}?${query}`, token);
    for (const event of page.items || []) events.set(event.id, event);
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return events;
}

async function saveLink(env, row, owner, event) {
  await admin(env, "planner_google_links?on_conflict=planner_id,owner", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ planner_id: row.id, owner,
      google_id: event.id, planner_signature: await hash(row), google_etag: event.etag || null }) });
}
async function conflict(env, plannerId, owner, reason) {
  await admin(env, "planner_google_conflicts", { method: "POST", body: JSON.stringify({ planner_id: plannerId, owner, reason }) });
}

async function syncOwner(env, tokenRow) {
  const owner = tokenRow.owner, token = await accessToken(env, tokenRow), calendar = tokenRow.calendar_id;
  if (!calendar) return;
  const [rows, links] = await Promise.all([
    admin(env, "planner_events?select=*&order=id"),
    admin(env, `planner_google_links?select=*&owner=eq.${encodeURIComponent(owner)}`),
  ]);
  const remote = await listEvents(token, calendar), byId = new Map(rows.map(x => [x.id, x]));
  const byPlanner = new Map(links.map(x => [x.planner_id, x])), linkedGoogle = new Set(links.map(x => x.google_id));
  let writes = 0;
  for (const row of rows) {
  if (writes >= MAX_WRITES) break;
  if (!ordinary(row)) continue;
    const saved = byPlanner.get(row.id), shouldExist = wanted(row, owner), event = saved && remote.get(saved.google_id);
    if (saved && !shouldExist && !row.deleted) {
      if (event && event.status !== "cancelled") await google(eventUrl(calendar, saved.google_id), token, { method: "DELETE" });
      await admin(env, `planner_google_links?planner_id=eq.${row.id}&owner=eq.${encodeURIComponent(owner)}`, { method: "DELETE" });
      writes++; continue;
    }
    if (!shouldExist && !saved) continue;
    if (!saved && (row.deleted || new Date(row.starts_at) < new Date(Date.now() - 86400000))) continue;
    if (saved && !event) { await conflict(env, row.id, owner, "Связанное событие Google не найдено"); continue; }
    const plannerChanged = saved && await hash(row) !== saved.planner_signature;
    const googleChanged = saved && event && event.etag !== saved.google_etag;
    if (plannerChanged && googleChanged) { await conflict(env, row.id, owner, "Обе стороны изменены"); continue; }
    if (googleChanged) {
      const patch = event.status === "cancelled" ? { deleted: true } : plannerFields(event);
      if (!patch.deleted) patch.notes = patch.notes + (shared(row) ? BOTH : "");
      patch.version = Number(row.version) + 1; patch.updated_at = new Date().toISOString();
      const updated = await admin(env, `planner_events?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      await saveLink(env, updated[0], owner, event); writes++; continue;
    }
    if (saved && !plannerChanged) continue;
    if (row.deleted) {
      if (event?.status !== "cancelled") await google(eventUrl(calendar, saved.google_id), token, { method: "DELETE" });
      await saveLink(env, row, owner, { id: saved.google_id }); writes++;
    } else if (saved) {
      const updated = await google(eventUrl(calendar, saved.google_id), token, { method: "PATCH", body: JSON.stringify(googleBody(row)) });
      await saveLink(env, row, owner, updated); writes++;
    } else {
      const id = `p${row.id.replaceAll("-", "").toLowerCase()}`;
      const created = await google(eventUrl(calendar), token, { method: "POST", body: JSON.stringify({ id, ...googleBody(row) }) });
      await saveLink(env, row, owner, created); linkedGoogle.add(created.id); writes++;
    }
  }
  for (const [id, event] of remote) {
    if (writes >= MAX_WRITES || linkedGoogle.has(id) || event.status === "cancelled") continue;
    const known = event.extendedProperties?.private?.plannerId, row = byId.get(known);
    if (row && wanted(row, owner)) { await saveLink(env, row, owner, event); continue; }
    try {
      const fields = plannerFields(event), id = crypto.randomUUID();
      const inserted = await admin(env, "planner_events", { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ id, ...fields, notes: fields.notes + BOTH, space: "shared", created_by: owner,
          done: false, deleted: false, version: 1, updated_at: new Date().toISOString() }) });
      await saveLink(env, inserted[0], owner, event); writes++;
    } catch (error) { await conflict(env, id, owner, String(error.message || error)); }
  }
}

export async function syncCalendars(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return;
  const tokens = await admin(env, "planner_google_tokens?select=*");
  for (const token of tokens) await syncOwner(env, token);
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
    if (!calendar) calendar = (await google(`${GOOGLE}/calendars`, result.access_token, { method: "POST",
      body: JSON.stringify({ summary: "Планер — личный календарь", timeZone: "Europe/Moscow" }) })).id;
    await admin(env, "planner_google_tokens?on_conflict=owner", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ owner, refresh_token: refresh, access_token: result.access_token,
        expires_at: Date.now() + result.expires_in * 1000, calendar_id: calendar, updated_at: new Date().toISOString() }) });
    await admin(env, `planner_google_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE" });
    await syncCalendars(env);
    return new Response("Календарь подключён и синхронизирован. Можно закрыть эту страницу.", { headers: { "content-type": "text/plain; charset=utf-8" } });
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
