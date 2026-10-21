import test from 'node:test';
import assert from 'node:assert/strict';
import {isTheoryPaper,theoryDirectory} from '../src/utils/theory.js';
import {flattenDepartments,normalizeDirectory} from '../src/services/directory.service.js';
import {buildCompletedReport} from '../src/services/report.service.js';
import {courseKey} from '../src/shared/criteria.js';
const course=(code,dept='CS',kind='Core')=>{const x={paper_code:code,paper_title:code,paper_type:kind,department_name:dept,program_id:'UG',year:'2',section_name:'A'};return {...x,courseKey:courseKey(x)};};
const fixture=()=>{const staff=[{staffId:'BHC-STE-00001',name:'Prof A',departments:['CS','MATH'],courses:[course('T1'),course('T2','MATH')]},{staffId:'BHC-STE-00002',name:'Prof B',departments:['CS'],courses:[course('T3')]}];return {staff,departments:['CS','MATH']};};
const rec=(s,c,e,mark=80,status='submitted')=>({staffId:s.staffId,staffName:s.name,courseKey:c.courseKey,evaluatorName:e,status,total:mark,rubricVersion:2,lmsCode:'LMS-'+c.paper_code,updatedAt:'2026-10-21T10:00:00.000Z'});
test('practical type and lab title excluded; theoretical coursework remains',()=>{
 assert.equal(isTheoryPaper({paper_title:'Digital Image Processing Lab',paper_type:'Core'}),false);
 assert.equal(isTheoryPaper({paper_title:'Python Programming',paper_type:'Core Prac. V'}),false);
 assert.equal(isTheoryPaper({paper_title:'Applied Computing',paper_type:'CC Practical-I'}),false);
 assert.equal(isTheoryPaper({paper_title:'Data Science Laboratory',paper_type:'Core'}),false);
 assert.equal(isTheoryPaper({paper_title:'Digital Image Processing',paper_type:'Core VII'}),true);
 assert.equal(isTheoryPaper({paper_title:'Core Project with Viva Voce',paper_type:'Core Project'}),false);
 assert.equal(isTheoryPaper({paper_title:'Field Work II',paper_type:'Field Work II'}),false);
 assert.equal(isTheoryPaper({paper_title:'Software Project Management',paper_type:'Elective IV'}),true);
 assert.equal(isTheoryPaper({paper_title:'Practical Research Methods',paper_type:'Core'}),false);
});
test('normalization of nested ERP timetable excludes practical course entries',()=>{
 const item=(code,title,type)=>({staffid:'BHC-STE-00001',staffName:'Prof A',paperCode:code,paperTitle:title,paperType:type});
 const payload={departments:[{department_name:'CS',programs:[{program_id:'UG',years:[{year:2,sections:[{section_name:'A',TimeTable:[{hours:[{papers:[item('T1','Computer Science','Core'),item('P1','Computer Science Lab','Core')]}]}]}]}]}]}]};
 const staff=normalizeDirectory(flattenDepartments(payload));assert.equal(staff.length,1);assert.equal(staff[0].courses.length,1);assert.equal(staff[0].courses[0].paper_code,'T1');
});
test('a large live timetable normalizes duplicate hours without adding practical papers',()=>{
 const papers: Array<{staffid:string;staffName:string;paperCode:string;paperTitle:string;paperType:string}> = [];
 const departments = [{
  department_name: 'COMPUTER SCIENCE',
  programs: [{program_id:'UG',years:[{year:2,sections:[{
   section_name:'A',TimeTable:[{hours:[{papers}]}]
  }]}]}]
 }];
 for(let i=0;i<250;i++){
   const staffid=`BHC-STE-${String(i).padStart(5,'0')}`;
   papers.push({staffid,staffName:`Faculty ${i}`,paperCode:`T${i}`,paperTitle:'Theory',paperType:'Core'});
   papers.push({staffid,staffName:`Faculty ${i}`,paperCode:`T${i}`,paperTitle:'Theory',paperType:'Core'});
   papers.push({staffid,staffName:`Faculty ${i}`,paperCode:`P${i}`,paperTitle:'Theory Lab',paperType:'Core'});
 }
 const normalized=normalizeDirectory(flattenDepartments({departments}));
 assert.equal(normalized.length,250);
 assert.equal(normalized.reduce((sum,s)=>sum+s.courses.length,0),250);
 assert.ok(normalized.every(s=>s.courses.every(isTheoryPaper)));
});
test('one submitted theory course immediately appears in evaluator report as current average',()=>{
 const d=fixture(),a=d.staff[0];const submitted=rec(a,a.courses[0],'Eva',80);
 const result=buildCompletedReport(d,[submitted],{evaluatorName:'Eva'});
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].courses.length,1);
 assert.equal(result.rows[0].average,80);
 assert.equal(result.rows[0].completedCourses,1);
 assert.equal(result.rows[0].courseCount,2);
 assert.equal(result.rows[0].averageIsFinal,false);
 assert.equal(result.stats.uniqueStaff,1);
 assert.equal(result.stats.completedStaff,0);
});
test('drafts are excluded while newly submitted courses update average and finality',()=>{
 const d=fixture(),a=d.staff[0],records=[rec(a,a.courses[0],'Eva',80),rec(a,a.courses[1],'Eva',90,'draft')];
 let partial=buildCompletedReport(d,records,{evaluatorName:'Eva'});
 assert.equal(partial.rows.length,1);
 assert.equal(partial.rows[0].courses.length,1);
 assert.equal(partial.rows[0].average,80);
 assert.equal(partial.rows[0].averageIsFinal,false);
 records[1].status='submitted';
 const final=buildCompletedReport(d,records,{evaluatorName:'Eva'});
 assert.equal(final.rows.length,1);
 assert.equal(final.rows[0].average,85);
 assert.equal(final.rows[0].averageIsFinal,true);
 assert.equal(final.rows[0].courses[1].lmsCode,'LMS-T2');
 assert.equal(final.stats.completedStaff,1);
});
test('department filter displays submitted courses only without changing finality',()=>{
 const d=fixture(),a=d.staff[0],records=[rec(a,a.courses[0],'Eva')];
 let cs=buildCompletedReport(d,records,{evaluatorName:'Eva',department:'CS'});
 assert.equal(cs.rows.length,1);
 assert.equal(cs.rows[0].averageIsFinal,false);
 assert.equal(cs.rows[0].courses.length,1);
 assert.equal(buildCompletedReport(d,records,{evaluatorName:'Eva',department:'MATH'}).rows.length,0);
 records.push(rec(a,a.courses[1],'Eva'));
 cs=buildCompletedReport(d,records,{evaluatorName:'Eva',department:'CS'});
 assert.equal(cs.rows[0].averageIsFinal,true);
 assert.equal(cs.rows[0].courses.length,1);
 assert.equal(buildCompletedReport(d,records,{evaluatorName:'Eva',department:'MATH'}).rows.length,1);
});
test('admin completion report keeps two evaluators separate even for same faculty',()=>{
 const d=fixture(),a=d.staff[0],b=d.staff[1];const records=[rec(a,a.courses[0],'Eva One',60),rec(a,a.courses[1],'Eva One',80),rec(a,a.courses[0],'Eva Two',90),rec(a,a.courses[1],'Eva Two',100),rec(b,b.courses[0],'Eva Two',0)];
 const rep=buildCompletedReport(d,records);
 assert.equal(rep.rows.length,3);assert.equal(rep.stats.uniqueStaff,2);assert.equal(rep.stats.evaluatorCount,2);assert.equal(rep.stats.submittedCourses,5);
 assert.equal(rep.rows.find(r=>r.evaluatorName==='Eva One').average,70);
 assert.equal(rep.rows.find(r=>r.evaluatorName==='Eva Two'&&r.staffId===a.staffId).average,95);
 assert.equal(rep.rows.find(r=>r.staffId===b.staffId).average,0);
 assert.equal(buildCompletedReport(d,records,{evaluatorName:'Eva One'}).rows.length,1);
});
test('only submitted current-rubric records count',()=>{
 const d=fixture(),b=d.staff[1],r=rec(b,b.courses[0],'Eva');
 assert.equal(buildCompletedReport(d,[{...r,rubricVersion:1}]).rows.length,0);
 assert.equal(buildCompletedReport(d,[{...r,status:'draft'}]).rows.length,0);
 assert.equal(buildCompletedReport(d,[r]).rows.length,1);
});
test('two evaluators each submitting different courses do NOT make staff fully completed',()=>{
 const d=fixture(),person=d.staff[0];
 const records=[rec(person,person.courses[0],'Eva One',88),rec(person,person.courses[1],'Eva Two',96)];
 const report=buildCompletedReport(d,records);
 assert.equal(report.rows.length,2);
 assert.equal(report.stats.uniqueStaff,1);
 assert.equal(report.stats.completedStaff,0);
 assert.ok(report.rows.every(r=>!r.averageIsFinal && r.courses.length===1));
});
