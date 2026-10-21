import test from 'node:test';
import assert from 'node:assert/strict';
import {CRITERIA} from '../src/shared/criteria.js';
import {buildCompletedReport} from '../src/services/report.service.js';
import {createReportWorkbook} from '../src/services/report-export.service.js';

test('one submitted course exports a current staff average and every rubric mark', async () => {
 const paper = (code:string) => ({courseKey:`${code}|PG|2|A`,paper_code:code,paper_title:`Course ${code}`,
  paper_type:'Core',department_name:'CS',program_id:'PG',year:'2',section_name:'A'});
 const staff={staffId:'BHC-STE-00001',name:'Faculty One',departments:['CS'],courses:[paper('T1'),paper('T2'),paper('T3')]};
 const directory={staff:[staff],departments:['CS']};
 const marks=Object.fromEntries(CRITERIA.map(c=>[c.key,c.max]));
 const record={staffId:staff.staffId,staffName:staff.name,courseKey:staff.courses[0].courseKey,evaluatorId:'BHC-STE-00390',
  evaluatorName:'Sample Evaluator',status:'submitted',rubricVersion:2,total:100,marks,lmsCode:'CS-LMS',updatedAt:'2026-10-21T12:00:00Z'};
 const report=buildCompletedReport(directory,[record]);
 assert.equal(report.rows.length,1);
 assert.equal(report.stats.submittedCourses,1);
 assert.equal(report.rows[0].averageIsFinal,false);
 assert.equal(report.rows[0].courses[0].marks.assignmentGiven,8);
 const workbook=await createReportWorkbook(report,[record],'Evaluator',directory);
 const summary=workbook.getWorksheet('Evaluated Faculty');
 const breakdown=workbook.getWorksheet('Component-wise Marks');
 assert.ok(summary);
 assert.ok(breakdown);
 assert.equal(summary.getRow(7).getCell(8).value,'Current');
 const keys=breakdown.columns.map(c=>c.key);
 for(const criterion of CRITERIA) {
  const ix=keys.indexOf(criterion.key);
  assert.ok(ix>=0,`Missing ${criterion.key}`);
  assert.equal(breakdown.getRow(2).getCell(ix+1).value,criterion.max);
 }
 assert.equal(breakdown.getRow(2).getCell(keys.indexOf('total')+1).value,100);
});
