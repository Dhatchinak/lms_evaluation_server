import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {login,authenticate,approvedUsers,listManagedAccounts,changePassword,resetPasswordByAdmin,verifyPassword} from './services/auth.service.js';
import {DEMO_MODE} from './services/staff.service.js';
import {loadDirectory,directoryStatus} from './services/directory.service.js';
import {listEvaluations,saveEvaluation,listAllRecords,databaseHealth,evaluationHistory} from './models/schema-storage.js';
import {connectModels,EvaluationModel} from './models/schemas/index.js';
import {parseEvaluation,validStaffId} from './utils/validation.js';
import {buildReport,buildCompletedReport} from './services/report.service.js';
import {createReportWorkbook} from './services/report-export.service.js';
import {recordHeartbeat,recordLoginPresence,recordAuthenticatedRequest,clearSession,liveEvaluatorSnapshot} from './services/presence.service.js';

if(!process.env.MONGO_URI){console.error('\n[CONFIG ERROR] MONGO_URI is missing. Copy server/.env.example to server/.env, then enter your MongoDB Atlas URI. See server/START-HERE.md.\n');process.exit(1);}
if(DEMO_MODE){console.error('\n[CONFIG ERROR] DEMO_MODE must be false for MongoDB-backed evaluations. Update server/.env.\n');process.exit(1);}
if((process.env.SESSION_SECRET||'').length<32){console.error('\n[CONFIG ERROR] SESSION_SECRET must contain at least 32 random characters. Generate one with: node -e \"console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))\"\n');process.exit(1);}
const app=express();
app.disable('x-powered-by');

// Frontend is hosted separately at https://lmsev.bhccs.in.
// Set FRONTEND_ORIGIN in the Hostinger backend environment settings.
const frontendOrigin = (process.env.FRONTEND_ORIGIN || 'https://lmsev.bhccs.in').replace(/\/$/, '');
app.use(cors({
  origin: frontendOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
}));

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'32kb'}));
// Multiple college evaluators can share one public/NAT IP. A 120/minute
// all-API limit wrongly blocks their heartbeats and normal marks entry.
// Keep a broad safety limit for ordinary traffic and a tighter login-only limit.
app.use('/api',rateLimit({windowMs:60000,limit:1200,standardHeaders:'draft-7',legacyHeaders:false}));
const loginLimiter=rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false});
app.get('/api/auth/users',(_req,res)=>res.json({evaluators:approvedUsers('evaluator'),admins:approvedUsers('admin')}));
app.post('/api/auth/login',loginLimiter,async(req,res,next)=>{try{const username=String(req.body?.staffId||req.body?.username||'').trim();const password=String(req.body?.password||'');const session=await login(username,password);if(!session)return res.status(401).json({error:'Invalid approved account or password. Ask the LMS administrators to check account setup.'});if(session.role==='evaluator')await recordLoginPresence(session.staffId,session.token).catch(e=>console.warn('[PRESENCE] Login activity unavailable:',e instanceof Error?e.message:e));res.set('Cache-Control','no-store');res.json(session);}catch(e){next(e);}});
app.use('/api',async(req,res,next)=>{try{if(req.path==='/health')return next();const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');const user=await authenticate(token);if(!user)return res.status(401).json({error:'Sign in to continue or session expired.'});(req as any).identity=user;if(user.role==='evaluator'&&!req.path.startsWith('/activity/')){await recordAuthenticatedRequest(user.username,token,req.method,req.path).catch(e=>console.warn('[PRESENCE] Authenticated request activity unavailable:',e instanceof Error?e.message:e));}next();}catch(e){next(e);}});
app.get('/api/auth/me',(req,res)=>{const user=(req as any).identity;res.set('Cache-Control','no-store');res.json({username:user.username,role:user.role,name:user.name,department:user.department});});
const identity=(req:any)=>req.identity as {username:string,role:string,name:string,department?:string};
const isAdmin=(req:any)=>identity(req)?.role==='admin';
const evaluatorName=(req:any)=>identity(req)?.name||'';
const isEvaluator=(req:any)=>identity(req)?.role==='evaluator';
const viewer=(_req:any,_res:any,next:any)=>next();
const evaluator=(req:any,res:any,next:any)=>isEvaluator(req)?next():res.status(403).json({error:'Evaluator permission required.'});
const administrator=(req:any,res:any,next:any)=>isAdmin(req)?next():res.status(403).json({error:'Administrator permission required.'});
// Presence is deliberately opt-in by authenticated evaluator sessions only.
// The token is hashed before storage; admin endpoints never expose a session identifier.
app.post('/api/activity/heartbeat',evaluator,async(req,res,next)=>{try{
  const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const result=await recordHeartbeat(identity(req).username,token,req.body);
  res.set('Cache-Control','no-store').json(result);
}catch(e){next(e);}});
app.post('/api/activity/logout',evaluator,async(req,res,next)=>{try{
  const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
  await clearSession(token);res.json({ok:true});
}catch(e){next(e);}});
app.get('/api/admin/live-evaluators',administrator,async(_req,res,next)=>{try{
  res.set('Cache-Control','no-store').json(await liveEvaluatorSnapshot());
}catch(e){next(e);}});

app.get('/api/admin/accounts',administrator,async(_req,res,next)=>{try{res.json({users:await listManagedAccounts()});}catch(e){next(e)}});
app.post('/api/admin/accounts/reset-password',administrator,async(req,res,next)=>{try{const id=String(req.body?.username||'').toUpperCase(),password=String(req.body?.password||'');if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});const ok=await resetPasswordByAdmin(id,password);if(!ok)return res.status(404).json({error:'Evaluator account not found.'});res.json({ok:true});}catch(e){next(e)}});
app.post('/api/auth/change-password',async(req,res,next)=>{try{const user=identity(req),oldPassword=String(req.body?.oldPassword||''),newPassword=String(req.body?.newPassword||'');const {AccountModel}=await import('./models/schemas/index.js');const acct=await AccountModel.findOne({username:user.username}).lean();if(!acct||!verifyPassword(oldPassword,acct.passwordSalt,acct.passwordHash))return res.status(403).json({error:'Current password is incorrect.'});await changePassword(user.username,newPassword);res.json({ok:true,signOut:true});}catch(e){next(e)}});
app.get('/api/health',async (_q,r)=>{try{await databaseHealth();r.json({ok:true,database:'MongoDB',collection:'LMS evaluation',persistence:'evaluations and administrator accounts only',directory:directoryStatus(),roles:['evaluator','admin'],rubricVersion:2});}catch{r.status(503).json({ok:false,database:'unavailable'});}});
app.get('/api/directory',viewer,async(req,res,next)=>{try{res.set('Cache-Control','no-store');const data=await Promise.race([loadDirectory(req.query.refresh==='true'),new Promise<never>((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('The ERP directory is still synchronizing. Please retry in a few moments.'),{status:503})),25000))]);res.json(data);}catch(e){next(e);}});
// Institution-wide progress is intentionally separate from evaluator-owned reports.
// A staff member's submitted courses remain completed when a different evaluator logs in.
app.get('/api/faculty-progress',viewer,async(_req,res,next)=>{
 const started=Date.now();
 try{
  const [directory,records]=await Promise.all([
   (async()=>{const t=Date.now();try{return await loadDirectory();}finally{console.info(`[PERF] faculty-progress directory: ${Date.now()-t}ms`);}})(),
   (async()=>{const t=Date.now();try{const result=await listAllRecords();console.info(`[PERF] faculty-progress MongoDB record read: ${Date.now()-t}ms (${result.length} records)`);return result;}catch(error){console.info(`[PERF] faculty-progress MongoDB record read failed after ${Date.now()-t}ms`);throw error;}})()
  ]);
  const calculationStarted=Date.now();
  const progress=buildReport(directory,records);
  console.info(`[PERF] faculty-progress calculation: ${Date.now()-calculationStarted}ms`);
  res.set('Cache-Control','no-store');
  res.json({rows:progress.rows.map(row=>({staffId:row.staffId,courseCount:row.courseCount,completedCourses:row.completedCourses,average:row.average,status:row.status}))});
 }catch(e){next(e);}
 finally{console.info(`[PERF] faculty-progress total: ${Date.now()-started}ms`);}
});
app.get('/api/staff/:staffId/assigned-classes',async(req,res,next)=>{try{
 const id=String(req.params.staffId).toUpperCase();
 if(!validStaffId(id))return res.status(400).json({error:'Invalid staff ID.'});
 const {fetchFaculty}=await import('./services/staff.service.js');
 const profile=await fetchFaculty(id);
 res.set('Cache-Control','no-store');res.json({staffId:id,courses:profile.courses});
}catch(e){next(e);}});
app.get('/api/evaluations/:staffId',viewer,async(req,res,next)=>{try{const id=req.params.staffId.toUpperCase();if(!validStaffId(id))return res.status(400).json({error:'Invalid staff ID.'});const d=await loadDirectory();if(!d.staff.some(s=>s.staffId===id))return res.status(404).json({error:'Faculty is not in the current ERP directory.'});res.set('Cache-Control','no-store');res.json({records:(await listEvaluations(id)).filter(r=>isAdmin(req)||(r.evaluatorId ? String(r.evaluatorId).toUpperCase()===identity(req).username.toUpperCase() : String(r.evaluatorName||'').trim().toLocaleLowerCase()===evaluatorName(req).toLocaleLowerCase()))});}catch(e){next(e);}});
app.put('/api/evaluations',evaluator,async(req,res,next)=>{try{const id=String(req.body?.staffId||'').toUpperCase();if(!validStaffId(id))return res.status(400).json({error:'Invalid staff ID.'});const d=await loadDirectory();const faculty=d.staff.find(s=>s.staffId===id);if(!faculty)return res.status(404).json({error:'Faculty is not in the current ERP directory.'});const item=parseEvaluation({...req.body,evaluatorName:evaluatorName(req),evaluatorId:identity(req).username,evaluatorDepartment:String(identity(req).department||'')},faculty);res.json({record:await saveEvaluation(item)});}catch(e){next(e);}});
async function loadReport(req){
 const [d,recs]=await Promise.all([loadDirectory(),listAllRecords()]);
 const mine=!isAdmin(req),name=mine?evaluatorName(req):String(req.query.evaluator||'');
 const department=String(req.query.department||'');
 const search=String(req.query.search||'');
 // Export and UI share the same submitted-course source; partial faculty evaluations are included.
 const scoped=mine?recs.filter(r=>r.evaluatorId ? String(r.evaluatorId).toUpperCase()===identity(req).username.toUpperCase() : String(r.evaluatorName||'').trim().toLocaleLowerCase()===name.toLocaleLowerCase()):recs;
 const report=buildCompletedReport(d,scoped,{department,search,evaluatorName:mine?'':name});
 report.evaluatorName=mine?name:report.evaluatorName;
 return {report,records:scoped,directory:d};
}
app.get('/api/report',viewer,async(req,res,next)=>{try{const {report}=await loadReport(req);res.set('Cache-Control','no-store');res.json(report);}catch(e){next(e);}});
app.get('/api/report/export',viewer,async(req,res,next)=>{try{const {report,records,directory}=await loadReport(req);const exportReport={...report,search:String(req.query.search||'')};const wb=await createReportWorkbook(exportReport,records,isAdmin(req)?'Administrator':'Evaluator',directory);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="BHC-LMS-Evaluation-Report.xlsx"','Cache-Control':'no-store'});await wb.xlsx.write(res);res.end();}catch(e){next(e);}});
app.get('/api/admin/overview',administrator,async(_req,res,next)=>{try{
 // One MongoDB read and one submitted-course aggregation, rather than
 // rebuilding a full report for every department and each concurrent request.
 const [directory,records] = await Promise.all([loadDirectory(),listAllRecords()]);
 const completedReport = buildCompletedReport(directory,records);
 const baseStats = buildReport(directory,[]).stats;
 const completedGlobal = new Set<string>();
 const submittedByDepartment = new Map<string,number>();
 const completedByDepartment = new Map<string,Set<string>>();
 for (const row of completedReport.rows) {
   if (row.averageIsFinal) completedGlobal.add(row.staffId);
   for (const course of row.courses) {
     const department = String(course.department_name || '');
     submittedByDepartment.set(department,(submittedByDepartment.get(department)||0)+1);
     if (row.averageIsFinal) {
       if (!completedByDepartment.has(department)) completedByDepartment.set(department,new Set());
       completedByDepartment.get(department)!.add(row.staffId);
     }
   }
 }
 const makeStats=(staff:number,courses:number,completedStaff:number,submittedCourses:number)=>({
   staff,courses,completedStaff,submittedCourses,
   completionRate:staff?Math.round(completedStaff/staff*100):0,
   courseRate:courses?Math.round(submittedCourses/courses*100):0,
 });
 const submittedCourses = completedReport.rows.reduce((sum,row)=>sum+row.courses.length,0);
 const stats = {...baseStats,...makeStats(baseStats.staff,baseStats.courses,completedGlobal.size,submittedCourses)};
 const departments=directory.departments.map(department=>{
   const base=buildReport(directory,[],{department}).stats;
   return {department,...base,...makeStats(base.staff,base.courses,
     completedByDepartment.get(department)?.size||0,submittedByDepartment.get(department)||0)};
 });
 res.set('Cache-Control','no-store').json({report:{stats},departments,
   savedRecords:records.length,legacyRecords:records.filter(x=>x.rubricVersion!==2).length});
}catch(e){next(e);}});
// Read-only diagnostics: proves whether zero totals are due to an empty DB,
// a term mismatch, validation problems, or ERP course-key changes.
app.get('/api/admin/report-diagnostics',administrator,async(_req,res,next)=>{try{
 await connectModels();
 const academicYear = process.env.ACADEMIC_YEAR || '2026-2027';
 const semester = process.env.ACADEMIC_SEMESTER === 'EVEN' ? 'EVEN' : 'ODD';
 const filter = {recordType:'course_evaluation',academicYear,semester};
 const [allDocuments,currentTermDocuments,submittedTermDocuments,records,directory] = await Promise.all([
   EvaluationModel.countDocuments({}), EvaluationModel.countDocuments(filter),
   EvaluationModel.countDocuments({...filter,status:'submitted'}),
   listAllRecords(),loadDirectory(),
 ]);
 const permitted = new Set(directory.staff.flatMap(staff=>staff.courses.map(course=>`${staff.staffId}|${course.courseKey}`)));
 const validSubmitted = records.filter(record=>record.status==='submitted');
 const matching = validSubmitted.filter(record=>permitted.has(`${record.staffId}|${record.courseKey}`));
 res.set('Cache-Control','no-store').json({ok:true,
   database:process.env.MONGO_DB_NAME || 'faculty_engagement',collection:'LMS evaluation',
   academicYear,semester,allDocuments,currentTermDocuments,submittedTermDocuments,
   validatedTermRecords:records.length,validSubmittedRecords:validSubmitted.length,
   submittedMatchingCurrentERP:matching.length,
   erpFacultyCount:directory.staff.length,
   erpEligibleCourseCount:directory.staff.reduce((count,staff)=>count+staff.courses.length,0),
 });
}catch(e){next(e);}});
app.get('/api/admin/evaluations',administrator,async(req,res,next)=>{try{const records=await listAllRecords();const directory=await loadDirectory();const permitted=new Set(directory.staff.flatMap(s=>s.courses.map(c=>`${s.staffId}|${c.courseKey}`)));const department=String(req.query.department||'');const name=String(req.query.evaluator||'').trim().toLocaleLowerCase();const filtered=records.filter(x=>permitted.has(`${x.staffId}|${x.courseKey}`)&&(!department||x.department===department)&&(!name||String(x.evaluatorName||'').trim().toLocaleLowerCase()===name));res.set('Cache-Control','no-store');res.json({records:filtered.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))});}catch(e){next(e);}});
app.get('/api/admin/history/:staffId',administrator,async(req,res,next)=>{try{const id=String(req.params.staffId||'').toUpperCase();if(!validStaffId(id))return res.status(400).json({error:'Invalid staff ID.'});res.set('Cache-Control','no-store');res.json({records:await evaluationHistory(id)});}catch(e){next(e);}});
app.get('/api/admin/export',administrator,async(req,res,next)=>{try{const {report,records,directory}=await loadReport(req);const exportReport={...report,search:String(req.query.search||'')};const wb=await createReportWorkbook(exportReport,records,'Administrator',directory);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Faculty-Studio-Admin-Report.xlsx"','Cache-Control':'no-store'});await wb.xlsx.write(res);res.end();}catch(e){next(e);}});
app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use((error,_q,res,_n)=>{console.error('[API]',error.message);if(!res.headersSent)res.status(error.status||500).json({error:error.status?error.message:'Server error. Check the ERP service, MongoDB connection, and server logs.'});});
const port=Number(process.env.PORT||4000);
databaseHealth().then(()=>{const server=app.listen(port,'0.0.0.0',()=>console.log(`[READY] BHC LMS Evaluation API: http://localhost:${port} | MongoDB connected`));server.on('error',(error:NodeJS.ErrnoException)=>{console.error('[STARTUP ERROR]',error.code==='EADDRINUSE'?`Port ${port} is already in use. Close the other API process or change PORT in server/.env.`:error.message);process.exit(1);});}).catch(error=>{console.error('[DATABASE STARTUP ERROR]',error instanceof Error?error.message:error);console.error('Confirm Atlas network access, MONGO_URI, database credentials, and indexes.');process.exit(1);});
