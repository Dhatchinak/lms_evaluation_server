/** Only permanent models: admin credentials and evaluator course submissions.
 * The college ERP remains the source of truth for faculty and course discovery.
 */
import mongoose from 'mongoose';
import { CRITERIA, RUBRIC_VERSION } from '../../shared/criteria.js';

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false as const, strict: 'throw' as const };

const AccountSchema = new Schema({
  username: { type: String, required: true, unique: true, uppercase: true, trim: true },
  role: { type: String, enum: ['admin', 'evaluator'], required: true },
  displayName: { type: String, required: true },
  department: { type: String, default: '' },
  passwordSalt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },
  passwordVersion: { type: Number, default: 1 },
  mustChangePassword: { type: Boolean, default: true },
}, { ...options, collection: 'lms_accounts' });
export const AccountModel = mongoose.model('FacultyStudioAdmin', AccountSchema);

const courseSchema = new Schema({
  courseKey: { type: String, required: true },
  paperCode: { type: String, required: true },
  paperTitle: { type: String, required: true },
  paperType: { type: String, default: '' },
  programId: { type: String, default: '' },
  year: { type: String, default: '' },
  section: { type: String, default: '' },
  department: { type: String, required: true },
  isTheory: { type: Boolean, default: true },
}, { _id: false, strict: 'throw' });
const evaluatorSchema = new Schema({
  evaluatorId: { type: String, required: true },
  evaluatorName: { type: String, required: true },
  department: { type: String, default: '' },
}, { _id: false, strict: 'throw' });
const staffSchema = new Schema({
  staffId: { type: String, required: true },
  staffName: { type: String, required: true },
  department: { type: String, required: true },
}, { _id: false, strict: 'throw' });
const marksShape: Record<string, unknown> = {};
for (const criterion of CRITERIA) {
  marksShape[criterion.key] = { type: Number, default: null, min: 0, max: criterion.max };
}
const marksSchema = new Schema(marksShape, { _id: false, strict: 'throw', minimize: false });
const scoringSchema = new Schema({
  rubricVersion: { type: Number, required: true, enum: [RUBRIC_VERSION] },
  marks: { type: marksSchema, required: true },
  total: { type: Number, required: true, min: 0, max: 100 },
  maximum: { type: Number, required: true, enum: [100] },
  complete: { type: Boolean, required: true },
}, { _id: false, strict: 'throw' });
const historySchema = new Schema({
  revision: { type: Number, required: true },
  action: { type: String, enum: ['created', 'updated'], required: true },
  recordedAt: { type: Date, required: true },
  performedBy: { type: String, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, required: true },
}, { _id: false, strict: 'throw' });

export const EvaluationSchema = new Schema({
  evaluationId: { type: String, required: true },
  recordType: { type: String, enum: ['course_evaluation'], default: 'course_evaluation' },
  academicYear: { type: String, required: true },
  semester: { type: String, enum: ['ODD', 'EVEN'], required: true },
  evaluatorId: { type: String, required: true },
  staffId: { type: String, required: true },
  courseKey: { type: String, required: true },
  evaluator: { type: evaluatorSchema, required: true },
  staff: { type: staffSchema, required: true },
  course: { type: courseSchema, required: true },
  lmsCode: { type: String, default: '', maxlength: 64 },
  scoring: { type: scoringSchema, required: true },
  status: { type: String, enum: ['draft', 'submitted'], required: true },
  submittedAt: { type: Date, default: null },
  revision: { type: Number, required: true, min: 1 },
  history: { type: [historySchema], default: [] },
  source: { type: String, default: 'ERP departments API' },
  sourceVerifiedAt: { type: Date, required: true },
}, { ...options, collection: 'LMS evaluation' });
// A partial unique index protects current evaluation IDs without failing on old
// faculty/ERP documents that the user may not have cleaned up yet.
EvaluationSchema.index({ evaluationId: 1 }, { unique: true, name: 'evaluationId_unique_strings', partialFilterExpression: { evaluationId: { $type: 'string' } } });
EvaluationSchema.index({ evaluatorId: 1, staffId: 1, status: 1 });
EvaluationSchema.index({ academicYear: 1, semester: 1, staffId: 1 });
export const EvaluationModel = mongoose.model('FacultyStudioCourseEvaluation', EvaluationSchema);

let connectionPromise: Promise<typeof mongoose.connection> | undefined;
export async function connectModels(): Promise<typeof mongoose.connection> {
  if (!connectionPromise) connectionPromise = (async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI is missing.');
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME || 'faculty_engagement', serverSelectionTimeoutMS: 12000 });
    }
    // Do not create unrelated directory collections or remove existing records.
    await Promise.all([AccountModel.init(), EvaluationModel.init()]);
    return mongoose.connection;
  })().catch(error => { connectionPromise = undefined; throw error; });
  return connectionPromise;
}
