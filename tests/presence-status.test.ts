import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyPresence,ONLINE_MS} from '../src/services/presence.service.js';

const now=Date.parse('2026-10-22T12:00:00.000Z');
const secondsAgo=(s:number)=>new Date(now-s*1000).toISOString();

test('no authenticated signal is not currently online',()=>{
 assert.equal(classifyPresence([],now).status,'offline');
 assert.equal(classifyPresence([{page:'evaluation',active:true,lastSeenAt:secondsAgo(300),lastActivityAt:secondsAgo(300)}],now).status,'offline');
});
test('current marks-entry heartbeat with interaction shows entering marks',()=>{
 assert.equal(classifyPresence([{page:'evaluation',active:true,lastSeenAt:secondsAgo(30),lastActivityAt:secondsAgo(30)}],now).status,'entering-marks');
});
test('recent non-marks usage is active',()=>{
 assert.equal(classifyPresence([{page:'directory',active:true,lastSeenAt:secondsAgo(25),lastActivityAt:secondsAgo(25)}],now).status,'active');
});
test('connection without recent interaction is idle',()=>{
 assert.equal(classifyPresence([{page:'evaluation',active:false,lastSeenAt:secondsAgo(10),lastActivityAt:secondsAgo(150)}],now).status,'idle');
});
test('recent authenticated API request can show online without heartbeat',()=>{
 assert.equal(classifyPresence([{page:'directory',active:true,lastSeenAt:secondsAgo(18),lastActivityAt:secondsAgo(18)}],now).status,'active');
});
test('multiple sessions use the active one rather than stale records',()=>{
 assert.equal(classifyPresence([
  {page:'evaluation',active:true,lastSeenAt:secondsAgo(300),lastActivityAt:secondsAgo(300)},
  {page:'reports',active:true,lastSeenAt:secondsAgo(8),lastActivityAt:secondsAgo(8)},
 ],now).status,'active');
});
test('activity window remains finite even if someone leaves a browser open',()=>{
 assert.equal(classifyPresence([{page:'directory',active:true,lastSeenAt:secondsAgo(ONLINE_MS/1000+1),lastActivityAt:secondsAgo(30)}],now).status,'offline');
});
