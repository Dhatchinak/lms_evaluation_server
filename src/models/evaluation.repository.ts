import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MongoClient, Binary, type Collection, type Document, type UpdateFilter } from 'mongodb';
import type { Evaluation, FacultyDirectory } from '../shared/types.js';

/** One collection, independent document types, durable source and revision history. */
let client: MongoClient | undefined;
type StoredRecord = Document & { _id: string };
let collectionPromise: Promise<Collection<StoredRecord>> | undefined;
const DB = () => process.env.MONGO_DB_NAME || 'faculty_engagement';
const COLLECTION = 'LMS evaluation';
const normalized = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

export async function getCollection(): Promise<Collection<StoredRecord>> {
  if (!collectionPromise) collectionPromise = (async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI is required; no file fallback is enabled.');
    const candidate = new MongoClient(uri, { serverSelectionTimeoutMS: 12000, maxPoolSize: 15, retryWrites: true });
    try {
      await candidate.connect();
      const db = candidate.db(DB());
      await db.command({ ping: 1 });
      const col = db.collection<StoredRecord>(COLLECTION);
      await col.createIndex({ recordType: 1, staffId: 1 });
      await col.createIndex({ recordType: 1, evaluatorKey: 1, status: 1 });
      await col.createIndex({ recordType: 1, department: 1 });
      await col.createIndex({ recordType: 1, snapshotId: 1, chunk: 1 });
      await col.createIndex({ recordType: 1, updatedAt: -1 });
      client = candidate;
      return col;
    } catch (err) { await candidate.close(); throw err; }
  })().catch(err => { collectionPromise = undefined; throw err; });
  return collectionPromise;
}

/** A compressed, full-fidelity ERP payload is stored as Mongo Binary chunks (not in one 16MB document). */
export async function saveErpSource(payload: unknown): Promise<{ snapshotId: string; bytes: number; chunks: number }> {
  if (!payload || typeof payload !== 'object') throw new Error('ERP source payload is invalid.');
  const col = await getCollection();
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex');
  const snapshotId = `erp:${hash}`;
  const gzip = gzipSync(raw);
  const chunkSize = 2 * 1024 * 1024;
  const count = Math.ceil(gzip.length / chunkSize);
  const now = new Date();
  for (let chunk = 0; chunk < count; chunk++) {
    const slice = gzip.subarray(chunk * chunkSize, (chunk + 1) * chunkSize);
    await col.updateOne({ _id: `${snapshotId}:part:${chunk}` }, { $setOnInsert: {
      recordType: 'erp_source_chunk', snapshotId, chunk, payload: new Binary(slice), compression: 'gzip', createdAt: now,
    } }, { upsert: true });
  }
  await col.updateOne({ _id: `erp:manifest:${hash}` }, { $setOnInsert: {
    recordType: 'erp_source_manifest', snapshotId, sha256: hash, byteLength: raw.length,
    compressedBytes: gzip.length, chunkCount: count, fetchedAt: now, source: 'ERP departments API',
  } }, { upsert: true });
  return { snapshotId, bytes: raw.length, chunks: count };
}

/** Never discard previous ERP directories or evaluations when a timetable changes. */
export async function saveDirectory(directory: FacultyDirectory, sourceSnapshotId?: string): Promise<void> {
  const col = await getCollection();
  if (!Array.isArray(directory.staff) || !directory.staff.length) throw new Error('Refusing to store an empty ERP directory.');
  const syncId = `directory:${createHash('sha256').update(JSON.stringify(directory.staff)).digest('hex')}`;
  const now = new Date();
  const ops = directory.staff.map(faculty => ({
    updateOne: {
      filter: { _id: `faculty:${faculty.staffId}` },
      update: { $set: {
        recordType: 'faculty', staffId: faculty.staffId, staffName: faculty.name,
        departments: faculty.departments, courses: faculty.courses, directorySource: directory.source,
        sourceSnapshotId: sourceSnapshotId ?? null, activeDirectoryId: syncId, syncedAt: now,
      }, $setOnInsert: { createdAt: now } },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 300) await col.bulkWrite(ops.slice(i, i + 300), { ordered: false });
  // Publish metadata last so readers never see a partly imported new directory.
  await col.updateOne({ _id: 'directory:metadata' }, { $set: {
    recordType: 'directory_metadata', activeDirectoryId: syncId, sourceSnapshotId: sourceSnapshotId ?? null,
    source: directory.source, departments: directory.departments, fetchedAt: directory.fetchedAt,
    syncedAt: now, staffCount: directory.staff.length,
  } }, { upsert: true });
}

export async function loadSavedDirectory(): Promise<FacultyDirectory | null> {
  const col = await getCollection();
  const meta = await col.findOne({ _id: 'directory:metadata' });
  if (!meta || !meta.activeDirectoryId) return null;
  const rows = await col.find({ recordType: 'faculty', activeDirectoryId: meta.activeDirectoryId }).toArray();
  if (rows.length !== meta.staffCount) throw new Error('Faculty directory in MongoDB is incomplete. Refusing inaccurate totals.');
  return {
    staff: rows.map(row => ({ staffId: String(row.staffId), name: String(row.staffName),
      departments: row.departments as string[], courses: row.courses as FacultyDirectory['staff'][number]['courses'] })),
    departments: meta.departments as string[], sourceSnapshotId: String(meta.sourceSnapshotId || ''), source: String(meta.source || 'MongoDB'),
    fetchedAt: String(meta.fetchedAt || ''),
  };
}

const publicRecord = (doc: Document | null): Evaluation => {
  if (!doc) throw new Error('Evaluation save did not return a record.');
  const { _id, recordType, history, revision, evaluatorKey, ...record } = doc;
  return record as Evaluation;
};
export async function listEvaluations(staffId: string): Promise<Evaluation[]> {
  const col = await getCollection();
  return (await col.find({ recordType: 'evaluation', staffId }, { projection: {
    _id: 0, recordType: 0, history: 0, revision: 0,
  } }).toArray()) as unknown as Evaluation[];
}
export async function listAllRecords(): Promise<Evaluation[]> {
  const col = await getCollection();
  return (await col.find({ recordType: 'evaluation' }, { projection: {
    _id: 0, recordType: 0, history: 0, revision: 0,
  } }).toArray()) as unknown as Evaluation[];
}

/** Atomic versioned update: concurrent saves cannot silently overwrite existing scores. */
export async function saveEvaluation(record: Evaluation): Promise<Evaluation> {
  const col = await getCollection();
  const ekey = normalized(record.evaluatorName);
  if (!ekey) throw new Error('Evaluator name is required.');
  const id = `evaluation:${encodeURIComponent(record.staffId)}:${encodeURIComponent(record.courseKey)}:${encodeURIComponent(ekey)}`;
  const now = new Date();
  const normalizedRecord = { ...record, evaluatorKey: ekey, recordType: 'evaluation', updatedAt: now.toISOString() };
  for (let attempt = 0; attempt < 5; attempt++) {
    const prior = await col.findOne({ _id: id });
    if (!prior) {
      try {
        await col.insertOne({ _id: id, ...normalizedRecord, createdAt: now.toISOString(), revision: 1,
          history: [{ revision: 1, at: now, action: 'created', status: record.status, marks: record.marks,
            total: record.total, lmsCode: record.lmsCode, rubricVersion: record.rubricVersion }],
        });
        return publicRecord(await col.findOne({ _id: id }));
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === 11000) continue;
        throw err;
      }
    }
    const rev = Number(prior.revision || 1);
    const unchanged = prior.status === record.status && prior.lmsCode === record.lmsCode &&
      JSON.stringify(prior.marks) === JSON.stringify(record.marks);
    if (unchanged) return publicRecord(prior);
    const updated = await col.findOneAndUpdate({ _id: id, revision: rev }, {
      $set: normalizedRecord,
      $inc: { revision: 1 },
      $push: { history: { revision: rev + 1, at: now, action: 'updated', previousStatus: prior.status,
        status: record.status, marks: record.marks, total: record.total, lmsCode: record.lmsCode,
        rubricVersion: record.rubricVersion } },
    } as unknown as UpdateFilter<StoredRecord>, { returnDocument: 'after' });
    if (updated) return publicRecord(updated);
  }
  throw Object.assign(new Error('Another save occurred at the same time. Reload and retry.'), { status: 409 });
}
export async function evaluationHistory(staffId: string): Promise<Document[]> {
  const col = await getCollection();
  return await col.find({ recordType: 'evaluation', staffId }, { projection: {
    staffId: 1, courseKey: 1, evaluatorName: 1, revision: 1, history: 1, _id: 0,
  } }).toArray();
}
export async function databaseHealth(): Promise<void> {
  const col = await getCollection();
  await client!.db(DB()).command({ ping: 1 });
  await col.estimatedDocumentCount();
}
export async function closeDatabase(): Promise<void> { await client?.close(); collectionPromise = undefined; client = undefined; }
