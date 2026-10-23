/** Authenticated, privacy-preserving evaluator activity signals.
 *  Being online means we observed a valid session recently; it does not mean
 *  somebody is continuously typing. No passwords, marks or bearer tokens are stored.
 */
import {createHash} from 'node:crypto';
import mongoose from 'mongoose';
import {AccountModel, EvaluationModel, connectModels} from '../models/schemas/index.js';
import {APPROVED_EVALUATORS} from './approved-users.js';

const {Schema} = mongoose;
const PAGES = new Set(['directory', 'staff', 'evaluation', 'reports', 'security']);
export const ONLINE_MS = 160_000;
const ACTIVE_MS = 120_000;
const RETENTION_MS = 48 * 60 * 60 * 1000;
const API_UPDATE_INTERVAL_MS = 20_000;

const presenceSchema = new Schema({
  sessionKey:{type:String,required:true,unique:true}, // SHA-256 of token; token itself is never saved
  username:{type:String,required:true,index:true},
  page:{type:String,default:'directory'},
  source:{type:String,enum:['login','heartbeat','api'],default:'api'},
  active:{type:Boolean,default:false},
  lastSeenAt:{type:Date,required:true},
  lastActivityAt:{type:Date,default:null},
  lastHeartbeatAt:{type:Date,default:null},
  expiresAt:{type:Date,required:true},
},{collection:'lms_evaluator_presence',versionKey:false,strict:'throw'});
presenceSchema.index({expiresAt:1},{expireAfterSeconds:0});
const PresenceModel:mongoose.Model<any> = mongoose.models.LmsEvaluatorPresence || mongoose.model('LmsEvaluatorPresence',presenceSchema);
const keyFor=(token:string)=>createHash('sha256').update(token).digest('hex');

// Prevent many ordinary GET requests from creating unnecessary database writes.
const lastApiWrite = new Map<string,number>();
function trimThrottle(now:number){
  if(lastApiWrite.size<500)return;
  for(const [key,at] of lastApiWrite){if(now-at>ONLINE_MS)lastApiWrite.delete(key);}
}

export async function recordLoginPresence(username:string,token:string){
  await connectModels();
  const now=new Date();const sessionKey=keyFor(token);
  await PresenceModel.updateOne({sessionKey},{$set:{username,page:'directory',source:'login',active:true,lastSeenAt:now,lastActivityAt:now,expiresAt:new Date(now.getTime()+RETENTION_MS)},$setOnInsert:{sessionKey}},{upsert:true});
}

export async function recordHeartbeat(username:string,token:string,payload:unknown){
  await connectModels();
  const body=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
  const requested=String(body.page||'directory');
  const page=PAGES.has(requested)?requested:'directory';
  const active=body.active===true&&body.visible===true;
  const now=new Date();const sessionKey=keyFor(token);
  const set:Record<string,unknown>={username,page,source:'heartbeat',active,lastSeenAt:now,lastHeartbeatAt:now,expiresAt:new Date(now.getTime()+RETENTION_MS)};
  if(active)set.lastActivityAt=now;
  await PresenceModel.updateOne({sessionKey},{$set:set,$setOnInsert:{sessionKey}},{upsert:true});
  lastApiWrite.set(sessionKey,now.getTime());
  trimThrottle(now.getTime());
  return {ok:true,receivedAt:now.toISOString()};
}

/** Fall back to genuine authenticated requests when an old/cached frontend
 *  is not sending heartbeats. This cannot detect idle, open tabs and must not
 *  be presented as a precise measure of work. */
export async function recordAuthenticatedRequest(username:string,token:string,method:string,path:string){
  if(!token||path.startsWith('/activity/'))return;
  const now=Date.now();const sessionKey=keyFor(token);
  if(now-(lastApiWrite.get(sessionKey)||0)<API_UPDATE_INTERVAL_MS)return;
  lastApiWrite.set(sessionKey,now);trimThrottle(now);
  let page:string|undefined;
  let engaged=false;
  if(/^\/evaluations(?:\/|$)/.test(path)){page='evaluation';engaged=true;}
  else if(/^\/staff\//.test(path)){page='staff';engaged=true;}
  else if(path==='/directory'){page='directory';engaged=true;}
  else if(path==='/report/export'||path==='/admin/export'){page='reports';engaged=true;}
  else if(path==='/auth/change-password'){page='security';engaged=true;}
  else if(method==='PUT'||method==='POST'){engaged=true;}
  await connectModels();
  const set:Record<string,unknown>={username,lastSeenAt:new Date(now),expiresAt:new Date(now+RETENTION_MS)};
  if(engaged)set.lastActivityAt=new Date(now);
  // Do not overwrite the page or interaction state provided by a recent heartbeat.
  // Authenticated API calls may run in the background while the evaluator is elsewhere.
  const existing=await PresenceModel.findOne({sessionKey}).select('lastHeartbeatAt').lean() as {lastHeartbeatAt?:Date|null}|null;
  const heartbeatFresh=existing?.lastHeartbeatAt && now-new Date(existing.lastHeartbeatAt).getTime()<ONLINE_MS;
  if(!heartbeatFresh){
    set.source='api';
    if(page)set.page=page;
    set.active=engaged;
  }
  const onInsert:Record<string,unknown>={sessionKey};
  if(!('page' in set))onInsert.page=page||'directory';
  await PresenceModel.updateOne({sessionKey},{$set:set,$setOnInsert:onInsert},{upsert:true});
}

export async function clearSession(token:string){
  await connectModels();const sessionKey=keyFor(token);
  lastApiWrite.delete(sessionKey);
  await PresenceModel.deleteOne({sessionKey});
}

function startOfTodayIndia():Date {
  const offset=330*60*1000;
  const local=new Date(Date.now()+offset);
  local.setUTCHours(0,0,0,0);
  return new Date(local.getTime()-offset);
}

export interface PresenceSignal {
  page:string;active:boolean;lastSeenAt:Date|string;lastActivityAt?:Date|string|null;lastHeartbeatAt?:Date|string|null;
}
export function classifyPresence(sessions:PresenceSignal[],now=Date.now()){
  const recent=sessions.filter(p=>{
    const age=now-new Date(p.lastSeenAt).getTime();
    return age>=0&&age<ONLINE_MS;
  });
  const interacting=recent.some(p=>p.active && p.lastActivityAt && now-new Date(p.lastActivityAt).getTime()<ACTIVE_MS);
  const working=recent.some(p=>p.page==='evaluation'&&p.active&&p.lastActivityAt&&now-new Date(p.lastActivityAt).getTime()<ACTIVE_MS);
  return {status:recent.length===0?'offline':working?'entering-marks':interacting?'active':'idle',recent} as const;
}

export async function liveEvaluatorSnapshot(){
  await connectModels();const now=Date.now();
  const [presence,accounts,todayCounts]=await Promise.all([
    PresenceModel.find({expiresAt:{$gt:new Date()}}).select('username page source active lastSeenAt lastActivityAt lastHeartbeatAt').lean(),
    AccountModel.find({role:'evaluator'}).select('username lastLoginAt').lean(),
    EvaluationModel.aggregate([
      {$match:{status:'submitted',submittedAt:{$gte:startOfTodayIndia()}}},
      {$group:{_id:'$evaluatorId',count:{$sum:1}}},
    ]),
  ]);
  type StoredSession=PresenceSignal&{username:string;source?:string;lastHeartbeatAt?:Date|null};
  const all=presence as unknown as StoredSession[];
  const byLogin=new Map(accounts.map(a=>[String(a.username).toUpperCase(),a.lastLoginAt]));
  const today=new Map<string,number>(todayCounts.map((x:{_id:string;count:number})=>[String(x._id).toUpperCase(),Number(x.count)]));
  const evaluators=APPROVED_EVALUATORS.map(u=>{
    const sessions=all.filter(p=>p.username?.toUpperCase()===u.username);
    sessions.sort((a,b)=>new Date(b.lastSeenAt).getTime()-new Date(a.lastSeenAt).getTime());
    const {status,recent}=classifyPresence(sessions,now);
    const newest=recent[0]||sessions[0];
    return {username:u.username,name:u.displayName,department:u.department,status,
      page:recent[0]?.page||'',lastSeenAt:newest?.lastSeenAt||null,
      lastLoginAt:byLogin.get(u.username)||null,submittedToday:today.get(u.username)||0,
      sessions:recent.length,
      tracking:recent.some(p=>p.lastHeartbeatAt && now-new Date(p.lastHeartbeatAt).getTime()<ONLINE_MS)?'heartbeat':recent.length?'authenticated-request':'none'};
  });
  const online=evaluators.filter(x=>x.status!=='offline').length;
  const working=evaluators.filter(x=>x.status==='entering-marks').length;
  const active=evaluators.filter(x=>x.status==='active').length;
  const idle=evaluators.filter(x=>x.status==='idle').length;
  const heartbeatSessions=all.filter(p=>p.lastHeartbeatAt&&now-new Date(p.lastHeartbeatAt).getTime()<ONLINE_MS).length;
  return {refreshedAt:new Date(now).toISOString(),onlineWindowSeconds:ONLINE_MS/1000,
    counts:{total:evaluators.length,online,working,active,idle,offline:evaluators.length-online,
      submittedToday:evaluators.reduce((n,x)=>n+x.submittedToday,0)},
    tracking:{heartbeatSessions,authenticatedSessions:evaluators.filter(x=>x.tracking==='authenticated-request').length},
    evaluators};
}
