# MongoDB: only official evaluation records and administrator accounts

See `README.md` for exact record shape, validation, audit and backup-first cleanup.

The two current collections are `LMS evaluation` (evaluation records, embedded evaluator/staff/course snapshots and all 14 marks) and `lms_accounts` (admin logins only). The ERP directory remains external and is not stored as MongoDB faculty/timetable records.

Use `npm run db:cleanup` to **inspect** old collections. Do not delete them by hand because `lms_evaluation_revisions` may hold earlier marks. Cleanup is guarded, opt-in and depends on a verified backup.
