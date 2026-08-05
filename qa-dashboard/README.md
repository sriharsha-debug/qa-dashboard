# QA Daily Dashboard — Deploy Guide

A single-user dashboard to manage your projects (with status) and log a daily
QA report per project: date, project manager, bugsheet, test cases, UI bugs,
functionality bugs, remarks, sign off, and notes.

**Security model:** you log in with email + password via Netlify Identity.
Your Supabase key is never sent to the browser — it lives only in Netlify
Functions (server-side), which check that you're signed in before touching
the database. Nobody else can read or write your data without your email +
password, and the database itself has Row Level Security on with no public
policies, so even the anon key can't be used to bypass your login.

---

## 1. Create the Supabase project (2 min)

1. Go to https://supabase.com → New project (free tier is fine).
2. Once created, open **SQL Editor → New query**, paste the contents of
   `supabase-schema.sql` (included in this folder), and click **Run**.
3. Go to **Project Settings → API**. Copy:
   - **Project URL** (e.g. `https://xxxx.supabase.co`)
   - **service_role key** (under "Project API keys" — NOT the `anon` key)

Keep this tab open, you'll paste these into Netlify next.

## 2. Push this project to GitHub

1. Create a new empty GitHub repo.
2. Push this whole folder to it:
   ```
   cd qa-dashboard
   git init
   git add .
   git commit -m "QA daily dashboard"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

## 3. Deploy to Netlify (3 min)

1. Go to https://app.netlify.com → **Add new site → Import an existing project**.
2. Pick your GitHub repo. Build settings are already set via `netlify.toml`
   (publish dir `public`, functions dir `netlify/functions`) — just click **Deploy**.
3. Once deployed, go to **Site configuration → Environment variables** and add:
   - `SUPABASE_URL` = the Project URL from step 1
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key from step 1
4. Trigger a redeploy (**Deploys → Trigger deploy**) so the functions pick up
   the new environment variables.

## 4. Turn on Identity and invite yourself (2 min)

1. In your Netlify site: **Site configuration → Identity → Enable Identity**.
2. Under **Identity → Registration**, set it to **Invite only** (so nobody else
   can self-register).
3. Under **Identity → Identity providers**, email/password is on by default —
   that's all you need.
4. Go to the **Identity** tab (top-level, next to Deploys) → **Invite users**
   → enter your own email.
5. Check your inbox for the invite email, click it, and set your password.

## 5. Open your dashboard

Your live URL is shown at the top of the Netlify site overview, e.g.
`https://your-site-name.netlify.app`. Open it, sign in with the email +
password you just set, and start logging projects and daily status.

You can rename the site (and get a nicer URL) under
**Site configuration → General → Site details → Change site name**.

---

## Notes

- Only invited emails can log in — there's no public signup.
- To add a teammate later, just invite their email the same way in step 4.
- All project and daily-report data lives in Supabase, so it's safe even if
  you redeploy the site.
- Local testing: `npm install -g netlify-cli`, then `netlify dev` from this
  folder (functions need the two environment variables set locally too, via
  a `.env` file or `netlify env:set`).
