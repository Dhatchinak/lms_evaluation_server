/** Opt-in, backup-first migration from the old duplicated directory collections.
 * Nothing is deleted when run without explicit --apply and --backup-confirmed.
 * Stop the API while running this migration to avoid concurrent evaluation edits.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectModels } from './models/schemas/index.js';

const apply = process.argv.includes('--apply');
const backup = process.argv.includes('--backup-confirmed');
const acknowledge = process.argv.includes('--confirm=REMOVE_ERP_CACHES');
const legacyRecordTypes = ['faculty', 'directory_metadata', 'erp_source_manifest', 'erp_source_chunk'];
const legacyCollections = ['lms_staff', 'lms_departments', 'lms_course_assignments', 'lms_evaluators'];

type OldRevision = { evaluationId: string; revision: number; action?: string; recordedAt?: Date;
  performedBy?: string; snapshot?: Record<string, any> };

async function run(): Promise<void> {
  const connection = await connectModels();
  const db = connection.db!;
  const oldCollections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name));
  const evaluations = db.collection('LMS evaluation');
  const legacyERPCount = await evaluations.countDocuments({ recordType: { $in: legacyRecordTypes } });
  const flatEvaluations = await evaluations.countDocuments({ recordType: 'evaluation', marks: { $exists: true }, scoring: { $exists: false } });
  const oldAccountCount = oldCollections.has('lms_accounts') ? await db.collection('lms_accounts').countDocuments({ role: 'evaluator' }) : 0;
  const revisions = oldCollections.has('lms_evaluation_revisions')
    ? await db.collection<OldRevision>('lms_evaluation_revisions').find({}).sort({ evaluationId: 1, revision: 1 }).toArray() : [];
  const groups = new Map<string, OldRevision[]>();
  for (const revision of revisions) {
    const entries = groups.get(revision.evaluationId) ?? [];
    entries.push(revision);
    groups.set(revision.evaluationId, entries);
  }
  const issues: string[] = [];
  const updates: Array<{ evaluationId: string; history: Record<string, unknown>[] }> = [];
  for (const [evaluationId, entries] of groups) {
    const doc = await evaluations.findOne({ evaluationId, scoring: { $exists: true } });
    if (!doc) { issues.push('Orphan revision history for ' + evaluationId); continue; }
    const existing = Array.isArray(doc.history) ? doc.history : [];
    if (existing.length >= entries.length) continue;
    if (entries.length !== Number(doc.revision)) {
      issues.push('Incomplete revision history for ' + evaluationId); continue;
    }
    const history = entries.map((rev, index) => {
      const snapshot = rev.snapshot || {};
      const beforeSnapshot = index > 0 ? entries[index - 1].snapshot || {} : null;
      const projection = (value: Record<string, any> | null) => value ? ({
        lmsCode: value.lmsCode ?? '', marks: value.scoring?.marks ?? null,
        total: value.scoring?.total ?? null, status: value.status ?? null,
        rubricVersion: value.scoring?.rubricVersion ?? null,
      }) : null;
      return { revision: rev.revision, action: rev.action || (index ? 'updated' : 'created'),
        recordedAt: rev.recordedAt || new Date(), performedBy: rev.performedBy || doc.evaluatorId,
        before: projection(beforeSnapshot), after: projection(snapshot) };
    });
    if (history.some(x => !x.after?.marks || !x.performedBy)) {
      issues.push('Invalid saved revision contents for ' + evaluationId); continue;
    }
    updates.push({ evaluationId, history });
  }
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY RUN',
    database: db.databaseName, evaluationCollection: 'LMS evaluation',
    legacyERPDocuments: legacyERPCount,
    legacyFlatMarkDocumentsPreserved: flatEvaluations,
    oldEvaluatorAccountDocuments: oldAccountCount,
    legacyRevisionDocuments: revisions.length,
    revisionsToEmbed: updates.length,
    obsoleteCollections: Object.fromEntries(await Promise.all(legacyCollections.map(async name => [name,
      oldCollections.has(name) ? await db.collection(name).countDocuments() : 0]))),
    issues: issues.slice(0, 15) }, null, 2));
  if (!apply) {
    console.log('No changes made. Export/backup your database before using --apply.');
    return;
  }
  if (!backup || !acknowledge) throw new Error('No changes made: requires --backup-confirmed --confirm=REMOVE_ERP_CACHES.');
  if (issues.length) throw new Error('No deletions permitted: unresolved revision data. Preserve the old collections and investigate.');
  // Move the legacy audit history into the same document as its evaluation BEFORE
  // allowing the old revision collection to be removed.
  for (const item of updates) {
    const result = await evaluations.updateOne({ evaluationId: item.evaluationId }, { $set: { history: item.history } });
    if (result.matchedCount !== 1) throw new Error('Revision migration failed for ' + item.evaluationId);
  }
  for (const [id, entries] of groups) {
    const doc = await evaluations.findOne({ evaluationId: id }, { projection: { history: 1 } });
    if (!doc || !Array.isArray(doc.history) || doc.history.length < entries.length) {
      throw new Error('Revision verification failed. No collection was removed.');
    }
  }
  // Only ERP lookup duplicates are removed; actual evaluation records remain.
  const removed = await evaluations.deleteMany({ recordType: { $in: legacyRecordTypes } });
  if (oldCollections.has('lms_accounts')) await db.collection('lms_accounts').deleteMany({ role: 'evaluator' });
  for (const name of [...legacyCollections, 'lms_evaluation_revisions']) {
    if (oldCollections.has(name)) await db.collection(name).drop();
  }
  console.log(`Cleanup successful: removed ${removed.deletedCount} ERP-only cache documents. All evaluation documents preserved.`);
  if (flatEvaluations) console.warn(`Attention: ${flatEvaluations} legacy flat evaluation documents were preserved to avoid losing marks. Migrate them separately after verifying their scores.`);
}
try { await run(); } catch (error) {
  console.error('CLEANUP STOPPED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
