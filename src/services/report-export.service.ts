import ExcelJS from 'exceljs';
import {CRITERIA} from '../shared/criteria.js';
const C={ink:'233753',blue:'195ECF',pale:'ECF4FF',white:'FFFFFF',border:'DDE6F1',muted:'61738D'};
const normalize=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
function styleRow(row,header=false){
 row.height=header?35:28;
 row.eachCell({includeEmpty:true},cell=>{
  cell.font={name:'Aptos',size:header?12:11,bold:header,color:{argb:header?C.white:C.ink}};
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:header?C.blue:C.white}};
  cell.alignment={vertical:'middle',wrapText:true};
  cell.border={bottom:{style:'hair',color:{argb:C.border}}};
 });
}
function top(sh,heading,detail,last){
 sh.mergeCells(`A1:${last}1`);sh.getCell('A1').value=heading;
 sh.getCell('A1').font={name:'Aptos Display',size:17,bold:true,color:{argb:C.ink}};sh.getRow(1).height=40;
 sh.mergeCells(`A2:${last}2`);sh.getCell('A2').value=detail;
 sh.getCell('A2').font={name:'Aptos',size:12,color:{argb:C.blue}};sh.getRow(2).height=28;
}
export async function createReportWorkbook(report,records,role='Evaluator',directory=null){
 const wb=new ExcelJS.Workbook();wb.creator='Faculty Studio';wb.title='Submitted Theory Course Evaluation Report';
 const date=new Date().toLocaleDateString('en-IN');
 const evaluator=role==='Evaluator'?report.evaluatorName||'Signed-in evaluator':'All evaluators';
 const details=`${role} · ${report.department} · ${evaluator} · ${date} · THEORY PAPERS ONLY`;
 const sh=wb.addWorksheet('Evaluated Faculty',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 sh.columns=[{width:8},{width:23},{width:30},{width:28},{width:27},{width:18},{width:16},{width:18}];
 top(sh,'BISHOP HEBER COLLEGE (AUTONOMOUS) — LMS EVALUATION',`ODD Semester 2026–2027 · ${details}`,'H');
 sh.mergeCells('A4:H4');sh.getCell('A4').value=`Evaluated faculty: ${report.stats.uniqueStaff}   Fully evaluated: ${report.stats.completedStaff}   Submitted theory courses: ${report.stats.submittedCourses}   Evaluators: ${report.stats.evaluatorCount}`;sh.getCell('A4').font={bold:true,color:{argb:C.ink},size:12};
 const head=sh.getRow(6);head.values=['No.','Staff ID','Faculty name','Department(s)','Evaluator','Submitted courses','Average / 100','Average type'];styleRow(head,true);
 for(const [i,r] of report.rows.entries()){
  const row=sh.addRow([i+1,r.staffId,r.staffName,r.department,r.evaluatorName,r.courses.length,r.average,r.averageIsFinal?'Final':'Current']);styleRow(row);row.getCell(7).numFmt='0.00';
 }
 sh.addRow([]);const sig=sh.addRow(['','Evaluator Signature','','','','LMS Coordinator Signature','','']);sig.height=56;sig.font={name:'Aptos',size:12,bold:true,color:{argb:C.ink}};
 sh.views=[{state:'frozen',ySplit:6}];sh.autoFilter={from:'A6',to:'H6'};
 sh.headerFooter.oddFooter='Bishop Heber College (Autonomous) · Page &P of &N';
 const courses=wb.addWorksheet('Theory Course Details');
 courses.columns=[{header:'Evaluator',key:'evaluator',width:25},{header:'Faculty name',key:'staff',width:31},{header:'Staff ID',key:'staffId',width:22},{header:'Department',key:'dept',width:29},{header:'Paper code',key:'code',width:17},{header:'Course title',key:'title',width:50},{header:'Program',key:'program',width:19},{header:'Year',key:'year',width:9},{header:'Section',key:'section',width:13},{header:'LMS code',key:'lms',width:20},{header:'Marks / 100',key:'marks',width:18},{header:'Staff average',key:'average',width:19},{header:'Submitted at',key:'at',width:22}];
 styleRow(courses.getRow(1),true);
 for(const r of report.rows){for(const c of r.courses){let line=courses.addRow({evaluator:r.evaluatorName,staff:r.staffName,staffId:r.staffId,dept:c.department_name,code:c.paper_code,title:c.paper_title,program:c.program_id,year:c.year,section:c.section_name,lms:c.lmsCode,marks:c.total,average:r.average,at:c.updatedAt});styleRow(line);line.getCell('K').numFmt='0.00';line.getCell('L').numFmt='0.00';}}
 courses.views=[{state:'frozen',ySplit:1,xSplit:3}];courses.autoFilter={from:'A1',to:'M1'};
 // Mandatory per-course component sheet for evaluator AND administrator exports.
 // All 14 marks are individually stored in the saved evaluation record.
 const breakdown = wb.addWorksheet('Component-wise Marks', {pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 breakdown.columns=[
   {header:'Evaluator ID',key:'evaluatorId',width:22},{header:'Evaluator name',key:'evaluator',width:29},
   {header:'Faculty ID',key:'staffId',width:22},{header:'Faculty name',key:'staffName',width:29},
   {header:'Department',key:'dept',width:27},{header:'Paper code',key:'paperCode',width:19},
   {header:'Theory course',key:'paperTitle',width:44},{header:'Class / section',key:'section',width:24},
   {header:'LMS code',key:'lmsCode',width:18},
   ...CRITERIA.map(c=>({header:`${c.level} ${c.title} / ${c.max}`,key:c.key,width:24})),
   {header:'Course total / 100',key:'total',width:21},
   {header:'Faculty submitted avg',key:'average',width:24},
   {header:'Average type',key:'averageType',width:19}
 ];
 styleRow(breakdown.getRow(1),true);
 for (const r of report.rows) for (const c of r.courses) {
  const data={evaluatorId:r.evaluatorId||c.evaluatorId||'',evaluator:r.evaluatorName,staffId:r.staffId,staffName:r.staffName,
   dept:c.department_name,paperCode:c.paper_code,paperTitle:c.paper_title,
   section:`${c.program_id} · Year ${c.year} · ${c.section_name}`,
   lmsCode:c.lmsCode,total:c.total,average:r.average,averageType:r.averageIsFinal?'Final':'Current'};
  for(const criterion of CRITERIA) data[criterion.key]=c.marks?.[criterion.key]??null;
  const line=breakdown.addRow(data);styleRow(line);
 }
 breakdown.views=[{state:'frozen',ySplit:1,xSplit:4}];
 breakdown.autoFilter={from:'A1',to:`${breakdown.getColumn(breakdown.columnCount).letter}1`};
 // Admin also receives the full history of SAVED course records, including drafts,
 // but only theory papers, and respecting the current department/evaluator/search filters.
 if(role==='Administrator'){
  const audit=wb.addWorksheet('All Evaluator Records');
  audit.columns=[{header:'Evaluator',key:'evaluator',width:28},{header:'Staff name',key:'staff',width:32},{header:'Staff ID',key:'staffId',width:22},{header:'Department',key:'dept',width:28},{header:'Paper code',key:'code',width:18},{header:'Course',key:'title',width:46},{header:'LMS code',key:'lms',width:19},{header:'Status',key:'status',width:16},{header:'Marks / 100',key:'total',width:20},{header:'Updated',key:'updated',width:26},...CRITERIA.map(c=>({header:`${c.level} ${c.short} / ${c.max}`,key:c.key,width:20}))];
  styleRow(audit.getRow(1),true);
  const permitted=new Set((directory?.staff||[]).flatMap(s=>s.courses.map(c=>`${s.staffId}|${c.courseKey}`)));
  const search=String(report.search||'').toLowerCase();
  for(const r of records){
   if(!permitted.has(`${r.staffId}|${r.courseKey}`))continue;
   if(report.department!=='All departments'&&r.department!==report.department)continue;
   if(report.evaluatorName&&normalize(r.evaluatorName)!==normalize(report.evaluatorName))continue;
   if(search&&!`${r.staffName} ${r.staffId} ${r.department} ${r.evaluatorName} ${r.paperTitle} ${r.paperCode}`.toLowerCase().includes(search))continue;
   const entry={evaluator:r.evaluatorName,staff:r.staffName,staffId:r.staffId,dept:r.department,code:r.paperCode,title:r.paperTitle,lms:r.lmsCode,status:r.status,total:r.status==='submitted'?r.total:null,updated:r.updatedAt};
   if(r.rubricVersion===2){for(const c of CRITERIA)entry[c.key]=r.marks?.[c.key]??null;}
   const line=audit.addRow(entry);styleRow(line);
  }
  audit.views=[{state:'frozen',xSplit:3,ySplit:1}];audit.autoFilter={from:'A1',to:`${audit.getColumn(audit.columnCount).letter}1`};
 }
 return wb;
}
