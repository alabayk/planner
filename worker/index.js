import webpush from "web-push";
import { handleCalendarRequest, syncCalendars } from "./calendar.js";

const allowedOrigin = "*";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body, status = 200) => Response.json(body, { status, headers: cors });

async function currentUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY },
  });
  return response.ok ? response.json() : null;
}

async function db(request, env, path, init = {}) {
  const authorization = request.headers.get("Authorization") || "";
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function adminDb(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function deliverQueue(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
  const jobsResponse = await adminDb(env, `push_jobs?select=id,created_by,target_user_id,title,audience,kind&processed_at=is.null&deliver_at=lte.${encodeURIComponent(new Date().toISOString())}&order=deliver_at.asc&limit=20`);
  if (!jobsResponse.ok) throw new Error(await jobsResponse.text());
  const jobs = await jobsResponse.json();
  webpush.setVapidDetails("mailto:noreply@planer.app", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  for (const job of jobs) {
    const audience = job.audience.replace(/_(due|soon)$/, "");
    const filter = job.target_user_id ? `user_id=eq.${job.target_user_id}` : audience === "all" ? "" : audience === "self" ? `user_id=eq.${job.created_by}` : `user_id=neq.${job.created_by}`;
    const subscriptionsResponse = await adminDb(env, `push_subscriptions?select=subscription${filter?'&'+filter:''}`);
    const subscriptions = subscriptionsResponse.ok ? await subscriptionsResponse.json() : [];
    const payload = JSON.stringify({ title: job.kind === "test" ? "Проверка уведомлений" : job.kind === "deadline_soon" ? "Осталась 1 минута до дедлайна" : job.kind === "deadline_due" ? "Срок истёк" : job.kind === "deadline" ? "Напоминание о дедлайне" : "Новое общее событие", body: job.kind === "test" ? "Уведомления работают" : job.title, url: "/vmeste-planner/" });
    const results = await Promise.allSettled(subscriptions.map(({ subscription }) => webpush.sendNotification(subscription, payload)));
    await adminDb(env, `push_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ processed_at: new Date().toISOString() }) });
    console.log(JSON.stringify({ event: "queued-push", job: job.id, subscriptions: subscriptions.length, sent: results.filter(r => r.status === "fulfilled").length, failed: results.filter(r => r.status === "rejected").map(r => String(r.reason?.message || r.reason)) }));
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (["/google/callback", "/google/connect", "/google/status"].includes(url.pathname)) {
      try {
        const user = url.pathname === "/google/callback" ? null : await currentUser(request, env);
        return await handleCalendarRequest(request, env, user);
      } catch (error) {
        return json({ error: String(error?.message || error) }, 500);
      }
    }
    if (request.method === "GET") return json({ ok: true, vapidConfigured: Boolean(env.VAPID_PRIVATE_KEY), supabaseConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY), calendarConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const user = await currentUser(request, env);
      if (!user?.id) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();

      if (body.action === "subscribe") {
        const subscription = body.subscription;
        if (!subscription?.endpoint) return json({ error: "Invalid subscription" }, 400);
        const response = await db(request, env, "push_subscriptions?on_conflict=endpoint", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            user_id: user.id,
            subscription,
            updated_at: new Date().toISOString(),
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        return json({ ok: true });
      }

      if (body.action === "notify" || body.action === "test") {
        const response = body.action === "test"
          ? await db(request, env, `push_subscriptions?select=endpoint,subscription&user_id=eq.${encodeURIComponent(user.id)}`)
          : await db(request, env, "rpc/get_other_push_subscriptions", { method: "POST", body: "{}" });
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
      webpush.setVapidDetails("mailto:noreply@planer.app", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        const payload = JSON.stringify(body.action === "test"
          ? { title: "Планер", body: "Уведомления работают", url: "/vmeste-planner/" }
          : { title: "Новый общий план", body: body.title, url: "/vmeste-planner/" });
        const results = await Promise.allSettled(rows.map(({ subscription }) => webpush.sendNotification(subscription, payload)));
        const sent = results.filter((result) => result.status === "fulfilled").length;
        const failed = results.filter((result) => result.status === "rejected").map((result) => String(result.reason?.message || result.reason));
        console.log(JSON.stringify({ event: "push-delivery", subscriptions: rows.length, sent, failed }));
        return json({ ok: failed.length === 0, subscriptions: rows.length, sent, failed });
      }

      return json({ error: "Bad request" }, 400);
    } catch (error) {
      return json({ error: String(error?.message || error) }, 500);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([deliverQueue(env), syncCalendars(env)]));
  },
};
