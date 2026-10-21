# Faculty Studio v5.2 — Course-first evaluation reports and navigation

This package contains only **client/** and **server/**, each with an independent TypeScript `package.json`.
The React app talks to the Express API, which calls the authorized college ERP and stores validated
course-evaluation submissions in MongoDB.

## Changes in v5.2

- **Report immediately after one submitted theory course:** a staff member is included when this evaluator
  submits at least one theory course. Saved drafts and untouched courses are excluded from submitted totals.
- **Current versus final average:** Current = average of submitted theory courses; Final = every assigned
  eligible theory course has been submitted by the SAME evaluator. Zero marks are valid; missing marks are
  never treated as zero. A department filter does not alter the average denominator.
- **Course details stay visible:** paper name and code, program, year, section, LMS code and marks appear
  in the compact evaluator/admin summary report.
- **Admin Component-wise Report:** Admin Reports > Component-wise report displays L1–L10 with all 14
  individual marks, with separate Given / Graded (L4, L5, L7) and Created / Graded (L9).
- **Excel export:** includes Evaluated Faculty, Theory Course Details and Component-wise Marks sheets;
  Admin also receives All Evaluator Records (including drafts).
- **3 marks-entry actions:** Save draft, Submit evaluation, and Next course (or Back to courses for the
  final item). Navigating with unsaved edits requires confirmation; Next course does not auto-submit.
- **Professional print header:** Bishop Heber College crest, official institution name,
  Faculty Moodle LMS Engagement Evaluation, ODD Semester 2026–2027.
- **Current reporting scope:** saved and validated MongoDB evaluations for the configured academic term;
  no demo values or synthetic marks are added to official reports.

## Installation / Windows PowerShell

Back up your existing project and MongoDB before replacing program files.
The ZIP does not contain your private `.env`, evaluation data or `node_modules`.
Preserve your current `server/.env` (and rotate any credential exposed in shared logs/chats).

**Terminal 1 (backend)**

```powershell
cd D:\LMS\evaluation\server
npm install
npm run typecheck
npm run dev
```

**Terminal 2 (frontend)**

```powershell
cd D:\LMS\evaluation\client
npm install
npm run typecheck
npm run dev
```

Check http://localhost:4000/api/health and open the URL printed by Vite (usually http://localhost:5173).

## Administrator login (manual account setup)

Evaluator login: choose **Evaluator**, enter a valid, active ERP Staff ID such as
`BHC-STE-00390`. This project uses the staff-profile endpoint for evaluator identity lookup.
The college ERP **does not create the administrator account**.

To create or update one administrator, run this in the server folder after configuring MongoDB:

```powershell
npm run account:create -- admin admin1 "YOUR_UNIQUE_STRONG_PASSWORD" "LMS Administrator"
```

On the sign-in screen choose **Administrator** and use username `admin1` plus the password you chose.
Only the salted password hash is stored in `lms_accounts`. Never put admin credentials in the client.
Do not paste real passwords into chats or screenshots.

## Evaluation workflow

Choose faculty > assigned theory course > enter 14 component marks and LMS code > submit.
When a faculty member has 3 theory courses and one is submitted, the faculty appears in the
**My evaluation report** with that course and a **Current average**. A subsequent submission
increases the submitted-course count and recomputes the average. After the third submission
it is labeled **Final average**. Drafts are excluded. The **Next course** button moves forward
without submitting data automatically and asks before discarding unsaved edits.

Administrator: sign in as Admin > Reports > **Course summary**, **Component-wise report**, or
**All records**. Filter by evaluator and department; print or download Excel.

## Permanent storage and accuracy

MongoDB database comes from `MONGO_DB_NAME`; the primary collection is exactly `LMS evaluation`.
Every validated course evaluation stores evaluator ID/name, evaluated staff ID/name,
course/program/year/section, LMS code, **all fourteen** rubric components, 100-point total,
status, academic term, timestamps, and embedded revision history. Administrator account hashes
are in `lms_accounts`. ERP directory data is fetched live and is not persistently copied into
extra directory collections by this version.

**Do not delete old MongoDB collections merely because they are unused.** Back up and migrate
verified historical marks separately. This update does not erase or rewrite your existing scores.

## Verification

- Backend TypeScript typecheck and build passed with dependencies available in the working environment.
- Frontend TypeScript typecheck passed.
- 23 backend tests passed, including one-of-three submitted reporting and 14-column Excel output.
- Full Vite production build could not be verified here because the uploaded Windows dependency tree
  lacks the Linux-specific Rollup native binary needed by this environment.
- College ERP connectivity, real MongoDB writes/reads, real admin login, printing in your browser,
  and production deployment still need to be tested on your authorized machine.

**Security for public hosting:** Staff-ID-only evaluator login is not identity authentication.
Anyone who learns a faculty ID could impersonate them; add college SSO or another verification
method before hosting this marks-entry site on the public Internet.

---

# Faculty Studio v5.1 — evaluation-only permanent storage

## Purpose

This release changes the actual persistence model, not just collection labels. **ERP staff, department, timetable, and course data is read from the live ERP** for faculty selection and for validating submitted course assignments; it is held only in short-lived process memory. It is **not replicated into separate MongoDB collections**.

MongoDB is used for exactly two types of permanent data:

| Collection | Contents |
|---|---|
| `LMS evaluation` | Every evaluated theory course: academic year/semester, evaluator staff ID/name/department, evaluated faculty ID/name/department, paper title/code/program/year/section, LMS code, all 14 rubric marks, total, status, timestamps and embedded revisions. |
| `lms_accounts` | Manually created **administrator** credentials and password hashes only. Staff-ID evaluator lookup reads ERP directly and does not create an account row. |

**Only current `recordType: 'course_evaluation'` documents for the configured academic term count in official reports.** Historical data stays intact for review until deliberately migrated. The same evaluator may evaluate different faculty and multiple courses; each staff-course-evaluator-semester combination gets one evaluation document with version history.

### Sample evaluation document

```json
{
  "recordType": "course_evaluation",
  "academicYear": "2026-2027",
  "semester": "ODD",
  "evaluationId": "eval:<server-generated-sha256>",
  "evaluatorId": "BHC-STE-00390",
  "evaluator": {"evaluatorId":"BHC-STE-00390","evaluatorName":"Example Evaluator","department":"COMPUTER SCIENCE"},
  "staffId": "BHC-STE-00466",
  "staff": {"staffId":"BHC-STE-00466","staffName":"Example Faculty","department":"COMPUTER SCIENCE"},
  "courseKey": "U26CS101|UG-BSC-CS|1|A",
  "course": {"courseKey":"U26CS101|UG-BSC-CS|1|A","paperCode":"U26CS101","paperTitle":"Example Theory Course","paperType":"Core","programId":"UG-BSC-CS","year":"1","section":"A","department":"COMPUTER SCIENCE","isTheory":true},
  "lmsCode": "LMS-ABC",
  "scoring": {"rubricVersion":2,"maximum":100,"complete":true,"total":100,"marks":{"courseCreation":10,"syllabusPlan":10,"learningResources":10,"assignmentGiven":8,"assignmentGraded":2,"seminarGiven":5,"seminarGraded":5,"quiz":10,"innovativeGiven":5,"innovativeGraded":5,"videoContent":10,"rubricsCreated":8,"rubricsGraded":2,"innovativePedagogy":10}},
  "status": "submitted",
  "revision": 1,
  "history": [{"revision":1,"action":"created","performedBy":"BHC-STE-00390","recordedAt":"<timestamp>","before":null,"after":{"lmsCode":"LMS-ABC","total":100,"status":"submitted","rubricVersion":2,"marks":"<all 14 scores>"}}]
}
```

This is an illustrative record, **not a real faculty evaluation**. The database also adds `createdAt`, `updatedAt`, `submittedAt`, `source` and `sourceVerifiedAt`.

## Windows installation

Keep two root folders: `client/` and `server/`. Use an already rotated MongoDB Atlas password; never store it in React. Copy `server/.env.example` to `server/.env`, set the URI, a random `SESSION_SECRET` of at least 32 characters, and make sure the two authorized ERP endpoints are reachable from the server.

```powershell
cd D:\LMS\evaluation\server
npm install
npm run typecheck
npm run dev
```

```powershell
cd D:\LMS\evaluation\client
npm install
npm run dev
```

For an administrator (only):

```powershell
cd D:\LMS\evaluation\server
npm run account:create -- admin admin1 "<your-strong-private-password>" "LMS Administrator"
```

Evaluators type their staff ID at login; the backend fetches their profile from `ERP_API_BASE/<staffId>`. **No manual evaluator provisioning and no evaluator password** in this build. However, staff ID alone is NOT secure authentication: **do not publicly deploy marks entry with this login**. Integrate college SSO or a secure one-time identity check before internet hosting.

## Removing the old extra collections safely

**The new application does not create or update** `lms_staff`, `lms_departments`, `lms_course_assignments`, `lms_evaluators`, `lms_evaluation_revisions`, or the old ERP source records inside `LMS evaluation`.

Those **already existing** collections/documents do not disappear automatically. To avoid accidentally deleting real marks:

1. Stop the API and back up your database in Atlas / `mongodump`, including `LMS evaluation` and `lms_evaluation_revisions`. Check the backup can be restored.
2. Inspect what would be removed, **without modifying the database**:

   ```powershell
   cd D:\LMS\evaluation\server
   npm run db:cleanup
   ```

3. Review its counts and warnings. If you have a verified backup and agree to delete the **ERP-only cache records**, execute:

   ```powershell
   npm run db:cleanup -- --apply --backup-confirmed --confirm=REMOVE_ERP_CACHES
   ```

The cleanup copies older `lms_evaluation_revisions` histories into the corresponding evaluation documents **before** dropping that collection; it stops if it cannot verify every revision. It also removes the old evaluator-only account rows (which are no longer needed) and obsolete ERP-directory collections. It **never deletes evaluation documents**. Old flat evaluation documents without a verified rubric are kept for a separate review rather than being destroyed.

Because this operation deletes MongoDB data, it is **opt-in, not automatic**. If the cleanup reports unresolved history, keep the old collections and ask for migration help instead of forcibly dropping them. Stop the server while cleaning up, since concurrent writes are unsafe.

## Accuracy rules

- No storage occurs merely by opening the faculty directory.
- Data saved only when the evaluator explicitly saves a draft or submits an evaluation.
- `parseEvaluation` checks that the staff and course match the authoritative ERP directory; practical/lab papers are excluded.
- The authenticated evaluator ID/name are set by the backend; client-provided identity is ignored.
- The server validates all 14 criteria (0.5-point steps), and recalculates scores. A score of zero is valid; an empty mark is not a submitted mark.
- Updates use a per-evaluation revision compare-and-swap; earlier marks are preserved in document history.
- If MongoDB is unavailable, save fails. It does not fall back to demo files.
- Official reports only include validated, **current academic-year/semester** evaluation documents. They never count unverified old snapshot records.
- The API and database connection must be tested on your authorized college network before use with real evaluations.

## Check commands

```powershell
cd D:\LMS\evaluation\server
npm run typecheck
npm run build
npm run test:compiled
npm run verify:schemas
npm run audit:db
```

`audit:db` performs a read-only scan of the real MongoDB records. `db:cleanup` is read-only unless explicit `--apply` and backup confirmation flags are supplied.

## Production notes

The college ERP's Referer headers are added by the backend only. They are not authorization by themselves. Use HTTPS, proper SSO, unique authenticated evaluator identities, database backups, admin role restrictions, rate limits, a fixed academic period and log monitoring before public deployment. Rotate the MongoDB credentials that were previously exposed in chat.
