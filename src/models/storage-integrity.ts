/** Read-only audit of permanent evaluation records. No ERP snapshots expected. */
import { CRITERIA } from '../shared/criteria.js';
import { connectModels, EvaluationModel } from './schemas/index.js';
export async function checkStorageIntegrity(): Promise<Record<string, unknown>> {
  await connectModels();
  const col = EvaluationModel.collection;
  const records = await col.find({ evaluationId: { $type: 'string' }, scoring: { $exists: true } }).toArray();
  let invalidMarks = 0, invalidTotals = 0, invalidIdentity = 0, invalidHistory = 0;
  for (const record of records) {
    const marks = record.scoring?.marks as Record<string, number | null> | undefined;
    const total = CRITERIA.reduce((sum, c) => sum + (typeof marks?.[c.key] === 'number' ? marks[c.key] as number : 0), 0);
    if (CRITERIA.some(c => marks?.[c.key] === undefined || (marks?.[c.key] !== null &&
      (typeof marks?.[c.key] !== 'number' || marks[c.key]! < 0 || marks[c.key]! > c.max || !Number.isInteger(marks[c.key]! * 2))))) invalidMarks++;
    if (Math.abs(Number(record.scoring?.total) - total) > 1e-8) invalidTotals++;
    if (!record.evaluatorId || !record.staffId || !record.courseKey || !record.evaluator?.evaluatorName ||
        !record.staff?.staffName || !record.course?.paperTitle) invalidIdentity++;
    if (record.recordType === 'course_evaluation' && (!Array.isArray(record.history) || record.history.length !== record.revision)) invalidHistory++;
  }
  const legacyDirectory = await col.countDocuments({ recordType: { $in: ['faculty', 'directory_metadata', 'erp_source_manifest', 'erp_source_chunk'] } });
  return { collection: 'LMS evaluation', evaluationCount: records.length, legacyDirectoryDocuments: legacyDirectory,
    invalidMarks, invalidTotals, invalidIdentity, invalidHistory, ok: !invalidMarks && !invalidTotals && !invalidIdentity && !invalidHistory };
}
