# Real-world acceptance tests for Faculty Studio v5.2

Use your authorized college ERP network and a backed-up TEST MongoDB before production.
Do not type sensitive passwords into screenshots or chats.

## 1. API and directory

- Start the backend (`cd server; npm run dev`) and confirm `GET /api/health` succeeds.
- Start the frontend (`cd client; npm run dev`), sign in with an active evaluator staff ID.
- Check the faculty directory shows valid department and theory course assignments, not lab/practical papers.
- Check staff ID/profile is sourced from the ERP, not manually fabricated in the frontend.

## 2. One out of three submitted courses

- Open a staff member assigned exactly three theory courses.
- Save a **draft** of course 1: this must NOT appear in a submitted report.
- Finish all 14 marks and LMS code; submit course 1.
- On Staff Page the course must say Submitted; the student/staff course progress must be `1/3`.
- In My evaluation report that staff must appear NOW, with the first course, its title, paper code,
  LMS code, `marks/100`, and a **Current average** equal to that submitted mark.
- Courses 2 and 3 must NOT be shown as zero or included as submitted.
- Submit course 2; report must show both and recompute current average.
- Submit course 3; report must show all three and label the average **Final**.
- Refresh the browser. The same marks, scores and status must load from MongoDB.

## 3. Next Course button

- Check the marks-entry page shows 3 actions: Save draft, Submit evaluation, Next course.
- With edits not saved, Next Course must ask for confirmation, rather than silently dropping the changes.
- Save a draft, press Next Course: next assigned course opens.
- On the final course the action says Back to courses and returns to the staff course list.
- Next course must never submit incomplete marks automatically.

## 4. Admin login

- Run `npm run account:create -- admin admin1 "A_LONG_UNIQUE_PASSWORD" "LMS Administrator"` from server.
- Choose Administrator on the login screen. Sign in with `admin1` and that password.
- Verify admins cannot edit rubric marks; evaluator can.

## 5. Admin reporting

- Under Admin Reports select Course summary. Confirm staff appear after ONE submitted theory course,
  with Current/Final label and course details; evaluator identities must remain separate.
- Use evaluator and department filters to check course-level results.
- Open Component-wise report. Verify L1 to L10 and every mark (14 total) corresponds to the submitted record.
- L4 Assignment must show Given /8 and Graded /2, L5 Seminar /5 + /5,
  L7 Innovative Assessment /5 + /5, L9 Rubrics Created /8 and Graded /2.
- Open All records. Drafts should be present here but not in the submitted reports.
- Export Excel; verify sheets `Evaluated Faculty`, `Theory Course Details`, `Component-wise Marks` and
  for admin `All Evaluator Records`. Check totals match MongoDB.
- Check the print preview includes the official crest and exactly the three requested heading lines.

## 6. Cross-evaluator accuracy

- If Evaluator A submits paper 1 and Evaluator B submits paper 2 for the same faculty,
  neither should be marked Final unless one person evaluates all assigned theory papers.
- Admin Overview should NOT combine these two partial submissions into a false completed status.

## 7. Hosting security

Staff ID alone cannot prove the user's identity. Restrict this mode to an internal test network;
college SSO, OTP or equivalent authentication is essential before public deployment.
