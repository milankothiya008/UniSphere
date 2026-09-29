# CampusConnect

A university-only platform for clubs, events and campus life. It replaces the WhatsApp groups, Google Forms, spreadsheets and Instagram posts that clubs juggle today with one flow:

```
Student group ─► club request ─► faculty verification ─► admin approval ─► club created (verifier = faculty mentor)
Mentor appoints president ─► recruitment drive (mentor-approved) ─► students apply per role ─► selection rounds per role ─► offers ─► each student accepts one role
Club creates event ─► venue/time check ─► mentor approves / requests changes / rejects ─► club publishes
Event appears in the campus feed (everyone notified) ─► students register from the feed ─► club manages participants
Event completes ─► club publishes results ─► results show on the event in the feed's Past tab
```

| | |
|---|---|
| **Backend** | Node.js, Express 5, MongoDB / Mongoose 9, JWT (access + rotating refresh cookie), express-validator, nodemailer, multer |
| **Frontend** | React 19, React Router 7, Vite, lucide-react icons, hand-written CSS design system |
| **Tests** | Jest + Supertest against a real MongoDB test database (backend), Vitest + Testing Library (frontend) |

---

## Quick start

Prerequisites: Node 20+ and MongoDB running locally (`mongodb://127.0.0.1:27017`).

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # then set JWT secrets and the bootstrap admin
npm run seed                  # departments, batches, venues, bootstrap admin
npm run seed:demo             # optional: demo clubs, events, results, feed
npm run dev                   # http://localhost:5000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:3000 (proxies /api to :5000)
```

**Email verification and password reset use one-time codes (OTP), not links.** Registering emails a 6-digit code that the student or faculty member enters on the next screen to activate the account. Forgot password works in three steps: email → 6-digit code → new password (the confirmed code is exchanged for a 15-minute reset session; nothing sensitive goes in a URL). Codes expire after 10 minutes, stop working after 5 wrong tries, are single-use, and a new one can be requested once every 60 seconds. Only a keyed hash of each code is stored.

**Email in development:** without SMTP settings, emails (verification, password reset, notifications) are not sent — they are captured in the **development inbox** at http://localhost:3000/dev/inbox, and the sign-up / forgot-password screens link straight to it. Add the `SMTP_*` settings in `backend/.env` to deliver real email; the dev inbox then switches off (it never exists in production). The backend checks the SMTP connection at startup and logs a clear error if the credentials are wrong.

### Demo accounts (`npm run seed:demo`)

All use the password `Demo@1234` (override with `DEMO_PASSWORD`). Student emails use the current year's batch codes; the seed prints the exact list.

| Account | Role |
|---|---|
| `registrar.ce@ddu.ac.in` | University admin |
| `kavita.ce@ddu.ac.in` | Faculty — mentor of Coding Club |
| `nirav.it@ddu.ac.in` | Faculty — mentor of Music Society |
| `riya.ec@ddu.ac.in` | Faculty — verified the Quiz Club request |
| `<batch>ceuog001@ddu.ac.in` | Student — President, Coding Club |
| `<batch>ceuog002@ddu.ac.in` | Student — Event Coordinator, Coding Club |
| `<batch>ceuog003@ddu.ac.in` | Student — Marketing Coordinator, Coding Club |

---

## Roles and permissions

**System roles** are derived from the verified university email — never from client input.

| Role | Email format | Can |
|---|---|---|
| `STUDENT` | `24ceuog001@ddu.ac.in` — 2-digit batch, 2–4 letter department, 3-letter identity, 3-digit number | Propose clubs, apply to club recruitment, register for events, hold club roles |
| `FACULTY` | `mrudang.ce@ddu.ac.in` — first name (letters only), a dot, 2–4 letter department | Verify / request changes / reject club requests, mentor clubs, approve club events, appoint presidents |
| `ADMIN` | faculty-format email, bootstrapped via env | Final club approval, club status, mentor reassignment; university-wide users, departments, batches, venues, audit log — no club-internal management |

The registration form asks whether the user is a Student or Faculty and checks the email against that role's format (the server re-checks and still derives the role from the email). Login requires one of the two formats (case-insensitive) on the university domain. At registration the batch and department must also be active in the admin-managed lists.

**Club roles** are per-club and permission-based (`backend/constants/Permissions.js`):

| Club role | Permissions |
|---|---|
| President | everything below + assign roles + manage club |
| Vice President | members, events, publish, participants, results, posts |
| Event Coordinator | events, view/manage participants, results |
| Technical Coordinator | events, view participants |
| Marketing Coordinator | announcements |
| Treasurer | view participants |
| Member | basic access (member-only posts, member list) |

The club's faculty mentor reviews the club's events, appoints the president and can view (not manage) members and participants. Club details (name, logo, description, …) are edited only by club members whose role has *manage club* (the president).

**The university admin has no club-level authority.** Inside a club the admin can only: give final approval (or rejection) to faculty-verified club requests, change a club's status (active / suspended / archived) and reassign its faculty mentor. The admin cannot edit club details, appoint presidents, manage members or roles, create/review/publish events, see participants, manage results or post for a club. All checks run on the backend in `services/AuthorizationService.js`.

---

## Workflows

**Club request** `PENDING_FACULTY_REVIEW → NEEDS_CHANGES ⇄ (edit + resubmit) → FACULTY_VERIFIED → APPROVED | REJECTED`
Each club is for **one or more departments, or for all departments**, and the same rule applies to everyone in it. The faculty mentor must be from one of the club's departments: this covers the proposed mentor, which open requests a faculty member sees and can verify, and the admin reassigning a mentor. Students can only join, be added to, be approved into or be appointed president of clubs that include their department. The requester and founding members of a club request must also be from its departments. Clubs open to all departments accept any student, and any faculty member can mentor them. Students can name founding members and optionally a preferred faculty mentor (only that faculty member can then review). On approval the club is created with the verifying faculty as mentor and the founders as members. Full history is stored on the request and in the audit log.

**Club** `APPROVED → ACTIVE` when the mentor appoints a president; admins can `SUSPEND`/`ARCHIVE`.

**Event** `DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED → COMPLETED`, plus `NEEDS_CHANGES` (edit and resubmit), `REJECTED` (final) and `CANCELLED`.
- **One event per venue at a time.** A submitted event (awaiting approval), an approved event and a published event all hold their venue; drafts and events sent back for changes do not. The check runs when a draft is created or edited, and again under a per-venue lock on submit, approve and publish, so two clubs submitting the same slot at once cannot both get it. The error and the venue picker name the clashing event, club and time. Back-to-back events (one ends at 13:00, the next starts at 13:00) are allowed.
- **No past dates.** Events must start in the future, and the registration deadline must be in the future and before the event starts. The form limits the date, time and deadline pickers accordingly and the server re-checks. A deadline that passes while an event sits unsubmitted or unpublished must be updated first.
- **Club profiles** carry a tagline, cover image, website, contact email and phone, meeting time and place, and links to Instagram, LinkedIn, X, YouTube, Facebook, GitHub, Discord and WhatsApp. Only the club's leadership (manage-club permission) edits them. Links must be http(s), and each social link must point at its own platform's domain.
- After approval the schedule, venue, title and eligibility are locked; description, rules, contact, poster, capacity (not below current registrations), deadline and "close registration" stay editable. A published-event update note notifies everyone (email to registrants) and appears on the event page.
- Events are public only once published.

**Registration** validates published status, registration window, manual closure, department/batch eligibility, duplicates (unique index) and capacity (atomic conditional seat counter — safe under concurrency). Students can cancel before the event starts; staff with `MANAGE_PARTICIPANTS` can remove participants; participant lists export to CSV.

**Club status.** The university admin can suspend, archive or reactivate a club (with a reason, emailed to the president and mentor). A suspended or archived club is paused: its upcoming events and recruitment stay but are hidden from students and closed to registrations, applications and offers, and registered students and applicants are emailed. Reactivating resumes everything and moves recruitment and offer deadlines on by the paused time.

**Venues and labs.** Venues have a kind (auditorium, hall, classroom, lab, outdoor, other). Labs belong to departments and can only be booked for events whose audience is those departments — the event's own departments if it names any, else its club's. An all-department club's event open to everyone may use any lab.

**Club roles.** Each club defines its own roles. President, Vice-president and Member are built in; the president creates, renames and deletes other roles and picks what each one may do (events, participants, results drafts, check-in scanning, members, posts, gallery approval). Club settings, roles, recruitment, publishing results and starting check-in stay with the president. A club has exactly one president and at most one vice-president (enforced by a unique index). The president can hand over the presidency to another member at any time: the change is immediate, and the former president becomes a regular member.

**Recruitment.** Students join clubs through recruitment drives. A drive recruits for one or more of the club's roles, and each role has its own page-by-page application form (short/long answers, choices, links, PDF or image uploads), its own selection rounds and its own results. The faculty mentor approves the drive, the president publishes it, and every student who can join is notified and emailed. Students fill in the form one page at a time and can apply for several roles, with a separate application for each. After applications close, each role runs as many rounds as needed: screening, online interviews with a meeting link, or offline interviews at a campus venue, with one common time or individual slots. A student interviewing for two roles never gets overlapping slots. Candidates are emailed their invitation, reminders 1 hour and 10 minutes before, and each round's result. The final selection per role sends **offers** (up to the openings), keeps a **reserve list** and thanks the rest. A student with several offers accepts one, joins in that role, and their other applications close automatically. Declined or expired offers free the seat for a reserve candidate, and the drive completes once every role is settled.

**Waitlist.** A full event doesn't turn students away: they join a first-come, first-served waitlist and see their place (#1, #2…). When a seat frees up — a student cancels, an organiser removes a participant, or the capacity is raised — the first student waiting is registered automatically, notified in-app and emailed ("You're in! A spot opened up…"), and everyone behind moves up. Newcomers can't jump the queue, promotion stops once the event starts, and every step is atomic so parallel cancellations never overfill the event or promote anyone twice. Students can leave the waitlist; organisers see it in order on the participants page; waitlisted students also get event updates and cancellation notices.

**Club insights (president's dashboard).** The president's club workspace shows total members, total events (published + completed, plus how many are still in the pipeline), total registrations (and how many are waitlisted), upcoming and completed events, average participation per event with the share of seats filled, and an event-wise registrations chart — registrations against capacity with the waitlist, a hover tooltip, and a table view.

**Results** work like a real competition board:

- **Rounds** (screening, semi-final, finals…) each have standings: rank, registered participant and/or team or name, score, *Qualified* / *Eliminated* and a note. A round can be published any time after the event is published — including mid-event — so a hackathon can announce each round as it's judged. Publishing a round notifies registered participants in-app and by email; qualifiers get a personal "You're through!" email.
- **Final results** (summary + awards, podium for positions 1–3) can be published once the event has started, without waiting for it to be marked completed. Publishing notifies everyone in-app and emails winners, participants and club members.
- **Who does what:** results managers (president, vice-president, event coordinator) prepare drafts; **only the president** (`PUBLISH_RESULTS`) publishes, withdraws a published round, or corrects published results. Corrections are marked "Updated" and audited. Drafts are visible to the organisers and the faculty mentor only.
- **Results page** (`/results`) lists one card per event (poster, stage — live rounds or final — and the winner) with All / Live rounds / Final tabs and search; each card opens `/results/:eventId` with the podium, the summary and a round-by-round standings view. The event page shows a short preview and links to the full results.

**Campus feed** (`/feed`, which replaces the old Discover events page) shows only published events, as poster posts in the style of Instagram: Live now / Upcoming / Past tabs with counts, search, category and club filters, inline registration, and results on completed events. Clicking a post opens the full event page. Activity is not posted to the feed; it becomes **notifications** instead. Publishing an event, publishing results, a new club and public announcements notify every user in-app. Members-only announcements notify members and the mentor. Event updates and cancellations email registrants and notify everyone else in-app. Announcements are listed on the club page, and event updates on the event page. **Audit log** records who/what/when/target/from-state/to-state for every important change.

**Email notifications** work like a real mailing system:

- **Club bell.** Every club page has a bell ("Get notified" / "Notifications on") with a follower count, like YouTube's. Anyone can turn it on for an active club; club members are on by default and can turn it off.
- **Event published:** the club's followers get "*Club* just announced: *Event*"; every other student eligible for the event (department/batch) gets "New event you can join". People who muted that club are not re-targeted.
- **Results published:** winners get a personal "Congratulations!" email, other registered participants get "Results are out", and club members (bell on) get the club's result news. Each person gets one email.
- **Announcements:** followers of the club get public announcements; members-only posts go only to members with the bell on.
- **Email settings** (`/settings/notifications`): three switches — *Clubs you follow*, *New events for you*, *Your events* — plus a list of clubs you follow. Account emails (codes, approvals, registration confirmations) are always sent.
- **Unsubscribe:** every optional email has a footer link (turn off that club, or that category) and `List-Unsubscribe` / one-click headers so Gmail and Outlook show their own Unsubscribe button. Links are signed per person, work without signing in, and the page asks before changing anything.
- **Email queue:** emails are stored in MongoDB (`EmailJob`) and sent in the background at `EMAIL_RATE_PER_MINUTE` (default 30), so publishing returns immediately, nothing is lost on restart, and SMTP limits are respected (a Gmail account allows about 500 emails a day). Failed sends retry after 1, 5, 15 and 60 minutes, then are marked failed; duplicates are dropped; sent/failed jobs are deleted after 30 days. The admin overview shows emails sent, queued and failed in the last 24 hours.

---

## API overview

All responses: `{ success, message, data, meta? }`; errors: `{ success: false, message, errorCode, details? }`.

| Area | Endpoints |
|---|---|
| Auth `/api/auth` | `POST register, verify-email, resend-verification, login, refresh, logout, forgot-password, verify-reset-code, reset-password, change-password` · `GET me` |
| Users `/api/users` | `GET /` (admin) · `GET /search?q=` · `GET/PUT /:id` · `PATCH /:id/status` (admin) |
| Club requests `/api/club-requests` | `POST /` · `GET /` · `GET/PUT /:id` · `POST /:id/resubmit, verify, request-changes, reject, approve` |
| Clubs `/api/clubs` | `GET /` · `GET /mine` · `GET/PUT /:id` · `POST /:id/status` · `PUT /:id/mentor` · `POST /:id/president` · `GET/POST /:id/members` · `PATCH /:id/members/:userId/role` · `GET/POST /:id/roles` · `PUT/DELETE /:id/roles/:key` · `POST /:id/president/transfer` · `DELETE /:id/members/:userId` · `POST /:id/leave` · `GET /:clubId/events` · `GET/POST /:clubId/recruitment` |
| Recruitment `/api/recruitment` | `GET /` (open drives) · `GET /mine` · `GET /review` · `GET/PUT/DELETE /:id` · `POST /:id/submit|approve|request-changes|reject|publish|close|cancel|complete` · `PUT /:id/deadline` · `GET /:id/applications/mine` · `GET/POST/PUT/DELETE /:id/positions/:positionId/application` · `POST /:id/applications/:applicationId/accept|decline` · `POST /:id/uploads` · `GET /:id/applications[/:applicationId]` · `GET/POST /:id/positions/:positionId/rounds` · `PUT /:id/positions/:positionId/rounds/:roundId/schedule|outcomes` · `PATCH /:id/positions/:positionId/rounds/:roundId/slots/:applicationId` · `POST /:id/positions/:positionId/rounds/:roundId/publish` · `POST /:id/positions/:positionId/finalize` · `POST /:id/positions/:positionId/offers/:applicationId` |
| Events `/api/events` | `GET /` (discovery: `timeframe=upcoming|ongoing|past`, `category`, `club`, `search`, `registrationOpen`) · `GET /manage` · `GET /:id` · `POST /` · `PUT /:id` · `POST /:id/submit, approve, request-changes, reject, publish, cancel, complete` · `POST/DELETE /:id/register` · `GET /:id/registrations` · `DELETE /:id/registrations/:rid` · `GET/PUT /:id/results` · `POST /:id/results/publish` |
| Other | `GET /api/registrations/me` · `GET /api/results` · `/api/events/:id/results` (+ `rounds`, `rounds/:roundId`, `…/publish`, `…/unpublish`) · `GET/POST /api/feed`, `DELETE /api/feed/:id` · `/api/notifications` (+ `preferences`, `subscriptions`, public `unsubscribe`) · `GET/PUT /api/clubs/:id/subscription` · `POST /api/uploads/image?folder=` · `GET /api/dashboard` · `/api/venues` · `/api/admin/{stats,faculty,departments,batches}` |

---

## Project structure

```
backend/
  config/         env + database
  constants/      roles, club permissions, statuses, categories, error codes
  models/         User, Club, ClubCreationRequest, ClubMembership, Event, EventRegistration,
                  EventResult, FeedPost, Notification, AuditLog, Venue, Department, AcademicBatch, RefreshToken
  services/       business rules (one service per domain) + Mail/Storage/Notification/Feed/Audit
  controllers/    thin HTTP adapters
  routes/         REST routes with validation and auth middleware
  middleware/     auth, validation, rate limits, uploads, error handler
  scripts/        seed.js (reference data), seedDemo.js (demo story)
  tests/          unit/ and integration/ (Supertest + real MongoDB test DB)
frontend/src/
  api/            fetch client (token refresh, error mapping) + endpoint groups
  context/        auth, workspace (my clubs + reference data), toasts
  components/     ui kit, layout shell, event/club/feed components
  pages/          auth, dashboard, feed, events, clubs, club requests, faculty, admin, …
```

## Testing

```bash
cd backend && npm test        # unit + integration (needs local MongoDB; uses MONGO_TEST_URI / campusconnect_test)
cd frontend && npm test       # Vitest
cd frontend && npm run lint && npm run build
```

Integration tests cover authentication, the full club lifecycle, membership and roles, the event lifecycle with venue conflicts, registration (duplicates, capacity under concurrency, deadlines, eligibility), permission-based participant access, results visibility, the feed, notifications and dashboards.

## Production notes

- Set `NODE_ENV=production`, strong JWT secrets, SMTP and Cloudinary credentials. Cookies become `Secure` and `SameSite=None`.
- `npm run build` in `frontend/`; the backend serves `frontend/dist` when `NODE_ENV=production`, so the app and API share one origin.
- Transactions are used automatically when MongoDB runs as a replica set.
- Existing data from the earlier `COORDINATOR` / `UNIVERSITY_ADMIN` role model, and clubs / club requests stored with a single `departmentCode`, are migrated automatically on startup.

### Frontend on Vercel, backend on Railway

- **Backend (Railway):** deploy the repo with **Root Directory** `backend`; Railway runs `npm start` and provides `PORT`. Use MongoDB Atlas (or Railway's MongoDB) for `MONGO_URI`, and set the variables from `.env.example` with `NODE_ENV=production`, `CLIENT_URL=<your Vercel production URL>` and `TRUST_PROXY=2`.
- **Email:** Railway's free and Hobby plans block outgoing SMTP, so set `BREVO_API_KEY` (Brevo's free plan, sender = a verified address in `MAIL_FROM`).
- **Uploads:** Railway's disk is wiped on every deploy, so set the `CLOUDINARY_*` variables (or mount a Railway volume and point `UPLOAD_DIR` at it).
- **Frontend (Vercel):** Root Directory `frontend`. `frontend/vercel.json` forwards `/api` and `/uploads` to the Railway domain (replace the placeholder), so the browser only talks to the Vercel domain: the sign-in cookie stays first-party and no CORS setup is needed. It also serves `index.html` for every page, so refreshing a deep link works.
- Load the reference data once with `npm run seed` against the production database (e.g. `railway run npm run seed`).

## Out of scope (for now)

Attendance tracking and photo galleries are intentionally not part of this version.
