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

## 5. Open your dashboard

Vercel gives you a URL like `https://your-project.vercel.app`. Open it,
sign in with the email + password you created in Supabase Auth, and
you're in.

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
