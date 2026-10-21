import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { AccountModel, EvaluationModel } from '../src/models/schemas/index.js';
import { CRITERIA } from '../src/shared/criteria.js';
import { validateScore } from '../src/models/schema-storage.js';
import type { Evaluation } from '../src/shared/types.js';

const marks = Object.fromEntries(CRITERIA.map(x => [x.key, x.max]));
const fixture = {
  evaluationId: 'eval:example-hash', recordType: 'course_evaluation',
  academicYear: '2026-2027', semester: 'ODD', evaluatorId: 'BHC-STE-00390',
  staffId: 'BHC-STE-00466', courseKey: 'U26CS1|UG-BSC-CS|1|A',
  evaluator: { evaluatorId: 'BHC-STE-00390', evaluatorName: 'Example Evaluator', department: 'COMPUTER SCIENCE' },
  staff: { staffId: 'BHC-STE-00466', staffName: 'Example Faculty', department: 'COMPUTER SCIENCE' },
  course: { courseKey: 'U26CS1|UG-BSC-CS|1|A', paperCode: 'U26CS1', paperTitle: 'Theory Subject',
    paperType: 'Core', programId: 'UG-BSC-CS', year: '1', section: 'A', department: 'COMPUTER SCIENCE', isTheory: true },
  lmsCode: 'LMS-01', status: 'submitted', scoring: { rubricVersion: 2, marks, total: 100, maximum: 100, complete: true },
  revision: 1, sourceVerifiedAt: new Date(), history: [{ revision: 1, action: 'created',
    recordedAt: new Date(), performedBy: 'BHC-STE-00390', before: null,
    after: { marks, total: 100, status: 'submitted', lmsCode: 'LMS-01' } }],
};
test('database defines only admin and evaluation models', () => {
  assert.equal(EvaluationModel.collection.name, 'LMS evaluation');
  assert.equal(AccountModel.collection.name, 'lms_accounts');
  assert.deepEqual(mongoose.modelNames().sort(), ['FacultyStudioAdmin', 'FacultyStudioCourseEvaluation']);
});
test('stored record contains evaluator, faculty, theory course, 14 marks, and revision', () => {
  const document = new EvaluationModel(fixture);
  assert.equal(document.validateSync(), undefined);
  const raw = document.toObject();
  assert.equal(raw.evaluator.evaluatorId, fixture.evaluatorId);
  assert.equal(raw.staff.staffName, fixture.staff.staffName);
  assert.equal(raw.course.paperCode, fixture.course.paperCode);
  assert.equal(Object.keys(raw.scoring.marks).length, 14);
  assert.equal(raw.history.length, 1);
});
test('rejects invalid component marks and totals before database write', () => {
  const record = { rubricVersion: 2, marks: { ...marks }, total: 100, status: 'submitted', lmsCode: 'LMS-01' } as Evaluation;
  validateScore(record);
  assert.throws(() => validateScore({ ...record, marks: { ...marks, rubricsCreated: 12 } }), /Invalid mark/);
  assert.throws(() => validateScore({ ...record, total: 99 }), /total mismatch/);
});
