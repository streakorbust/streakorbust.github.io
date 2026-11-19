// GET /turn — hands the game short-lived relay (TURN) credentials from Cloudflare Realtime, so
// friends on networks that block direct phone-to-phone connections can still join a room.
// Needs two settings on the Cloudflare Pages project: TURN_KEY_ID and TURN_KEY_API_TOKEN (secret).
// Without them it returns an empty list and the game connects the usual way.

const ALLOWED = [/^https:\/\/(www\.)?streakorbust\.com$/, /^https:\/\/([a-z0-9-]+\.)?streakorbust\.pages\.dev$/, /^capacitor:\/\/localhost$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export async function onRequest({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'GET' } });
  const empty = (why) => new Response(JSON.stringify({ iceServers: [], note: why }), { headers });

  // Same-site requests may not send an Origin header; cross-site ones must come from the game.
  if (origin && !ALLOWED.some((re) => re.test(origin))) return empty('origin');
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return empty('not configured');

  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials`;
  const init = { method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) };
  try {
    let r = await fetch(`${base}/generate-ice-servers`, init);
    if (!r.ok) r = await fetch(`${base}/generate`, init);
    if (!r.ok) return empty(`relay error ${r.status}`);
    const d = await r.json();
    const iceServers = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
    return new Response(JSON.stringify({ iceServers }), { headers });
  } catch (e) {
    return empty('relay unreachable');
  }
}
