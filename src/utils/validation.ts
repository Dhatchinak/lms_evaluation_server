import type { Faculty, Evaluation, EvaluationStatus } from '../shared/types.js';
import { CRITERIA, RUBRIC_VERSION, blankMarks, summarize } from '../shared/criteria.js';
function bad(message: string){return Object.assign(new Error(message),{status:400});}
export function validStaffId(value: unknown): value is string {return typeof value==='string'&&/^[A-Z0-9-]{5,36}$/.test(value);}
export function parseEvaluation(input: Partial<Evaluation>,faculty: Faculty): Evaluation {
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad('Invalid evaluation request.');
  if(input.staffId!==faculty.staffId)throw bad('Staff ID does not match the selected faculty.');
  const course=faculty.courses.find(c=>c.courseKey===input.courseKey);
  if(!course)throw bad('Selected course is not assigned to this faculty member.');
  const lmsCode=String(input.lmsCode??'').trim();
  if(lmsCode.length>64||/[\r\n<>]/.test(lmsCode))throw bad('LMS course ID must be at most 64 characters, on one line.');
  const marks=blankMarks();
  for(const c of CRITERIA){
    const v=input.marks?.[c.key];if(v===null||v===undefined)continue;
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>c.max||!Number.isInteger(v*2))throw bad(`${c.level} · ${c.title}: enter 0–${c.max} in steps of 0.5.`);
    marks[c.key]=v;
  }
  const stats=summarize(marks);
  const status: EvaluationStatus=input.status==='submitted'?'submitted':'draft';
  if(status==='submitted'&&!stats.complete)throw bad('Enter all 14 marks before submitting.');
  const evaluatorName=String(input.evaluatorName??'').trim();
  if(!evaluatorName||evaluatorName.length>80||/[<>\r\n]/.test(evaluatorName))throw bad('Enter a valid evaluator name.');
  return {staffId:faculty.staffId,staffName:faculty.name,department:course.department_name,designation:'',courseKey:course.courseKey,paperCode:course.paper_code,paperTitle:course.paper_title,paperType:course.paper_type,programId:course.program_id,year:course.year,sectionName:course.section_name,lmsCode,marks,total:stats.total,maxTotal:100,percentage:stats.percentage,status,evaluatorName,evaluatorId:input.evaluatorId,evaluatorDepartment:input.evaluatorDepartment,rubricVersion:RUBRIC_VERSION};
}
