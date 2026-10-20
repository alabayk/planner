import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCalendarRequest,syncCalendars} from '../worker/calendar.js';
const env={GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_OWNER_EMAILS:'{}',SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'};
const user={id:'user-id',email:'owner@planer.app'};
const reply=(data,status=200)=>Response.json(data,{status});
test('revoked refresh token requests reconnect, without exposing credentials',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{const url=String(input);
    if(url.includes('/planner_google_tokens'))return reply([{owner:'owner',calendar_id:'calendar',refresh_token:'private',expires_at:0}]);
    if(url.includes('oauth2.googleapis.com'))return reply({error:'invalid_grant'},400);
    if(url.includes('/planner_google_conflicts'))return reply([]);
    throw Error('Unexpected request '+url);
  };
  try{const response=await handleCalendarRequest(new Request('https://worker.invalid/google/status'),env,user);const data=await response.json();assert.equal(data.requiresReconnect,true);assert.equal(data.connected,false);assert.ok(!JSON.stringify(data).includes('private'));}finally{globalThis.fetch=original;}
});
test('temporary Google outage keeps the connection and does not request reauthorization',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{const url=String(input);
    if(url.includes('/planner_google_tokens'))return reply([{owner:'owner',calendar_id:'calendar',access_token:'private',expires_at:Date.now()+600000}]);
    if(url.includes('googleapis.com/calendar'))return reply({error:'Unavailable'},503);
    if(url.includes('/planner_google_conflicts'))return reply([]);
    throw Error('Unexpected request '+url);
  };
  try{const data=await(await handleCalendarRequest(new Request('https://worker.invalid/google/status'),env,user)).json();assert.equal(data.requiresReconnect,false);assert.equal(data.connected,true);assert.equal(data.checkError,true);}finally{globalThis.fetch=original;}
});
test('expired account does not stop another account syncing',async()=>{
  const original=globalThis.fetch,oldLog=console.error;let checkedSecond=false;
  console.error=()=>{};
  globalThis.fetch=async input=>{const url=String(input);
    if(url.includes('/planner_google_tokens'))return reply([{owner:'first',calendar_id:'a',expires_at:0,refresh_token:'bad'},{owner:'second',calendar_id:'b',access_token:'ok',expires_at:Date.now()+600000}]);
    if(url.includes('oauth2.googleapis.com'))return reply({error:'invalid_grant'},400);
    if(url.includes('/planner_events')||url.includes('/planner_google_links'))return reply([]);
    if(url.includes('/calendars/b/events')){checkedSecond=true;return reply({items:[]});}
    throw Error('Unexpected request '+url);
  };
  try{await syncCalendars(env);assert.equal(checkedSecond,true);}finally{globalThis.fetch=original;console.error=oldLog;}
});
test('calendar cycle reads the shared event snapshot once for both accounts',async()=>{
  const original=globalThis.fetch;let scans=0;
  globalThis.fetch=async input=>{const url=String(input);if(url.includes('/planner_google_tokens'))return reply(['first','second'].map(owner=>({owner,calendar_id:owner,access_token:'ok',expires_at:Date.now()+600000})));if(url.includes('/planner_events')){scans++;return reply([]);}if(url.includes('/planner_google_links'))return reply([]);if(url.includes('googleapis.com/calendar'))return reply({items:[]});throw Error('Unexpected '+url);};
  try{await syncCalendars(env);assert.equal(scans,1);}finally{globalThis.fetch=original;}
});
