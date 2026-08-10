// POST /api/generate-test-cases
// Body: { projectName, documentText, documentUrl }
// Requires the caller's Supabase access token in the Authorization header.
// Uses ANTHROPIC_API_KEY (server-side secret, set in Vercel env vars) to
// call Claude and turn a requirements document into structured test cases.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_DOC_CHARS = 15000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // ---- Verify the caller is a signed-in user ----
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    // ---- Gather document content ----
    const { projectName, documentText, documentUrl } = req.body || {};
    let content = (documentText || '').trim();

    if (!content && documentUrl) {
      try {
        const docRes = await fetch(documentUrl, { redirect: 'follow' });
        const raw = await docRes.text();
        content = raw
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } catch {
        res.status(400).json({ error: 'Could not fetch the document link. Try pasting the text instead.' });
        return;
      }
    }

    if (!content) {
      res.status(400).json({ error: 'No document text found. Paste some text or provide a readable link.' });
      return;
    }

    content = content.slice(0, MAX_DOC_CHARS);

    // ---- Ask Claude for structured test cases ----
    const prompt = `You are a QA test case writer. Based on the requirements/document text below for the project "${projectName || 'this project'}", generate a thorough list of manual test cases.

Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"title": "short test case title", "description": "steps or scenario to verify, 1-3 sentences", "priority": "Low"|"Medium"|"High"}]

Cover positive cases, negative/edge cases, and validation. Aim for 8-20 test cases depending on document size. Keep titles concise and descriptions actionable.

Document:
"""
${content}
"""`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('Anthropic API error:', errBody);
      res.status(502).json({ error: 'AI request failed. Check the ANTHROPIC_API_KEY is set correctly in Vercel.' });
      return;
    }

    const aiData = await aiRes.json();
    const textBlock = (aiData.content || []).find((b) => b.type === 'text');
    let raw = textBlock ? textBlock.text.trim() : '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let testCases;
    try {
      testCases = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: 'AI response could not be parsed. Try again.' });
      return;
    }

    if (!Array.isArray(testCases)) {
      res.status(502).json({ error: 'AI response was not a list of test cases. Try again.' });
      return;
    }

    const cleaned = testCases
      .filter((t) => t && t.title)
      .map((t) => ({
        title: String(t.title).slice(0, 200),
        description: t.description ? String(t.description).slice(0, 1000) : null,
        priority: ['Low', 'Medium', 'High'].includes(t.priority) ? t.priority : 'Medium',
      }));

    res.status(200).json({ testCases: cleaned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};