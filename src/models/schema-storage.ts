/** Validated evaluation persistence. ERP directory data is never saved here. */
import { createHash } from 'node:crypto';
import { CRITERIA, RUBRIC_VERSION, summarize } from '../shared/criteria.js';
import type { Evaluation } from '../shared/types.js';
import { connectModels, EvaluationModel } from './schemas/index.js';
import { APPROVED_EVALUATORS } from '../services/approved-users.js';

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const academicYear = () => process.env.ACADEMIC_YEAR || '2026-2027';
const semester = () => process.env.ACADEMIC_SEMESTER === 'EVEN' ? 'EVEN' : 'ODD';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function validateScore(e: Evaluation) {
  if (e.rubricVersion !== RUBRIC_VERSION) throw bad('Rubric version mismatch.');
  const marks = e.marks ?? {};
  const actual = Object.keys(marks).sort();
  const allowed = CRITERIA.map(c => c.key).sort();
  if (actual.length !== allowed.length || actual.some((key, i) => key !== allowed[i])) throw bad('Exactly 14 component marks are required.');
  for (const c of CRITERIA) {
    const mark = marks[c.key];
    if (mark !== null && (typeof mark !== 'number' || !Number.isFinite(mark) || mark < 0 || mark > c.max || !Number.isInteger(mark * 2))) {
      throw bad(`Invalid mark for ${c.key} (0–${c.max} in steps of 0.5).`);
    }
  }
  const sum = summarize(marks);
  if (Math.abs(sum.total - e.total) > 1e-8) throw bad('Marks total mismatch.');
  if (e.status === 'submitted' && !sum.complete) throw bad('Submit requires all 14 marks.');
  return sum;
}

const toPublic = (doc: any): Evaluation => ({
  staffId: doc.staffId,
  staffName: doc.staff?.staffName,
  department: doc.staff?.department,
  courseKey: doc.courseKey,
  paperCode: doc.course?.paperCode,
  paperTitle: doc.course?.paperTitle,
  programId: doc.course?.programId,
  year: doc.course?.year,
  sectionName: doc.course?.section,
  evaluatorName: doc.evaluator?.evaluatorName,
  evaluatorId: doc.evaluatorId,
  lmsCode: doc.lmsCode,
  remarks: doc.remarks || '',
  marks: Object.fromEntries(CRITERIA.map(c => [c.key, doc.scoring?.marks?.[c.key] ?? null])),
  total: doc.scoring?.total,
  status: doc.status,
  rubricVersion: doc.scoring?.rubricVersion,
  createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt),
});

// Only records explicitly saved in the current academic term count in official reports.
// Old records are PRESERVED for inspection/migration but cannot silently change totals.
function isVerifiedEvaluation(d: any): boolean {
  if (!d || typeof d.evaluationId !== 'string' || !d.evaluatorId || !d.staffId || !d.courseKey || !d.scoring?.marks) return false;
  try { validateScore(toPublic(d)); return true; } catch { return false; }
}
export async function listEvaluations(staffId: string): Promise<Evaluation[]> {
  await connectModels();
  const records = await EvaluationModel.find({ staffId, recordType: 'course_evaluation', academicYear: academicYear(), semester: semester() }).lean();
  return records.filter(isVerifiedEvaluation).map(toPublic);
}
export async function listAllRecords(): Promise<Evaluation[]> {
  await connectModels();
  const records = await EvaluationModel.find({ recordType: 'course_evaluation', academicYear: academicYear(), semester: semester() }).lean();
  return records.filter(isVerifiedEvaluation).map(toPublic);
}

const snapshot = (record: Evaluation) => ({
  lmsCode: record.lmsCode, remarks: record.remarks || '', marks: { ...record.marks }, total: record.total,
  status: record.status, rubricVersion: record.rubricVersion,
});

export async function saveEvaluation(record: Evaluation): Promise<Evaluation> {
  const score = validateScore(record);
  await connectModels();
  const evaluatorId = String(record.evaluatorId || '').trim().toUpperCase();
  if (!APPROVED_EVALUATORS.some(user => user.username === evaluatorId)) {
    throw bad('The signed-in account is not an approved evaluator. Please sign in again.');
  }
  if (!record.staffId || !record.courseKey || !record.paperCode || !record.paperTitle || !record.staffName) {
    throw bad('Verified ERP staff and course details are required.');
  }
  const evaluationId = `eval:${hash([academicYear(), semester(), evaluatorId, record.staffId, record.courseKey])}`;
  const now = new Date();
  const base = {
    evaluationId, recordType: 'course_evaluation', academicYear: academicYear(), semester: semester(),
    evaluatorId, staffId: record.staffId, courseKey: record.courseKey,
    evaluator: { evaluatorId, evaluatorName: record.evaluatorName, department: String(record.evaluatorDepartment || '') },
    staff: { staffId: record.staffId, staffName: record.staffName, department: record.department },
    course: { courseKey: record.courseKey, paperCode: record.paperCode, paperTitle: record.paperTitle,
      paperType: String(record.paperType || ''), programId: record.programId, year: String(record.year),
      section: record.sectionName, department: record.department, isTheory: true },
    lmsCode: record.lmsCode, remarks: record.remarks || '', status: record.status,
    scoring: { rubricVersion: RUBRIC_VERSION, marks: { ...record.marks }, total: score.total, maximum: 100, complete: score.complete },
    source: 'ERP departments API', sourceVerifiedAt: now,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await EvaluationModel.findOne({ evaluationId }).lean();
    if (!existing) {
      try {
        const saved = await EvaluationModel.create({ ...base, submittedAt: record.status === 'submitted' ? now : null,
          revision: 1, history: [{ revision: 1, action: 'created', performedBy: evaluatorId, recordedAt: now, before: null, after: snapshot(record) }] });
        return toPublic(saved.toObject());
      } catch (error: unknown) {
        if ((error as { code?: number }).code === 11000) continue;
        throw error;
      }
    }
    if (existing?.status === 'submitted' && record.status === 'draft') throw Object.assign(new Error('Submitted marks cannot become a draft.'), { status: 409 });
    const previous = toPublic(existing);
    if (previous.lmsCode === record.lmsCode && (previous.remarks || '') === (record.remarks || '') && previous.status === record.status &&
        JSON.stringify(previous.marks) === JSON.stringify(record.marks)) return previous;
    const revision = Number(existing?.revision || 1);
    const priorHistory = Array.isArray(existing?.history) ? existing.history.length : 0;
    if (priorHistory > 500) throw Object.assign(new Error('Revision limit reached. Contact the administrator for archival.'), { status: 409 });
    const changed = await EvaluationModel.findOneAndUpdate({ evaluationId, revision }, {
      $set: { ...base, submittedAt: record.status === 'submitted' ? (existing.submittedAt || now) : null },
      $inc: { revision: 1 },
      $push: { history: { revision: revision + 1, action: 'updated', performedBy: evaluatorId, recordedAt: now,
        before: snapshot(previous), after: snapshot(record) } },
    }, { new: true, runValidators: true });
    if (changed) return toPublic(changed.toObject());
  }
  throw Object.assign(new Error('Evaluation changed concurrently. Refresh and retry.'), { status: 409 });
}
export async function evaluationHistory(staffId: string) {
  await connectModels();
  return EvaluationModel.find({ staffId, evaluationId: { $type: 'string' } })
    .select('evaluationId evaluatorId staffId courseKey revision history status createdAt updatedAt').lean();
}
export async function databaseHealth() { const db = await connectModels(); await db.db!.admin().ping(); }
