/** Shared contracts for ERP, frontend and backend. */
export type Marks = Record<string, number | null>;
export type EvaluationStatus = 'draft' | 'submitted';
export type CompletionStatus = 'completed' | 'in-progress' | 'not-started';
export interface ERPDepartmentResponse { departments: ERPDepartment[] }
export interface ERPDepartment { department_code?: string; department_name: string; programs?: ERPProgram[] }
export interface ERPProgram { program_id: string; years?: ERPYear[] }
export interface ERPYear { year: number | string; sections?: ERPSection[] }
export interface ERPSection { section_name: string; TimeTable?: ERPDay[]; timetable?: ERPDay[] }
export interface ERPDay { dayOrder?: number; hours?: ERPHour[] }
export interface ERPHour { hour?: number; papers?: ERPPaper[] }
export interface ERPPaper { staffid: string; staffName: string; paperCode: string; paperTitle: string; paperType?: string }
export interface Course { courseKey: string; paper_code: string; paper_title: string; paper_type: string; program_id: string; year: string; section_name: string; department_name: string }
export interface Faculty { staffId: string; name: string; departments: string[]; courses: Course[] }
export interface FacultyDirectory { staff: Faculty[]; departments: string[]; source?: string; fetchedAt?: string; sourceSnapshotId?: string }
export interface Evaluation { staffId: string; staffName: string; department: string; courseKey: string; paperCode: string; paperTitle: string; programId: string; year: string; sectionName: string; evaluatorName: string; evaluatorId?: string; evaluatorDepartment?: string; paperType?: string; lmsCode: string; remarks?: string; marks: Marks; total: number; status: EvaluationStatus; rubricVersion: number; updatedAt?: string; createdAt?: string; evaluatorKey?: string; [key: string]: unknown }
export interface ReportCourse extends Course { status: CompletionStatus | EvaluationStatus | 'legacy'; total: number | null; lmsCode: string }
export interface FacultyReportRow { staffId: string; staffName: string; department: string; courseCount: number; completedCourses: number; average: number | null; averageIsFinal: boolean; status: CompletionStatus; courses: ReportCourse[] }
export interface CompletionReport { rows: FacultyReportRow[]; stats: { staff: number; completedStaff: number; inProgressStaff: number; notStartedStaff: number; courses: number; submittedCourses: number; completionRate: number; courseRate: number }; department: string; evaluatorName: string | null }
export interface Session { role: 'evaluator' | 'admin'; name: string; code: string; staffId?: string }
