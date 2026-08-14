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
- **Description**, **Steps to Reproduce**, **Expected Result**, **Actual Result**
  (all of these are combined into the bug's Description)
- **Bug Id**, **Date**, **Notes** (kept in Notes, for traceability back to the sheet row)

## 7. Open your dashboard

Vercel gives you a URL like `https://your-project.vercel.app`. Open it,
sign in with the email + password you created in Supabase Auth, and
you're in.

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
