// POST /api/generate-test-cases
// Two-stage AI QA pipeline:
// 1) Extract requirements exactly from text/URL.
// 2) Generate detailed tests in batches.
// 3) Audit coverage and generate missing tests (up to 3 refinement passes).
//
// Server-side secrets:
// GEMINI_API_KEY
// SUPABASE_URL
// SUPABASE_ANON_KEY
//
// The API accepts either documentText or a public http(s) documentUrl.
// URL fetching is deliberately restricted to public http(s) URLs.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const MAX_DOC_CHARS = 60000;
const MAX_URL_BYTES = 500000;
const MAX_REQUIREMENTS_PER_BATCH = 10;
const MAX_REFINEMENT_PASSES = 3;
const MAX_TEST_CASES = 500;

const SCENARIO_TYPES = [
  'Positive', 'Negative', 'Boundary/Edge', 'Validation', 'API/Backend',
  'Database/Data Integrity', 'Integration', 'Security', 'Authorization',
  'Failure/Recovery', 'Duplicate/Idempotency', 'Concurrency',
  'Cross-Region', 'Role-Based', 'Compatibility/Configuration'
];

function cleanHtmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (h === '0.0.0.0' || h === 'metadata.google.internal' || h.endsWith('.internal')) return true;
  return false;
}

async function fetchPublicUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid document URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only public http(s) URLs are supported.');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Private/local URLs are not allowed.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'QA-Dashboard-Requirements-Reader/1.0' },
    });
    if (!response.ok) throw new Error(`Document URL returned HTTP ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/|json|xml|javascript/.test(type)) {
      throw new Error('The URL does not appear to contain readable text/HTML content.');
    }
    const len = Number(response.headers.get('content-length') || 0);
    if (len > MAX_URL_BYTES) throw new Error('Document URL is too large.');
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      const text = await response.text();
      return text.slice(0, MAX_URL_BYTES);
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_URL_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new Error('Document URL is too large.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((x) => Buffer.from(x))).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstObj = raw.indexOf('{');
  const firstArr = raw.indexOf('[');
  const starts = [firstObj, firstArr].filter((n) => n >= 0);
  if (!starts.length) throw new Error('AI response did not contain JSON.');
  const start = Math.min(...starts);
  const lastObj = raw.lastIndexOf('}');
  const lastArr = raw.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) throw new Error('AI response JSON was incomplete.');
  return JSON.parse(raw.slice(start, end + 1));
}

async function gemini(prompt, schema, options = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: options.maxOutputTokens || 30000,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();
  if (!response.ok) {
    console.error('Gemini API error:', text);
    let message = 'Gemini request failed.';
    try {
      const parsed = JSON.parse(text);
      message = parsed.error && parsed.error.message ? parsed.error.message : message;
    } catch {}
    throw new Error(message);
  }

  const data = JSON.parse(text);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const output = parts.map((p) => p.text || '').join('').trim();
  if (!output) throw new Error('Gemini returned an empty response.');
  return extractJson(output);
}

const extractionSchema = {
  type: 'object',
  properties: {
    projectSummary: { type: 'string' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userStory: { type: 'string' },
          actor: { type: 'string' },
          goal: { type: 'string' },
          benefit: { type: 'string' },
          acceptanceCriteria: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                originalText: { type: 'string' },
                normalizedRequirement: { type: 'string' },
                priority: { type: 'string', enum: ['Low','Medium','High','Critical'] },
                applicableScenarioTypes: { type: 'array', items: { type: 'string' } },
              },
              required: ['id','originalText','normalizedRequirement','priority','applicableScenarioTypes'],
            },
          },
        },
        required: ['id','userStory','actor','goal','benefit','acceptanceCriteria'],
      },
    },
  },
  required: ['projectSummary','requirements'],
};

const testSchema = {
  type: 'object',
  properties: {
    testCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          requirementId: { type: 'string' },
          title: { type: 'string' },
          scenarioType: { type: 'string' },
          priority: { type: 'string', enum: ['Low','Medium','High','Critical'] },
          risk: { type: 'string', enum: ['Low','Medium','High','Critical'] },
          preconditions: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          expectedResult: { type: 'string' },
        },
        required: ['id','requirementId','title','scenarioType','priority','risk','preconditions','steps','expectedResult'],
      },
    },
  },
  required: ['testCases'],
};

const auditSchema = {
  type: 'object',
  properties: {
    coverage: {
      type: 'object',
      properties: {
        totalRequirements: { type: 'integer' },
        fullyCovered: { type: 'integer' },
        partiallyCovered: { type: 'integer' },
        notCovered: { type: 'integer' },
        percentage: { type: 'number' },
        categoryCoverage: {
          type: 'object',
          properties: {
            Positive: { type: 'number' },
            Negative: { type: 'number' },
            'Boundary/Edge': { type: 'number' },
            Validation: { type: 'number' },
            'API/Backend': { type: 'number' },
            'Database/Data Integrity': { type: 'number' },
            Integration: { type: 'number' },
            Security: { type: 'number' },
            Authorization: { type: 'number' },
            'Failure/Recovery': { type: 'number' },
            'Duplicate/Idempotency': { type: 'number' },
            Concurrency: { type: 'number' },
            'Cross-Region': { type: 'number' },
            'Role-Based': { type: 'number' },
            'Compatibility/Configuration': { type: 'number' },
          },
          required: [],
        },
      },
      required: ['totalRequirements','fullyCovered','partiallyCovered','notCovered','percentage','categoryCoverage'],
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          status: { type: 'string', enum: ['Fully Covered','Partially Covered','Not Covered'] },
          missingScenarioTypes: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
        },
        required: ['requirementId','status','missingScenarioTypes','explanation'],
      },
    },
    missingRequirements: { type: 'array', items: { type: 'string' } },
    highRiskGaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['coverage','findings','missingRequirements','highRiskGaps'],
};

function normalizeRequirements(extracted) {
  const reqs = [];
  for (const us of (extracted.requirements || [])) {
    for (const ac of (us.acceptanceCriteria || [])) {
      reqs.push({
        id: ac.id,
        userStoryId: us.id,
        userStory: us.userStory,
        actor: us.actor,
        originalText: ac.originalText,
        normalizedRequirement: ac.normalizedRequirement,
        priority: ac.priority,
        applicableScenarioTypes: ac.applicableScenarioTypes || [],
      });
    }
  }
  return reqs;
}

function dedupeTests(tests) {
  const seen = new Set();
  return tests.filter((t) => {
    const key = `${t.requirementId}|${String(t.title).toLowerCase().replace(/\W+/g,' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function testsForPrompt(tests) {
  return tests.map((t) => ({
    id: t.id, requirementId: t.requirementId, title: t.title,
    scenarioType: t.scenarioType, priority: t.priority, risk: t.risk,
    preconditions: t.preconditions, steps: t.steps, expectedResult: t.expectedResult,
  }));
}

async function generateBatch(projectName, requirements) {
  const prompt = `You are a senior QA architect. Generate exhaustive, non-duplicate manual test cases for the listed acceptance criteria for project "${projectName}".

SOURCE-OF-TRUTH RULE:
- Test only what is stated or logically required by the acceptance criteria.
- Do not silently change, remove, or contradict a requirement.
- Every test case MUST map to exactly one requirementId from the supplied list.
- Do not invent unrelated product functionality.

COVERAGE RULE:
For each acceptance criterion, generate every APPLICABLE scenario category:
${SCENARIO_TYPES.join(', ')}.

Use deeper coverage for High/Critical requirements. For payment, authentication, authorization, OTP, financial calculations, webhooks, third-party APIs, databases, country/region routing and data isolation, include positive, negative, boundary, API/backend, data integrity, security, failure/recovery, duplicate/idempotency and concurrency scenarios whenever applicable.

For region/country requirements, explicitly test both regions and unauthorized cross-region attempts.
For role requirements, test every named role.
For third-party integrations, test success, failure, timeout, malformed response, duplicate callback/webhook and recovery where applicable.
For financial calculations, include boundary values, zero, decimals, rounding and configuration changes where applicable.

Return detailed tests with actionable steps and expected results. Do not merge independent acceptance criteria into one test.

Acceptance criteria:
${JSON.stringify(requirements, null, 2)}`;

  const result = await gemini(prompt, testSchema, { maxOutputTokens: 30000 });
  return Array.isArray(result.testCases) ? result.testCases : [];
}

async function auditCoverage(projectName, requirements, tests) {
  const prompt = `You are the final QA coverage auditor for "${projectName}".

Compare EVERY acceptance criterion against the generated test cases. Coverage is measured at acceptance-criterion level, not user-story level.

A requirement is Fully Covered only when the tests adequately exercise its applicable scenario types. A requirement is Partially Covered when it has tests but important applicable categories are missing. It is Not Covered when no relevant test exists.

Do not invent requirements. Do not mark a requirement fully covered merely because one broad test mentions it.

Pay special attention to:
- country/region isolation and cross-region tampering
- role-based permissions
- payment methods, payment failures and webhooks
- financial calculations, rounding and configuration
- API/server-side validation
- database/data integrity
- third-party API timeouts/errors
- authentication/OTP/JWT security
- duplicate/idempotency/concurrency
- recovery and retry paths

Requirements:
${JSON.stringify(requirements, null, 2)}

Generated tests:
${JSON.stringify(testsForPrompt(tests), null, 2)}`;

  return gemini(prompt, auditSchema, { maxOutputTokens: 18000 });
}

async function generateGapTests(projectName, requirements, tests, findings) {
  const gaps = findings.filter((f) => f.status !== 'Fully Covered' && f.missingScenarioTypes?.length);
  if (!gaps.length) return [];
  const reqMap = new Map(requirements.map((r) => [r.id, r]));
  const targeted = gaps
    .map((g) => ({ requirement: reqMap.get(g.requirementId), missingScenarioTypes: g.missingScenarioTypes, explanation: g.explanation }))
    .filter((x) => x.requirement);

  const prompt = `You are a senior QA gap-closure specialist.

Generate ONLY the missing tests needed to close the identified coverage gaps.
Do not repeat existing tests. Every test must map to one supplied requirementId and one missing scenario category.

Requirements and identified gaps:
${JSON.stringify(targeted, null, 2)}

Existing tests:
${JSON.stringify(testsForPrompt(tests), null, 2)}

Generate precise, actionable tests. If a listed scenario category is genuinely not applicable, do not create a meaningless test.`;

  const result = await gemini(prompt, testSchema, { maxOutputTokens: 30000 });
  return Array.isArray(result.testCases) ? result.testCases : [];
}

function normalizeTest(t, index, prefix = 'AI') {
  const allowedPriority = ['Low','Medium','High','Critical'];
  const priority = allowedPriority.includes(t.priority) ? t.priority : 'Medium';
  const risk = allowedPriority.includes(t.risk) ? t.risk : priority;
  const scenarioType = SCENARIO_TYPES.includes(t.scenarioType) ? t.scenarioType : 'Positive';
  return {
    id: String(t.id || `${prefix}-${String(index + 1).padStart(4,'0')}`),
    requirementId: String(t.requirementId || ''),
    title: String(t.title || '').slice(0, 240),
    scenarioType,
    priority,
    risk,
    preconditions: String(t.preconditions || '').slice(0, 1200),
    steps: Array.isArray(t.steps) ? t.steps.map(String).slice(0, 20) : [],
    expectedResult: String(t.expectedResult || '').slice(0, 2000),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Supabase server environment variables are missing.' });
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid or expired session' });

    const { projectName, documentText, documentUrl } = req.body || {};
    let content = String(documentText || '').trim();

    if (!content && documentUrl) {
      const raw = await fetchPublicUrl(String(documentUrl).trim());
      content = cleanHtmlToText(raw);
    }
    content = content.slice(0, MAX_DOC_CHARS);

    if (!content) return res.status(400).json({ error: 'Provide document text or a public document URL.' });
    if (content.length < 20) return res.status(400).json({ error: 'The document is too short to analyze.' });

    // PASS 1: exact requirement extraction.
    const extractionPrompt = `You are a requirements analyst, not a test case writer.

Extract the requirements from the supplied project document EXACTLY and completely.

Rules:
1. Preserve every user story.
2. Preserve EVERY acceptance criterion as a separate item.
3. Do not merge independent acceptance criteria.
4. Do not invent requirements.
5. originalText must be a faithful copy of the source criterion, with only harmless whitespace normalization.
6. normalizedRequirement may clarify wording but MUST NOT change its meaning.
7. Assign stable IDs in order: US-01-AC-01, US-01-AC-02, etc.
8. Identify applicable test scenario categories, but do not generate tests yet.
9. Treat lists under Acceptance Criteria as separate criteria.
10. If a sentence contains two independently testable obligations, split them into separate criteria while preserving the source text in each item.
11. Return only JSON matching the schema.

Project: ${projectName || 'Unnamed project'}

SOURCE DOCUMENT:
"""
${content}
"""`;

    const extracted = await gemini(extractionPrompt, extractionSchema, { maxOutputTokens: 22000 });
    const requirements = normalizeRequirements(extracted);

    if (!requirements.length) {
      return res.status(422).json({ error: 'Gemini could not extract any acceptance criteria from the document.' });
    }

    // PASS 2: generate tests in manageable batches.
    const batches = [];
    for (let i = 0; i < requirements.length; i += MAX_REQUIREMENTS_PER_BATCH) {
      batches.push(requirements.slice(i, i + MAX_REQUIREMENTS_PER_BATCH));
    }
    const batchResults = await Promise.all(
      batches.map((batch) => generateBatch(projectName || 'this project', batch))
    );
    let tests = batchResults.flat().slice(0, MAX_TEST_CASES);
    tests = dedupeTests(tests).map((t, i) => normalizeTest(t, i));

    // PASS 3 + 4: audit and close gaps up to 3 times.
    let audit = await auditCoverage(projectName || 'this project', requirements, tests);
    for (let pass = 1; pass <= MAX_REFINEMENT_PASSES; pass++) {
      const gapTests = await generateGapTests(projectName || 'this project', requirements, tests, audit.findings || []);
      if (!gapTests.length) break;
      tests = dedupeTests([...tests, ...gapTests]).slice(0, MAX_TEST_CASES).map((t, i) => normalizeTest(t, i));
      const nextAudit = await auditCoverage(projectName || 'this project', requirements, tests);
      audit = nextAudit;
      if ((audit.coverage?.notCovered || 0) === 0 && (audit.coverage?.partiallyCovered || 0) === 0) break;
    }

    // Final deterministic checks: every generated test must reference a real requirement.
    const validIds = new Set(requirements.map((r) => r.id));
    tests = tests.filter((t) => validIds.has(t.requirementId));
    const coveredIds = new Set(tests.map((t) => t.requirementId));
    const deterministicCovered = requirements.filter((r) => coveredIds.has(r.id)).length;
    const deterministicPercentage = Math.round((deterministicCovered / requirements.length) * 1000) / 10;

    // Never advertise 100% simply from AI's own claim unless every requirement has a mapped test.
    const finalCoverage = {
      ...(audit.coverage || {}),
      totalRequirements: requirements.length,
      mappedRequirements: deterministicCovered,
      mappingPercentage: deterministicPercentage,
      aiAuditedPercentage: audit.coverage?.percentage ?? deterministicPercentage,
    };

    return res.status(200).json({
      source: documentUrl ? 'url' : 'text',
      projectSummary: extracted.projectSummary || '',
      requirements,
      testCases: tests,
      coverage: finalCoverage,
      findings: audit.findings || [],
      missingRequirements: audit.missingRequirements || [],
      highRiskGaps: audit.highRiskGaps || [],
      refinementPasses: MAX_REFINEMENT_PASSES,
      model: GEMINI_MODEL,
    });
  } catch (err) {
    console.error('AI pipeline error:', err);
    const message = err && err.message ? err.message : 'Unexpected server error.';
    res.status(502).json({ error: message });
  }
};
