import {isCurrentRubric} from '../shared/criteria.js';
export function buildReport(directory, records, opts: {department?:string;search?:string;evaluatorName?:string;onlyTouched?:boolean}={}){
 const department=String(opts.department||'').trim(); const search=String(opts.search||'').toLowerCase().trim();
 const evaluatorName=String(opts.evaluatorName||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
 const onlyTouched=Boolean(opts.onlyTouched);
 const all=[];
 const relevant=records.filter(r=>!evaluatorName||String(r.evaluatorName||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()===evaluatorName);
 // Reports use the newest submitted current-rubric mark when multiple evaluators exist.
 const byKey=new Map();
 for(const r of [...relevant].sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')))){
  const key=`${r.staffId}|${r.courseKey}`;
  const previous=byKey.get(key);
  const rank=x=>x?.rubricVersion===2&&x?.status==='submitted'?2:x?.rubricVersion===2?1:0;
  if(!previous||rank(r)>=rank(previous))byKey.set(key,r);
 }
 for(const s of directory.staff){
   const eligible=s.courses.filter(c=>!department||c.department_name===department);
   if(!eligible.length)continue;
   if(onlyTouched&&!eligible.some(c=>byKey.has(`${s.staffId}|${c.courseKey}`)))continue;
   if(search&&!`${s.name} ${s.staffId} ${eligible.map(c=>c.paper_title).join(' ')}`.toLowerCase().includes(search))continue;
   const courses=eligible.map(c=>{
    const saved=byKey.get(`${s.staffId}|${c.courseKey}`);
    const legacy=saved&&!isCurrentRubric(saved);
    return {...c,status:legacy?'legacy':saved?.status||'not-started',total:!legacy&&saved?.status==='submitted'?saved.total:null,lmsCode:saved?.lmsCode||'',updatedAt:saved?.updatedAt||null,legacy:Boolean(legacy)};
   });
   const submitted=courses.filter(c=>c.status==='submitted');
   const avg=submitted.length?Math.round(submitted.reduce((sum,c)=>sum+c.total,0)/submitted.length*100)/100:null;
   const isComplete=submitted.length===courses.length&&courses.length>0;
   const status=isComplete?'completed':courses.some(c=>c.status!=='not-started')?'in-progress':'not-started';
   all.push({staffId:s.staffId,staffName:s.name,department:department||s.departments.join(', '),departments:s.departments,courseCount:courses.length,completedCourses:submitted.length,average:avg,averageIsFinal:isComplete,status,courses});
 }
 const courseCount=all.reduce((sum,s)=>sum+s.courseCount,0),submittedCourses=all.reduce((sum,s)=>sum+s.completedCourses,0);
 return {rows:all,stats:{staff:all.length,completedStaff:all.filter(s=>s.status==='completed').length,inProgressStaff:all.filter(s=>s.status==='in-progress').length,notStartedStaff:all.filter(s=>s.status==='not-started').length,courses:courseCount,submittedCourses,completionRate:all.length?Math.round(100*all.filter(s=>s.status==='completed').length/all.length):0,courseRate:courseCount?Math.round(100*submittedCourses/courseCount):0},department:department||'All departments',evaluatorName:evaluatorName||null,onlyTouched};
}

/** Submitted-course report. A faculty member appears as soon as one theory course is
 * submitted. Remaining courses are never treated as zero, and the displayed
 * average is final only when one evaluator submits all eligible theory courses.
 * Every evaluator-staff pair stays independent (prefer immutable evaluator ID).
 */
export function buildCompletedReport(directory, records, opts: {department?: string; search?: string; evaluatorName?: string} = {}) {
 const norm = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
 const dep = String(opts.department ?? '').trim();
 const search = norm(opts.search);
 const evaluatorFilter = norm(opts.evaluatorName);
 const directoryById = new Map<string, any>(directory.staff.map(s => [s.staffId, s]));
 const current = new Map<string, any>();
 const evaluatorNames = new Map<string, string>();
 for (const record of records) {
  if (record.status !== 'submitted' || !isCurrentRubric(record) || !record.evaluatorName) continue;
  const staff = directoryById.get(record.staffId);
  if (!staff || !staff.courses.some(c => c.courseKey === record.courseKey)) continue;
  if (evaluatorFilter && norm(record.evaluatorName) !== evaluatorFilter) continue;
  const evaluatorKey = String(record.evaluatorId || norm(record.evaluatorName)).toUpperCase();
  const key = `${evaluatorKey}|${record.staffId}|${record.courseKey}`;
  const existing = current.get(key);
  if (!existing || String(existing.updatedAt || '') <= String(record.updatedAt || '')) current.set(key, record);
  evaluatorNames.set(evaluatorKey, String(record.evaluatorName).trim());
 }
 const pairs = new Map<string, {evaluatorKey: string; staffId: string; submitted: Map<string, any>}>();
 for (const [key, record] of current) {
  const evaluatorKey = String(record.evaluatorId || norm(record.evaluatorName)).toUpperCase();
  const pairKey = `${evaluatorKey}|${record.staffId}`;
  if (!pairs.has(pairKey)) pairs.set(pairKey, {evaluatorKey, staffId: record.staffId, submitted: new Map()});
  pairs.get(pairKey)!.submitted.set(record.courseKey, record);
 }
 const rows: any[] = [];
 for (const pair of pairs.values()) {
  const staff: any = directoryById.get(pair.staffId);
  if (!staff?.courses?.length) continue;
  // Compute finality from ALL eligible courses, even when the report is filtered.
  const allSubmitted = staff.courses.filter(c => pair.submitted.has(c.courseKey));
  if (!allSubmitted.length) continue;
  const visibleCourses = allSubmitted.filter(c => !dep || c.department_name === dep);
  if (!visibleCourses.length) continue;
  const evaluatorName = evaluatorNames.get(pair.evaluatorKey) || '';
  if (search && !norm(`${staff.name} ${staff.staffId} ${staff.departments.join(' ')} ${evaluatorName} ${visibleCourses.map(c => `${c.paper_title} ${c.paper_code}`).join(' ')}`).includes(search)) continue;
  const courses = visibleCourses.map(c => {
   const r = pair.submitted.get(c.courseKey);
   return { ...c, status: 'submitted', total: r.total, lmsCode: r.lmsCode || '', updatedAt: r.updatedAt || null,
    marks: {...r.marks}, evaluatorId: r.evaluatorId || '', evaluatorName,
    staffId: staff.staffId, staffName: staff.name };
  });
  const allAverage = allSubmitted.reduce((sum, c) => sum + pair.submitted.get(c.courseKey).total, 0) / allSubmitted.length;
  // Faculty average always uses ALL submitted theory courses for this evaluator,
  // even if a department filter limits which course lines are visible.
  const isFinal = allSubmitted.length === staff.courses.length;
  rows.push({ staffId: staff.staffId, staffName: staff.name, departments: staff.departments,
   department: staff.departments.join(', '), evaluatorName, evaluatorId: pair.evaluatorKey,
   courseCount: staff.courses.length, completedCourses: allSubmitted.length,
   shownSubmittedCourses: courses.length, average: Math.round(allAverage * 100) / 100,
   overallSubmittedAverage: Math.round(allAverage * 100) / 100,
   averageIsFinal: isFinal, status: isFinal ? 'completed' : 'in-progress', courses });
 }
 rows.sort((a,b) => a.evaluatorName.localeCompare(b.evaluatorName) || a.staffName.localeCompare(b.staffName));
 const uniqueStaff = new Set(rows.map(r => r.staffId)).size;
 const courseCount = rows.reduce((sum,r) => sum + r.courses.length, 0);
 const finishedStaff = rows.filter(r => r.averageIsFinal).length;
 const names = [...new Set(rows.map(r => r.evaluatorName))];
 return { rows, department: dep || 'All departments', evaluatorName: evaluatorFilter || null,
  mode: 'submitted-courses', evaluatorNames: names,
  stats: {staff: rows.length, evaluatedStaff: uniqueStaff, completedStaff: finishedStaff,
   inProgressStaff: rows.length - finishedStaff, uniqueStaff, evaluatorCount: new Set(rows.map(r => r.evaluatorId)).size,
   courses: courseCount, submittedCourses: courseCount, completionRate: rows.length ? Math.round(100*finishedStaff/rows.length) : 0, courseRate: 100} };
}
