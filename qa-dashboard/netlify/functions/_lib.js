const { createClient } = require('@supabase/supabase-js');

// Service role key is a server-only secret set in Netlify's environment
// variables (Site settings → Environment variables). It is never sent
// to the browser, so this is safe here.
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Requires a logged-in Netlify Identity user. Netlify populates
// context.clientContext.user automatically when the request includes
// an `Authorization: Bearer <identity-jwt>` header from a signed-in user.
function requireUser(context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return null;
  }
  return user;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

module.exports = { getSupabase, requireUser, json };
