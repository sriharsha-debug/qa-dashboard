// Server-side proxy for Grok (xAI) requests.
//
// The dashboard's frontend is a static site, so it can never hold the
// Grok API key safely (anyone could open dev tools and read it). This
// tiny Vercel Function is the fix: it lives on the server, reads the
// key from an environment variable, calls xAI, and hands back just the
// text. The browser never sees the key, and calling api.x.ai server-to-
// server also sidesteps any CORS restrictions on browser calls.
//
// Set GROK_API_KEY (and optionally GROK_MODEL) in your Vercel project's
// Settings -> Environment Variables, then redeploy.

const API_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL = process.env.GROK_MODEL || 'grok-4.3';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROK_API_KEY is not configured on the server. Add it in Vercel -> Settings -> Environment Variables and redeploy.' });
    return;
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" string in request body.' });
    return;
  }

  try {
    const grokRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(Number(maxTokens) || 2000, 8000),
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!grokRes.ok) {
      const text = await grokRes.text();
      res.status(grokRes.status).json({ error: `Grok API error: ${text.slice(0, 500)}` });
      return;
    }

    const data = await grokRes.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;

    if (!text) {
      res.status(502).json({ error: 'Grok returned no text content.' });
      return;
    }

    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: `Server error calling Grok: ${err.message}` });
  }
};
