import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/services/report.service.js';
import { courseKey } from '../src/shared/criteria.js';

function fixture(){
 const c=(paper_code,department_name)=>({paper_code,paper_title:paper_code,program_id:'PG',year:'2',section_name:'A',department_name,courseKey:paper_code+'|PG|2|A'});
 return { staff:[
 {staffId:'BHC-STE-01001',name:'Faculty A',departments:['CS','MATH'],courses:[c('C1','CS'),c('M1','MATH')]},
 {staffId:'BHC-STE-01002',name:'Faculty B',departments:['CS'],courses:[c('C2','CS')]},
 ]};
}
test('department filter respects timetable department without losing institution-wide staff',()=>{
 const d=fixture();assert.equal(buildReport(d,[]).stats.staff,2);
 const cs=buildReport(d,[],{department:'CS'});assert.equal(cs.stats.staff,2);assert.equal(cs.stats.courses,2);
 const math=buildReport(d,[],{department:'MATH'});assert.equal(math.stats.staff,1);assert.equal(math.stats.courses,1);
});
test('zero is a valid submitted score and counts toward final average',()=>{
 const d=fixture(),records=[
 {staffId:'BHC-STE-01002',courseKey:'C2|PG|2|A',total:0,status:'submitted',rubricVersion:2},
 ];const rep=buildReport(d,records,{department:'CS'});
 assert.equal(rep.stats.completedStaff,1);assert.equal(rep.rows.find(x=>x.staffId.endsWith('002')).average,0);
});
test('draft courses are not completed and do not add zeros to averages',()=>{
 const d=fixture(),records=[
 {staffId:'BHC-STE-01001',courseKey:'C1|PG|2|A',total:98,status:'submitted',rubricVersion:2},
 {staffId:'BHC-STE-01001',courseKey:'M1|PG|2|A',total:0,status:'draft',rubricVersion:2},
 ];const rep=buildReport(d,records);const a=rep.rows.find(x=>x.staffId.endsWith('001'));
 assert.equal(a.average,98);assert.equal(a.status,'in-progress');assert.equal(a.averageIsFinal,false);
});
test('search filters reported staff by name, ID, and course title',()=>{
 const d=fixture();const x=buildReport(d,[],{search:'C2'});assert.equal(x.stats.staff,1);assert.equal(x.rows[0].staffName,'Faculty B');
});

test('evaluator report lists only staff with saved marks; full admin report still lists all',()=>{
 const d=fixture();const records=[{staffId:'BHC-STE-01001',courseKey:'C1|PG|2|A',status:'submitted',rubricVersion:2,total:87,evaluatorName:'Dr. Evaluator A'},
 {staffId:'BHC-STE-01002',courseKey:'C2|PG|2|A',status:'submitted',rubricVersion:2,total:91,evaluatorName:'Dr. Evaluator B'}];
 const a=buildReport(d,records,{evaluatorName:' dr. evaluator a ',onlyTouched:true});
 assert.equal(a.stats.staff,1);assert.equal(a.rows[0].staffName,'Faculty A');assert.equal(a.rows[0].completedCourses,1);assert.equal(a.rows[0].courseCount,2);assert.equal(a.rows[0].average,87);assert.equal(a.rows[0].status,'in-progress');
 const b=buildReport(d,records,{evaluatorName:'Dr. Evaluator B',onlyTouched:true});assert.equal(b.rows.length,1);assert.equal(b.rows[0].staffName,'Faculty B');
 assert.equal(buildReport(d,records).stats.staff,2);
 assert.equal(buildReport(d,[],{evaluatorName:'Dr. Evaluator A',onlyTouched:true}).stats.staff,0);
});
test('draft marks include staff in evaluator report without adding draft to average',()=>{
 const d=fixture(),draft={staffId:'BHC-STE-01001',courseKey:'C1|PG|2|A',status:'draft',rubricVersion:2,total:90,evaluatorName:'Evaluator One'};
 const rep=buildReport(d,[draft],{evaluatorName:'Evaluator One',onlyTouched:true});assert.equal(rep.rows.length,1);assert.equal(rep.rows[0].completedCourses,0);assert.equal(rep.rows[0].average,null);assert.equal(rep.rows[0].status,'in-progress');
});
