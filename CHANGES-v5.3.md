# v5.3 — Shared faculty status and individual evaluator reports

- `/api/faculty-progress` returns institutional course-submission status, using the newest valid submitted score for each staff/course across evaluators.
- Directory status and average are now shared institution-wide. No evaluator is allowed to edit another evaluator’s submission; `/api/evaluations/:staffId` remains evaluator-scoped.
- `My evaluation report` remains scoped to the signed-in evaluator; admin report displays evaluator-specific submissions.
- The overall/mean average card has been removed from report screen and print view. Individual staff/course averages remain.
- Directory values are fetched from MongoDB-backed submitted evaluation records, not browser-local session state.
- Caveat: institution-wide completion means every distinct assigned theory course has at least one submitted evaluation, possibly by different evaluators. Evaluator-specific finality remains separate.
