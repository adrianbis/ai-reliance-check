// POST /api/submit — stores one opted-in result in the D1 database bound as `DB`.
// Only runs when the person switched on "Add my anonymous answers". Stores no IP, email,
// device details or time of day. Anything that doesn't match the expected shape is rejected.

const VERSIONS = ["v2.0"];
const CONTEXTS = ["study", "work", "both", "everyday"];
const AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]; // under-18 is never stored
const AI_USE = ["daily", "weekly", "monthly", "rarely", "never"];
const PATTERNS = ["light", "balanced", "outsourcing", "unchecked", "manual", "drifting", "steady"];
const HABITS = ["strong", "mixed", "low"];
const DIMS = ["think", "check", "memory", "smart", "aware"];
const ITEMS = ["T1","T2","T3","C1","C2","C3","M1","M2","M3","S1","S2","S3","A1","A2","A3","P1","P2","P3","P4"];

const MAX_BODY = 4096;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const isScore = v => v === null || (Number.isInteger(v) && v >= 0 && v <= 100);

function clean(b) {
  if (!b || typeof b !== "object") return null;
  if (!VERSIONS.includes(b.version)) return null;
  if (!CONTEXTS.includes(b.context)) return null;
  if (!AGES.includes(b.age_bracket)) return null;
  if (!AI_USE.includes(b.ai_use)) return null;
  if (!PATTERNS.includes(b.pattern)) return null;
  if (b.habits !== null && !HABITS.includes(b.habits)) return null;
  if (!isScore(b.core) || !isScore(b.score) || b.score === null) return null;

  // answers: only known item ids; value 0-4 (frequency index) or "na"
  const a = b.answers;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const answers = {};
  for (const [k, v] of Object.entries(a)) {
    if (!ITEMS.includes(k)) return null;
    if (!(v === "na" || (Number.isInteger(v) && v >= 0 && v <= 4))) return null;
    answers[k] = v;
  }
  if (Object.keys(answers).length < 7) return null; // fewer than the universal set = not a real run

  const d = b.dims;
  if (!d || typeof d !== "object") return null;
  const dims = {};
  for (const k of DIMS) {
    if (!isScore(d[k] ?? null)) return null;
    dims[k] = d[k] ?? null;
  }

  const seconds = Number.isInteger(b.seconds) && b.seconds >= 0 && b.seconds <= 7200 ? b.seconds : null;
  const src = typeof b.src === "string" && /^[a-z0-9_-]{1,32}$/i.test(b.src) ? b.src.toLowerCase() : null;

  return {
    version: b.version, context: b.context, age_bracket: b.age_bracket, ai_use: b.ai_use,
    answers: JSON.stringify(answers), dims: JSON.stringify(dims),
    core: b.core, score: b.score, pattern: b.pattern, habits: b.habits, seconds, src
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "no-db" }, 503);

  // Same-site only: a light brake on scripted spam from other sites.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ ok: false }, 403);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ ok: false }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ ok: false }, 400); }

  const r = clean(body);
  if (!r) return json({ ok: false }, 400);

  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO results (version, day, context, age_bracket, ai_use, answers, dims, core, score, pattern, habits, seconds, src)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(r.version, day, r.context, r.age_bracket, r.ai_use, r.answers, r.dims,
           r.core, r.score, r.pattern, r.habits, r.seconds, r.src).run();
  } catch (e) {
    // e.g. the free plan's daily write limit was hit: the person still sees their result
    return json({ ok: false, error: "write-failed" }, 503);
  }
  return json({ ok: true });
}

