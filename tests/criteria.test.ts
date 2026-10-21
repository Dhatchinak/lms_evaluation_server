import test from 'node:test';
import assert from 'node:assert/strict';
import {CRITERIA,LEVELS,MAX_SCORE,blankMarks,summarize,courseKey} from '../src/shared/criteria.js';
import {flattenDepartments,normalizeDirectory} from '../src/services/directory.service.js';
import {buildReport} from '../src/services/report.service.js';
import {parseEvaluation} from '../src/utils/validation.js';

test('14 rubric inputs across 10 levels total exactly 100',()=>{
 assert.equal(CRITERIA.length,14);assert.equal(LEVELS.length,10);assert.equal(MAX_SCORE,100);
 const split=l=>CRITERIA.filter(x=>x.level===l).map(x=>x.max);
 assert.deepEqual(split('L4'),[8,2]);assert.deepEqual(split('L5'),[5,5]);assert.deepEqual(split('L7'),[5,5]);assert.deepEqual(split('L9'),[8,2]);
 assert.equal(CRITERIA.at(-1).title,'Innovative pedagogy');
});
test('all zero marks are fully completed, blanks are not',()=>{
 const marks=Object.fromEntries(CRITERIA.map(c=>[c.key,0]));assert.equal(summarize(marks).complete,true);
 const b=blankMarks();assert.equal(summarize(b).complete,false);assert.equal(summarize(b).total,0);
});
test('department timetables flatten nested repeated hours and normalize to unique staff courses',()=>{
 const item={staffid:'BHC-STE-00001',staffName:'Dr. Test',paperCode:'TEST101',paperTitle:'Sample course'};
 const data={departments:[{department_name:'COMPUTER SCIENCE',programs:[{program_id:'UG-BSC-CS',years:[{year:2,sections:[{section_name:'A',TimeTable:[{hours:[{papers:[item,item]},{papers:[item]}]}]}]}]}]}]};
 const rows=flattenDepartments(data);assert.equal(rows.length,3);
 const s=normalizeDirectory(rows);assert.equal(s.length,1);assert.equal(s[0].courses.length,1);
});
test('reports count all assigned courses, averaging only submitted current-rubric entries',()=>{
 const a={paper_code:'X1',paper_title:'X',program_id:'P',year:'2',section_name:'A',department_name:'CS'};
 const b={...a,paper_code:'X2',paper_title:'Y'};
 const staff={staffId:'BHC-STE-11111',name:'Dr. First',departments:['CS'],courses:[{...a,courseKey:courseKey(a)},{...b,courseKey:courseKey(b)}]};
 const data={staff:[staff]};const r={staffId:staff.staffId,courseKey:courseKey(a),status:'submitted',total:84,rubricVersion:2};
 const partial=buildReport(data,[r]);assert.equal(partial.stats.completedStaff,0);assert.equal(partial.stats.submittedCourses,1);assert.equal(partial.rows[0].average,84);assert.equal(partial.rows[0].averageIsFinal,false);
 const all=buildReport(data,[r,{...r,courseKey:courseKey(b),total:76}]);assert.equal(all.stats.completedStaff,1);assert.equal(all.rows[0].average,80);
 const old=buildReport(data,[{...r,rubricVersion:undefined}]);assert.equal(old.stats.submittedCourses,0);assert.equal(old.rows[0].courses[0].status,'legacy');
});
test('submitted marks require LMS code, evaluator name and all 14 fields',()=>{
 const rawCourse={paper_code:'X1',paper_title:'X',paper_type:'Core',program_id:'P',year:'2',section_name:'A',department_name:'CS'};const c={...rawCourse,courseKey:courseKey(rawCourse)};
 const f={staffId:'BHC-STE-11111',name:'Dr. First',departments:['CS'],courses:[c]};
 const marks=Object.fromEntries(CRITERIA.map(x=>[x.key,x.max]));
 const base={staffId:f.staffId,courseKey:c.courseKey,marks,lmsCode:'MOODLE-1',evaluatorName:'Evaluator',status:'submitted' as const};
 const parsed=parseEvaluation(base,f);assert.equal(parsed.total,100);assert.equal(parsed.rubricVersion,2);
 assert.throws(()=>parseEvaluation({...base,lmsCode:''},f),/LMS code/);
 assert.throws(()=>parseEvaluation({...base,marks:{...marks,assignmentGiven:9}},f),/0–8/);
});
