import type { Marks, Course, Evaluation, FacultyDirectory } from './types.js';
/** Faculty Studio rubric v2; 14 fields over 10 levels = exactly 100 marks. */
export const RUBRIC_VERSION = 2;
export const CRITERIA = [
  {key:'courseCreation',level:'L1',title:'Course creation',short:'Course creation',max:10,detail:'Course creation and readiness on LMS.'},
  {key:'syllabusPlan',level:'L2',title:'Syllabus and teaching plan',short:'Syllabus & plan',max:10,detail:'Syllabus and teaching plan uploaded.'},
  {key:'learningResources',level:'L3',title:'Learning resources',short:'Learning resources',max:10,detail:'Learning resources made available to students.'},
  {key:'assignmentGiven',level:'L4',title:'Assignments · Given',short:'Given',max:8,detail:'Marks awarded for giving assignments.'},
  {key:'assignmentGraded',level:'L4',title:'Assignments · Graded',short:'Graded',max:2,detail:'Marks awarded for grading assignments.'},
  {key:'seminarGiven',level:'L5',title:'Seminar · Given',short:'Given',max:5,detail:'Marks awarded for conducting/assigning seminars.'},
  {key:'seminarGraded',level:'L5',title:'Seminar · Graded',short:'Graded',max:5,detail:'Marks awarded for grading seminars.'},
  {key:'quiz',level:'L6',title:'Quiz',short:'Quiz',max:10,detail:'Quiz engagement in the LMS.'},
  {key:'innovativeGiven',level:'L7',title:'Innovative assessment · Given',short:'Given',max:5,detail:'Marks awarded for innovative assessment assigned.'},
  {key:'innovativeGraded',level:'L7',title:'Innovative assessment · Graded',short:'Graded',max:5,detail:'Marks awarded for grading innovative assessment.'},
  {key:'videoContent',level:'L8',title:'Video lecture / e-content',short:'Video / e-content',max:10,detail:'Video lectures and electronic teaching content.'},
  {key:'rubricsCreated',level:'L9',title:'Rubrics · Created',short:'Created',max:8,detail:'Marks awarded for creating rubrics.'},
  {key:'rubricsGraded',level:'L9',title:'Rubrics · Graded',short:'Graded',max:2,detail:'Marks awarded for applying rubrics when grading.'},
  {key:'innovativePedagogy',level:'L10',title:'Innovative pedagogy',short:'Innovative pedagogy',max:10,detail:'Innovative pedagogy used in teaching and learning.'},
];
export const LEVELS = [...new Set(CRITERIA.map(x=>x.level))].map(level=>({level,criteria:CRITERIA.filter(x=>x.level===level),max:CRITERIA.filter(x=>x.level===level).reduce((s,c)=>s+c.max,0)}));
export const MAX_SCORE = CRITERIA.reduce((s,c)=>s+c.max,0);
export const blankMarks = (): Marks => Object.fromEntries(CRITERIA.map(x=>[x.key,null]));
export function summarize(marks: Marks = {}) {
  const filled=CRITERIA.filter(c=>typeof marks?.[c.key]==='number'&&Number.isFinite(marks[c.key])).length;
  const total=CRITERIA.reduce((s,c)=>s+(typeof marks?.[c.key]==='number'&&Number.isFinite(marks[c.key])?marks[c.key]:0),0);
  return {total,filled,remaining:CRITERIA.length-filled,percentage:Math.round(100*filled/CRITERIA.length),complete:filled===CRITERIA.length};
}
export function courseKey(course: Partial<Course>) { return [course.paper_code,course.program_id,course.year,course.section_name].map(x=>String(x??'').trim()).join('|'); }
export function uniqueCourses(entries: Partial<Course>[] = []) {
  const map = new Map<string, Course>();
  for(const e of Array.isArray(entries)?entries:[]){
    if(!e?.paper_code||!e?.paper_title)continue;
    const c={paper_code:String(e.paper_code),paper_title:String(e.paper_title),paper_type:String(e.paper_type??''),program_id:String(e.program_id??''),year:String(e.year??''),section_name:String(e.section_name??''),department_name:String(e.department_name??'')};
    const key=courseKey(c); if(!map.has(key))map.set(key,{...c,courseKey:key});
  }
  return [...map.values()].sort((a,b)=>a.paper_title.localeCompare(b.paper_title));
}
export function isCurrentRubric(record: Partial<Evaluation> | null | undefined) {return record?.rubricVersion===RUBRIC_VERSION;}
