# QA Daily Dashboard — Deploy Guide (Vercel + Supabase)

A single-user dashboard to manage your projects (with status, start date,
bugsheet link) and log a daily QA report per project: date, project manager,
bugsheet, test cases, UI bugs, functionality bugs, remarks, sign off, notes.

**Security model:** you log in with email + password via **Supabase Auth**.
The site is a plain static site — no server needed — so it deploys to
Vercel (or Netlify, or anywhere else that serves static files). The
browser talks to Supabase directly using the public "anon" key (that key
is *meant* to be public), and Row Level Security policies on the database
make sure only someone who is actually signed in can read or write
anything. There's no public sign-up — you create your own account directly
in the Supabase dashboard.

---

## 1. Set up Supabase

### If this is a brand new Supabase project
1. Go to https://supabase.com → New project (free tier is fine).
2. **SQL Editor → New query**, paste the contents of `supabase-schema.sql`, click **Run**.

### If you already have the Supabase project from the old Netlify version
Run these two migration files, in order, in **SQL Editor → New query**:
1. `migration-v4.sql` — switches security to Supabase Auth (RLS policies)

(You should already have run `migration-v2.sql` and `migration-v3.sql`
earlier — skip those if so.)

### Get your API keys
**Project Settings → API Keys**:
- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon / public key** — this one is safe to put in the frontend code
  (do NOT use the `service_role` / secret key here)

### Create your login
**Authentication → Users → Add user**:
- Enter your email and a password
- Toggle **Auto Confirm User** on (so you don't need to click an email link)
- Click **Create user**

Optional but recommended — stop anyone else from signing up:
**Authentication → Settings → User Signups** → turn off "Allow new users to sign up".

## 2. Fill in your config

Open `public/config.js` in this folder and paste in your values:
```js
const SUPABASE_URL = "https://abcdefgh.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";
```
Save the file.

## 3. Push this project to GitHub

```
cd qa-dashboard
git init
git add .
git commit -m "QA daily dashboard - Vercel + Supabase Auth"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```
(If you already have a repo from the Netlify version, just commit and push
the changes instead of `git init` again.)

## 4. Deploy to Vercel

1. Go to https://vercel.com → **Add New → Project** → import your GitHub repo.
2. Framework Preset: **Other**.
3. If your repo has the `public` folder nested inside a subfolder (e.g.
   `qa-dashboard/public`), set **Root Directory** to that subfolder path
   in the import screen so Vercel finds `public/index.html` correctly.
4. Click **Deploy**. No environment variables needed — the anon key lives
   in `config.js`, which is safe to ship.

## 5. Add Audit Logs

Run `migration-v17.sql` in Supabase SQL Editor after `migration-v16.sql`.

This adds an **Audit Logs** tab for the team leader. It records create, update, and delete activity for projects, daily reports, test cases, APK shares, and profiles, including user email, action, module, record, timestamp, and changed fields. Existing names and existing dashboard sections are unchanged.

## 6. Add Bugs (per project, with Page)

Run `migration-v18.sql` in Supabase SQL Editor after `migration-v17.sql`.

This adds a **Bugs** section inside Project Details, under Test execution. Each
bug is logged against a project with: title, **page** (the screen/module it
was found on), severity (Low/Medium/High/Critical), status (Open/In
Progress/Fixed/Retest/Closed/Reopened), description, reported by, and notes.
Bug activity is included in the Audit Logs the same as everything else.
(Brand new Supabase projects don't need this step — `supabase-schema.sql`
already includes it.)

> **Seeing "Could not find the table 'public.bugs' in the schema cache"?**
> That means this migration (or the full `supabase-schema.sql`, for a brand
> new project) hasn't been run yet on your Supabase project. Open
> **Supabase → SQL Editor → New query**, paste the file, click **Run**, then
> reload the dashboard.

## 6b. Full bug-sheet fields (Module, Steps, Dev/Retest status, comments)

Run `migration-v19.sql` in Supabase SQL Editor after `migration-v18.sql`.
(Brand new Supabase projects don't need this step — `supabase-schema.sql`
already includes it.)

This rounds the Bugs section out into a proper bug-tracking sheet. Each bug
now also has: **Module** and **Sub Module** (business-area grouping, on top
of the existing Page field), **Steps to Reproduce**, **Expected Result**,
**Actual Result**, **Developer Status** (Not Started / In Progress / Fixed /
Cannot Reproduce / Need Info / Won't Fix), **Developer Comments**, **Retest
Status** (Not Retested / Pass / Fail / Blocked), and **Manager Comments**.
Developer Status and Retest Status can be changed inline from the bug list,
the same way Status already could. All the new columns are optional, so
existing bugs are unaffected.

### Importing bugs from a multi-tab tester bug sheet

If your testers keep bugs in one Google Sheet with a separate tab per
module/role (e.g. `Super Admin`, `University Admin`, `Student`, `Faculty`,
`Professor_UI` — like the screenshot tab bar at the bottom of Sheets), the
**Import bugs from Google Sheet** panel (Bugs tab → per project) can pull in
every tab in one go:

1. Share the sheet as **Anyone with the link → Viewer**.
2. Paste the sheet's link into **Google Sheet link**.
3. In **Tab names to import**, type the exact tab names, comma-separated —
   e.g. `Super Admin, University Admin, Student, Faculty, Professor_UI`.
   (Leave this blank to import just the one tab from the link, the old way.)
4. Click **Fetch from link**. Each tab is fetched and parsed on its own —
   they can even use different column layouts — then merged into one review
   list, tagged with the tab they came from. A summary line shows how many
   bugs were found per tab.
5. Uncheck anything you don't want, then **Add selected to Bugs**.

Recognized columns, in any order (a title-like column and a page/module-like
column are required, the rest are optional):
- **Title** or **Sub Module**
- **Page** or **Module** (falls back to the tab name if the column is blank/missing)
- **Severity**, **Status**, **Reported By**
- **Steps to Reproduce**, **Expected Result**, **Actual Result**, **Description**
- **Developer Status**, **Developer Comments**, **Retest Status**, **Manager Comments**
- **Bug Id**, **Date**, **Notes** (Bug Id/Date are kept in Notes, for traceability back to the sheet row)

## 6c. Daily Log stays in sync automatically (no new migration needed)

No schema change is required for this — it's a display/behavior change only,
using columns that already exist.

**Bugs and test cases** — the Daily Log has always pulled Test Cases, UI
bugs, Functionality bugs, "bugs identified today", closed/reopened/retest
counts, etc. live from the `bugs` and `test_cases` tables (see the `AUTO`
badges). Add a bug, close one, move one to Retest, mark one Reopened — the
Daily Log card, the single-entry share, and **Share day's updates** (the
"share everything at once" button, top of the Daily Log tab) all reflect it
immediately, with nothing to re-type.

**Project details (Project Manager, Bugsheet)** — these now work the same
way. Project Manager and Bugsheet used to be typed by hand into each daily
entry and saved as a one-time snapshot on that `daily_reports` row, so
updating them later on the Projects tab didn't touch old entries. Now:
- The Daily Log form still auto-fills Project Manager/Bugsheet from the
  selected project (labelled `AUTO`, click **↻ Refresh from live data** to
  re-sync), and still saves whatever you typed to that row for audit/history.
- But everywhere the Daily Log is *displayed or shared* — the report card,
  the single-entry share, **Share day's updates**, the auto-generated card
  for a project with bug activity but no manual entry, and the Daily Logs
  CSV export — now reads Project Manager and Bugsheet **live from the
  project record**, not the old saved snapshot.
- So: edit a project's Project Manager or Bugsheet on the Projects tab once,
  and every past and future daily log for that project shows the new value
  immediately — you never have to re-save old entries.
- It also still works the other way: typing a new Project Manager/Bugsheet
  into a daily entry (add or edit) writes it back to the project record too,
  so either screen can be the one you update from.

Other project fields shown on the Daily Log (like Project Deadline, i.e.
`projects.end_date`) already worked this way before this change.

## 6d. Status, live Bugs summary, and Project Document on the Daily Log — and a duplicate-card fix

No schema change for this either — same existing `projects` columns
(`status`, `project_document`) and `bugs` table, used from a new place.

**New on the Daily Log form (add + edit):**
- **Status** — a dropdown of your team's statuses (Projects tab → Manage
  statuses), auto-filled from the selected project, editable, and written
  back to the project on save.
- **Project document** — same pattern as Bugsheet: auto-filled, editable,
  written back.
- **Bugs (AUTO)** — a live line showing the same total/open/closed/reopened
  summary you see on Project Details (e.g. *"24 total — 5 Open, 2 Reopened,
  17 Closed"*), read-only, always current.

These mirror what's shown on the Project Details overview panel, and the
same live-sync rule from 6c applies: editing them from the Daily Log form
updates the project, and editing them on Project Details updates every
Daily Log card immediately — either screen works.

Report cards now also show a Status pill and a Project Document link,
sourced live the same way Project Manager/Bugsheet already were.

**Duplicate-looking Daily Log cards:** if you're in a timezone ahead of UTC
(e.g. India), the app previously computed "today" using UTC
(`toISOString()`), which rolls over several hours before your actual local
midnight. In roughly the first ~5 hours after your local midnight, that
made the default date on the entry form disagree with the date the
auto-generated "bug activity, no manual entry" card used — so a project
could show both a manually dated entry and a separate auto card for what
felt like the same day. "Today" is now computed from your browser's local
calendar date everywhere, so this shouldn't happen anymore. Sharing (single
entry, or **Share day's updates**) already merged multiple entries for the
same project + date into one block before sending — that part didn't need
a fix, just the duplicate *display* did.

## 7. Open your dashboard

Vercel gives you a URL like `https://your-project.vercel.app`. Open it,
sign in with the email + password you created in Supabase Auth, and
you're in.

## 8. Upload APK files directly (e.g. builds shared over WhatsApp)

Run `migration-v26.sql` in Supabase SQL Editor after `migration-v25.sql`.
(Brand new Supabase projects don't need this step — `supabase-schema.sql`
already includes it.) This creates a Storage bucket called `apk-files` and
adds a few columns to `apk_shares` to track uploaded files.

Once that's run, **Project Details → APK shares** has an **APK file**
upload field alongside the existing **APK link** field:

1. Download/save the `.apk` (or `.aab`) your dev team sent on WhatsApp to
   your phone or computer.
2. On the APK shares form, click **APK file** and pick it — or keep using
   **APK link** instead if you'd rather paste a Drive/WeTransfer link like
   before. Use one or the other, not both.
3. Fill in the rest (version, shared date, etc.) and click **Log APK**.

The uploaded file gets its own public link automatically, so **Download /
link**, the Project Details "Latest APK" line, and the WhatsApp share
message all work exactly the same as they did with a pasted link — nothing
else changes. Removing an APK entry also deletes its uploaded file from
storage.

**File size:** Supabase's default upload limit is 50MB per file, which
covers most APKs. If your builds run bigger, raise it in the Supabase
dashboard: **Storage → apk-files bucket → Settings → File size limit**.

## AI test case generation (free — no API key needed)

The Test Execution tracker can turn a requirements document into test
cases using Claude — with **no billing and no backend function**. It works
like this:

1. In Project Details → Test execution, paste your requirements text.
2. Click **Generate test cases (opens Claude.ai)** — this copies a
   ready-made prompt (your document included) to your clipboard and opens
   a free Claude.ai chat in a new tab.
3. Paste the prompt into Claude.ai and send it.
4. Copy Claude's reply, come back to the dashboard, paste it into
   "Paste the AI's reply here", and click **Parse response**.
5. Review the suggested test cases, uncheck any you don't want, and click
   **Add selected to Test Execution**.

Each team member uses their own Claude.ai account (free tier works fine),
so there's no shared API key or cost on your end.

---

## Notes

- To add a teammate later: **Supabase → Authentication → Users → Add user**
  the same way.
- All data lives in Supabase, so it's safe across redeploys.
- The `anon` key is designed to be public — Row Level Security (set up by
  the migration/schema SQL) is what actually protects your data, not
  keeping that key secret.
- This static-site setup also works unchanged on Netlify, GitHub Pages, or
  any other static host if you ever want to switch again — just publish
  the `public` folder.
