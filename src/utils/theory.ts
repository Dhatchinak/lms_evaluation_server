/** Exclude practical papers even when ERP has an unhelpful type like "Core". */
export function isTheoryPaper(course: {paper_title?:string;paperTitle?:string;paper_type?:string;paperType?:string;paper_code?:string;paperCode?:string} = {}) {
  const title=String(course.paper_title??course.paperTitle??'');
  const kind=String(course.paper_type??course.paperType??'');
  const paperCode=String((course as {paper_code?:string;paperCode?:string}).paper_code??(course as {paper_code?:string;paperCode?:string}).paperCode??'').toUpperCase().replace(/\s+/g,'');
  // College-specific exclusion rules: VLO anywhere, and terminal PS2/E1.
  if (paperCode.includes('VLO') || paperCode.endsWith('PS2') || paperCode.endsWith('E1')) return false;
  if (/^ENVIRONMENTAL\s+STUDIES$/i.test(title.trim())) return false;
  // ERP examples: "Core Prac. V", "CC Practical-I", "Applied Prac.", "... Lab".
  const nonTheoryType=/(?:^|[^a-z])(?:practicals?|prac\.?|laboratory|labs?|projects?|field\s+works?|internships?|dissertations?|practicums?)(?=$|[^a-z])/i;
  const nonTheoryTitle=/(?:^|[^a-z])(?:practicals?|prac\.?|laboratory|labs?|field\s+works?|internships?|dissertations?|practicums?)(?=$|[^a-z])|\bproject\s+(?:work|with\s+viva)\b/i;
  return !nonTheoryType.test(kind)&&!nonTheoryTitle.test(title);
}
export function theoryDirectory(directory) {
  const staff=(directory.staff||[]).map(s=>{const courses=(s.courses||[]).filter(isTheoryPaper);return {...s,courses,departments:[...new Set(courses.map(c=>c.department_name))].sort()};}).filter(s=>s.courses.length);
  return {...directory,staff,departments:[...new Set(staff.flatMap(s=>s.departments))].sort(),staffCount:staff.length,courseCount:staff.reduce((n,s)=>n+s.courses.length,0),paperScope:'Theory papers only'};
}
