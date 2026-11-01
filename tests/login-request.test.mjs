import test from 'node:test';import assert from 'node:assert/strict';
import {createLoginRequest} from '../public/login-request.mjs';
test('slow password login shares one request and does not launch automatic retries',async()=>{
 let done,calls=0;const login=createLoginRequest({signInWithPassword:()=>{calls++;return new Promise(resolve=>done=resolve);}});
 const a=login('self','password'),b=login('self','password');await Promise.resolve();assert.equal(calls,1);done({data:{session:{}}});await Promise.all([a,b]);
});
test('UI timeout does not start a second request while the Auth lock remains held',async()=>{
 let done,expire,calls=0;const login=createLoginRequest({signInWithPassword:()=>{calls++;return new Promise(resolve=>done=resolve);}},{timers:{setTimeout(fn){expire=fn;return 1;},clearTimeout(){}}});
 const a=login('self','password');await Promise.resolve();expire();await assert.rejects(a,/AUTH_TIMEOUT/);await assert.rejects(login('self','password'),/AUTH_TIMEOUT/);assert.equal(calls,1);
 done({data:{session:{}}});await new Promise(resolve=>setTimeout(resolve,0));const b=login('self','password');await Promise.resolve();assert.equal(calls,2);done({data:{session:{}}});await b;
});
test('invalid credentials and transport errors are returned without another password request',async()=>{
 let calls=0;const login=createLoginRequest({signInWithPassword:async()=>{calls++;return {error:Error('invalid credentials')};}});await assert.rejects(login('self','bad'),/invalid credentials/);assert.equal(calls,1);
});
