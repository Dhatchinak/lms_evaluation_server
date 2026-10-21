import { courseKey } from '../shared/criteria.js';
import { isTheoryPaper, theoryDirectory } from '../utils/theory.js';
import type { Course, Faculty, FacultyDirectory, ERPDepartmentResponse } from '../shared/types.js';

type Row = {
  staffId: string; staffName: string; department: string;
  paper_code: string; paper_title: string; paper_type: string;
  program_id: string; year: string; section_name: string;
};
const text = (v: unknown): string => String(v ?? '').trim();
const badERP = (message: string) => Object.assign(new Error(message), { status: 502 });
let memo: FacultyDirectory | null = null;
let cacheExpiry = 0;
let refreshPromise: Promise<FacultyDirectory> | null = null;
let lastRefreshFailure = 0;
let lastRefreshError: string | null = null;
const REFRESH_MS = 5 * 60_000;
const FAILED_RETRY_MS = 30_000;

/** A teaching department owns the timetable; it need not be an employee's home department. */
export function flattenDepartments(payload: unknown): Row[] {
  const data = payload as ERPDepartmentResponse | {data?: ERPDepartmentResponse | {departments?: ERPDepartmentResponse['departments']}};
  const depts = Array.isArray(payload) ? payload :
    ('departments' in (data as object) ? (data as ERPDepartmentResponse).departments :
    (data as {data?: ERPDepartmentResponse}).data?.departments);
  if (!Array.isArray(depts) || depts.length === 0) throw badERP('The ERP response contains no departments.');
  const rows: Row[] = [];
  for (const dept of depts) for (const program of dept.programs ?? [])
    for (const year of program.years ?? []) for (const section of year.sections ?? [])
      for (const day of section.TimeTable ?? section.timetable ?? []) for (const hour of day.hours ?? [])
        for (const paper of hour.papers ?? []) {
          if (!paper.staffid || !paper.staffName || !paper.paperCode || !paper.paperTitle || !isTheoryPaper(paper)) continue;
          rows.push({
            staffId: text(paper.staffid).toUpperCase(), staffName: text(paper.staffName),
            department: text(dept.department_name), paper_code: text(paper.paperCode),
            paper_title: text(paper.paperTitle), paper_type: text(paper.paperType),
            program_id: text(program.program_id), year: text(year.year), section_name: text(section.section_name)
          });
        }
  return rows;
}

export function normalizeDirectory(rows: Row[]): Faculty[] {
  const staff = new Map<string, Faculty>();
  for (const r of rows) {
    if (!r.staffId || !r.staffName || !r.paper_code || !r.paper_title || !r.department || !isTheoryPaper(r)) continue;
    let faculty = staff.get(r.staffId);
    if (!faculty) {
      faculty = {staffId: r.staffId, name: r.staffName, departments: [], courses: []};
      staff.set(r.staffId, faculty);
    }
    if (!faculty.departments.includes(r.department)) faculty.departments.push(r.department);
    const courseBase = {
      paper_code: r.paper_code, paper_title: r.paper_title, paper_type: r.paper_type,
      program_id: r.program_id, year: r.year, section_name: r.section_name,
      department_name: r.department
    };
    const course: Course = {...courseBase, courseKey: courseKey(courseBase)};
    if (!faculty.courses.some(c => c.courseKey === course.courseKey)) faculty.courses.push(course);
  }
  return [...staff.values()].map(f => ({
    ...f, departments: f.departments.sort(),
    courses: f.courses.sort((a, b) => a.paper_title.localeCompare(b.paper_title))
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshFromERP(): Promise<FacultyDirectory> {
  const started = Date.now();
  console.info('[ERP] Refreshing live departments directory…');
  let response: Response;
  try {
    response = await fetch(process.env.ERP_DEPARTMENTS_URL || 'https://apierp.bhc.edu.in/api/admin/departments', {
      headers: { Accept: 'application/json', Referer: process.env.ERP_DEPARTMENTS_REFERER || 'http://10.240.151.162' },
      redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
  } catch (e) { throw badERP(`Unable to reach college ERP: ${e instanceof Error ? e.message : 'network failure'}. Check college-network access.`); }
  if (!response.ok) throw badERP(`ERP departments API returned HTTP ${response.status}; check authorized access and Referer.`);
  const payload: unknown = await response.json();
  const rows = flattenDepartments(payload);
  const staff = normalizeDirectory(rows);
  if (staff.length === 0) throw badERP('ERP returned no eligible theory staff/course assignments.');
  const directory = theoryDirectory({
    staff, departments: [], source: 'ERP (live)', fetchedAt: new Date().toISOString()
  }) as FacultyDirectory;
  // The ERP is the source of truth. Do not persist all faculty, departments,
  // timetable entries or source chunks in the evaluation database.
  lastRefreshError = null;
  memo = directory;
  cacheExpiry = Date.now() + REFRESH_MS;
  console.info(`[ERP] Ready: ${directory.staff.length} staff, ${directory.staff.reduce((n, s) => n+s.courses.length, 0)} theory-course assignments (${Date.now()-started} ms).`);
  return directory;
}
function startRefresh(): Promise<FacultyDirectory> {
  if (!refreshPromise) {
    refreshPromise = refreshFromERP().catch(err => {
      lastRefreshFailure = Date.now();
      lastRefreshError = err instanceof Error ? err.message : String(err);
      console.error('[ERP SYNC]', err instanceof Error ? err.message : String(err));
      throw err;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/** A short-lived in-memory cache is safe for UI responsiveness, not persisted to MongoDB. */
export async function loadDirectory(force = false): Promise<FacultyDirectory> {
  if (!force && memo) {
    if (Date.now() >= cacheExpiry && Date.now() - lastRefreshFailure > FAILED_RETRY_MS) {
      void startRefresh().catch(() => undefined);
      cacheExpiry = Date.now() + 30_000;
    }
    return memo;
  }
  return startRefresh();
}

export function staffInDepartment(staff: Faculty, department: string): boolean {
  return !department || staff.departments.includes(department);
}

/** Safe diagnostics without exposing faculty records or credentials. */
export function directoryStatus() {
 return { source: memo?.source || 'not synchronized',
   fetchedAt: memo?.fetchedAt || null, staffCount: memo?.staff.length || 0,
   refreshInProgress: Boolean(refreshPromise), lastRefreshError };
}
