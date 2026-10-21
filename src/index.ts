import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {login,authenticate,approvedUsers,listManagedAccounts,changePassword,resetPasswordByAdmin,verifyPassword} from './services/auth.service.js';
import {DEMO_MODE} from './services/staff.service.js';
import {loadDirectory,directoryStatus} from './services/directory.service.js';
import {listEvaluations,saveEvaluation,listAllRecords,databaseHealth,evaluationHistory} from './models/schema-storage.js';
import {parseEvaluation,validStaffId} from './utils/validation.js';
import {buildReport,buildCompletedReport} from './services/report.service.js';
import {createReportWorkbook} from './services/report-export.service.js';

if(!process.env.MONGO_URI){console.error('\n[CONFIG ERROR] MONGO_URI is missing. Copy server/.env.example to server/.env, then enter your MongoDB Atlas URI. See server/START-HERE.md.\n');process.exit(1);}
if(DEMO_MODE){console.error('\n[CONFIG ERROR] DEMO_MODE must be false for MongoDB-backed evaluations. Update server/.env.\n');process.exit(1);}
if((process.env.SESSION_SECRET||'').length<32){console.error('\n[CONFIG ERROR] SESSION_SECRET must contain at least 32 random characters. Generate one with: node -e \"console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))\"\n');process.exit(1);}
const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'32kb'}));
app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
app.get('/api/auth/users',(_req,res)=>res.json({evaluators:approvedUsers('evaluator'),admins:approvedUsers('admin')}));
app.post('/api/auth/login',async(req,res,next)=>{try{const username=String(req.body?.staffId||req.body?.username||'').trim();const password=String(req.body?.password||'');const session=await login(username,password);if(!session)return res.status(401).json({error:'Invalid approved account or password. Ask the LMS administrators to check account setup.'});res.set('Cache-Control','no-store');res.json(session);}catch(e){next(e);}});
app.use('/api',async(req,res,next)=>{if(req.path==='/health')return next();const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');const user=await authenticate(token);if(!user)return res.status(401).json({error:'Sign in to continue or session expired.'});(req as any).identity=user;next();});
app.get('/api/auth/me',(req,res)=>{const user=(req as any).identity;res.set('Cache-Control','no-store');res.json({username:user.username,role:user.role,name:user.name,department:user.department});});
const identity=(req:any)=>req.identity as {username:string,role:string,name:string,department?:string};
const isAdmin=(req:any)=>identity(req)?.role==='admin';
const evaluatorName=(req:any)=>identity(req)?.name||'';
const isEvaluator=(req:any)=>identity(req)?.role==='evaluator';
const viewer=(_req:any,_res:any,next:any)=>next();
const evaluator=(req:any,res:any,next:any)=>isEvaluator(req)?next():res.status(403).json({error:'Evaluator permission required.'});
const administrator=(req:any,res:any,next:any)=>isAdmin(req)?next():res.status(403).json({error:'Administrator permission required.'});
app.get('/api/admin/accounts',administrator,async(_req,res,next)=>{try{res.json({users:await listManagedAccounts()});}catch(e){next(e)}});
app.post('/api/admin/accounts/reset-password',administrator,async(req,res,next)=>{try{const id=String(req.body?.username||'').toUpperCase(),password=String(req.body?.password||'');if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});const ok=await resetPasswordByAdmin(id,password);if(!ok)return res.status(404).json({error:'Evaluator account not found.'});res.json({ok:true});}catch(e){next(e)}});
app.post('/api/auth/change-password',async(req,res,next)=>{try{const user=identity(req),oldPassword=String(req.body?.oldPassword||''),newPassword=String(req.body?.newPassword||'');const {AccountModel}=await import('./models/schemas/index.js');const acct=await AccountModel.findOne({username:user.username}).lean();if(!acct||!verifyPassword(oldPassword,acct.passwordSalt,acct.passwordHash))return res.status(403).json({error:'Current password is incorrect.'});await changePassword(user.username,newPassword);res.json({ok:true,signOut:true});}catch(e){next(e)}});
app.get('/api/health',async (_q,r)=>{try{await databaseHealth();r.json({ok:true,database:'MongoDB',collection:'LMS evaluation',persistence:'evaluations and administrator accounts only',directory:directoryStatus(),roles:['evaluator','admin'],rubricVersion:2});}catch{r.status(503).json({ok:false,database:'unavailable'});}});
app.get('/api/directory',viewer,async(req,res,next)=>{try{res.set('Cache-Control','no-store');const data=await Promise.race([loadDirectory(req.query.refresh==='true'),new Promise<never>((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('The ERP directory is still synchronizing. Please retry in a few moments.'),{status:503})),25000))]);res.json(data);}catch(e){next(e);}});
// Institution-wide progress is intentionally separate from evaluator-owned reports.
// A staff member's submitted courses remain completed when a different evaluator logs in.
app.get('/api/faculty-progress',viewer,async(_req,res,next)=>{try{
 const [directory,records]=await Promise.all([loadDirectory(),listAllRecords()]);
 const progress=buildReport(directory,records);
 res.set('Cache-Control','no-store');
 res.json({rows:progress.rows.map(row=>({staffId:row.staffId,courseCount:row.courseCount,completedCourses:row.completedCourses,average:row.average,status:row.status}))});
}catch(e){next(e);}});
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
app.get('/api/report/export',viewer,async(req,res,next)=>{try{const {report,records,directory}=await loadReport(req);const exportReport={...report,search:String(req.query.search||'')};const wb=await createReportWorkbook(exportReport,records,isAdmin(req)?'Administrator':'Evaluator',directory);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Faculty-Studio-Completion-Report.xlsx"','Cache-Control':'no-store'});await wb.xlsx.write(res);res.end();}catch(e){next(e);}});
app.get('/api/admin/overview',administrator,async(req,res,next)=>{try{const {directory,records}=await loadReport(req);// An administrator cannot combine two different evaluators' partially submitted
 // courses and falsely mark a faculty member complete. Keep evaluator-specific
 // submissions separate when calculating institution and department summaries.
 const accurateStats=(department?:string)=>{
   const dirStats=buildReport(directory,[],{department}).stats;
   const scoped=buildCompletedReport(directory,records,{department});
   const fullyEvaluatedStaff=new Set(scoped.rows.filter(r=>r.averageIsFinal).map(r=>r.staffId)).size;
   const savedCourseEvaluations=scoped.rows.reduce((total,r)=>total+r.courses.length,0);
   return {...dirStats,completedStaff:fullyEvaluatedStaff,submittedCourses:savedCourseEvaluations,
    completionRate:dirStats.staff?Math.round(fullyEvaluatedStaff/dirStats.staff*100):0};
 };
 const report={stats:accurateStats()};
 const departments=directory.departments.map(department=>({department,...accurateStats(department)}));
 res.set('Cache-Control','no-store');res.json({report,departments,savedRecords:records.length,legacyRecords:records.filter(x=>x.rubricVersion!==2).length});}catch(e){next(e);}});
app.get('/api/admin/evaluations',administrator,async(req,res,next)=>{try{const records=await listAllRecords();const directory=await loadDirectory();const permitted=new Set(directory.staff.flatMap(s=>s.courses.map(c=>`${s.staffId}|${c.courseKey}`)));const department=String(req.query.department||'');const name=String(req.query.evaluator||'').trim().toLocaleLowerCase();const filtered=records.filter(x=>permitted.has(`${x.staffId}|${x.courseKey}`)&&(!department||x.department===department)&&(!name||String(x.evaluatorName||'').trim().toLocaleLowerCase()===name));res.set('Cache-Control','no-store');res.json({records:filtered.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))});}catch(e){next(e);}});
app.get('/api/admin/history/:staffId',administrator,async(req,res,next)=>{try{const id=String(req.params.staffId||'').toUpperCase();if(!validStaffId(id))return res.status(400).json({error:'Invalid staff ID.'});res.set('Cache-Control','no-store');res.json({records:await evaluationHistory(id)});}catch(e){next(e);}});
app.get('/api/admin/export',administrator,async(req,res,next)=>{try{const {report,records,directory}=await loadReport(req);const exportReport={...report,search:String(req.query.search||'')};const wb=await createReportWorkbook(exportReport,records,'Administrator',directory);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Faculty-Studio-Admin-Report.xlsx"','Cache-Control':'no-store'});await wb.xlsx.write(res);res.end();}catch(e){next(e);}});
app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use((error,_q,res,_n)=>{console.error('[API]',error.message);if(!res.headersSent)res.status(error.status||500).json({error:error.status?error.message:'Server error. Check the ERP service, MongoDB connection, and server logs.'});});
const port=Number(process.env.PORT||4000);
databaseHealth().then(()=>{const server=app.listen(port,'0.0.0.0',()=>console.log(`[READY] Faculty Studio API: http://localhost:${port} | MongoDB connected`));server.on('error',(error:NodeJS.ErrnoException)=>{console.error('[STARTUP ERROR]',error.code==='EADDRINUSE'?`Port ${port} is already in use. Close the other API process or change PORT in server/.env.`:error.message);process.exit(1);});}).catch(error=>{console.error('[DATABASE STARTUP ERROR]',error instanceof Error?error.message:error);console.error('Confirm Atlas network access, MONGO_URI, database credentials, and indexes.');process.exit(1);});
