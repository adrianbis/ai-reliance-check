// POST /api/tally — anonymous daily counter of tests started and finished.
// Body: {"version":"v2.0","event":"start"|"finish"}. Stores nothing about the person.

const VERSIONS = ["v2.0"];
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "no-db" }, 503);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ ok: false }, 403);

  let b;
  try { b = JSON.parse((await request.text()).slice(0, 200)); } catch { return json({ ok: false }, 400); }
  if (!b || !VERSIONS.includes(b.version) || !["start", "finish"].includes(b.event)) return json({ ok: false }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const col = b.event === "start" ? "started" : "finished"; // fixed whitelist, never user text
  try {
    await env.DB.prepare(
      `INSERT INTO funnel (day, version, ${col}) VALUES (?1, ?2, 1)
       ON CONFLICT(day, version) DO UPDATE SET ${col} = ${col} + 1`
    ).bind(day, b.version).run();
  } catch (e) {
    return json({ ok: false }, 503);
  }
  return json({ ok: true });
}

