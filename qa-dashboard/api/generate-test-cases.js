// POST /api/generate-test-cases
// Body: { projectName, documentText }
// Requires the caller's Supabase access token in the Authorization header.
// Uses GEMINI_API_KEY (server-side secret, set in Vercel env vars) to call
// Google's free Gemini API and turn a requirements document into
// structured test cases.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
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
    const { projectName, documentText } = req.body || {};
    const content = (documentText || '').trim().slice(0, MAX_DOC_CHARS);

    if (!content) {
      res.status(400).json({ error: 'No document text provided.' });
      return;
    }

    // ---- Ask Gemini for structured test cases ----
    const prompt = `You are a QA test case writer. Based on the requirements/document text below for the project "${projectName || 'this project'}", generate a thorough list of manual test cases.

Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"title": "short test case title", "description": "steps or scenario to verify, 1-3 sentences", "priority": "Low"|"Medium"|"High"}]

Cover positive cases, negative/edge cases, and validation. Aim for 8-20 test cases depending on document size. Keep titles concise and descriptions actionable.

Document:
"""
${content}
"""`;

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      console.error('Gemini API error:', errBody);
      res.status(502).json({ error: 'AI request failed. Check the GEMINI_API_KEY is set correctly in Vercel.' });
      return;
    }

    const aiData = await aiRes.json();
    const candidate = aiData.candidates && aiData.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    let raw = parts && parts[0] && parts[0].text ? parts[0].text.trim() : '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      raw = raw.slice(start, end + 1);
    }

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
