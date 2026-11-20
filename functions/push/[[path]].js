// /push/* — lock-screen alerts when a friend tries to join your room.
//   GET  /push/key        the public key phones use to sign up for alerts
//   POST /push/subscribe  {room, sub}       the host's phone signs up for alerts for its room (kept 12 hours)
//   POST /push/forget     {room, endpoint}  the host ended the room: stop alerting this phone
//   POST /push/notify     {room, name}      a friend can't reach the room: alert the host's phone
//   POST /push/msg        {endpoint}        the service worker picks up the alert's text
// Pushes carry no data (so nothing needs encrypting); the text waits here for a few minutes.
// The signing key is made here on first use and never leaves Cloudflare.
// Needs a KV namespace bound to this Pages project as PUSH. Without it every call answers
// "not set up" and the game carries on without lock-screen alerts.

const ALLOWED = [/^https:\/\/(www\.)?streakorbust\.com$/, /^https:\/\/([a-z0-9-]+\.)?streakorbust\.pages\.dev$/, /^capacitor:\/\/localhost$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// Only real push services, so this can't be used to make requests anywhere else.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cleanRoom = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const hash = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))).slice(0, 32);
function okEndpoint(e) {
  try { const u = new URL(e); return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)); } catch (err) { return false; }
}

async function vapid(kv) {
  let k = await kv.get('vapid', 'json');
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    k = { priv: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
    await kv.put('vapid', JSON.stringify(k));
  }
  return k;
}

async function sendPush(endpoint, k) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: 'https://streakorbust.com' })));
  const key = await crypto.subtle.importKey('jwk', k.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return fetch(endpoint, { method: 'POST', headers: { Authorization: `vapid t=${head}.${claims}.${sig}, k=${k.pub}`, TTL: '600', Urgency: 'high', 'Content-Length': '0' } });
}

export async function onRequest({ request, env, params }) {
  const origin = request.headers.get('Origin') || '';
  const cors = { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
  if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (origin && !ALLOWED.some((re) => re.test(origin))) return json({ ok: false, why: 'origin' }, 403);
  const kv = env.PUSH;
  if (!kv) return json({ ok: false, why: 'not set up' });

  const path = [].concat(params.path || []).join('/');
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) { return json({ ok: false, why: 'bad request' }, 400); } }

  try {
    if (path === 'key') return json({ ok: true, key: (await vapid(kv)).pub });

    if (path === 'subscribe') {
      const room = cleanRoom(body.room);
      const endpoint = body.sub && body.sub.endpoint;
      if (room.length !== 4 || !okEndpoint(endpoint)) return json({ ok: false, why: 'bad request' }, 400);
      await kv.put(`room:${room}`, JSON.stringify({ endpoint }), { expirationTtl: 12 * 3600 });
      return json({ ok: true });
    }

    if (path === 'forget') {
      const room = cleanRoom(body.room);
      const rec = room.length === 4 && await kv.get(`room:${room}`, 'json');
      if (rec && rec.endpoint === body.endpoint) await kv.delete(`room:${room}`);
      return json({ ok: true });
    }

    if (path === 'notify') {
      const room = cleanRoom(body.room);
      const name = String(body.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'A friend';
      const rec = room.length === 4 && await kv.get(`room:${room}`, 'json');
      if (!rec) return json({ ok: true, sent: false });
      if (await kv.get(`rl:${room}`)) return json({ ok: true, sent: true }); // alerted moments ago
      await kv.put(`rl:${room}`, '1', { expirationTtl: 60 });
      await kv.put(`msg:${await hash(rec.endpoint)}`, JSON.stringify({ title: `${name} wants to play!`, body: `They're trying to join your room ${room}. Tap to open Streak or Bust.` }), { expirationTtl: 600 });
      const r = await sendPush(rec.endpoint, await vapid(kv));
      if (r.status === 404 || r.status === 410) await kv.delete(`room:${room}`); // that phone unsubscribed
      return json({ ok: true, sent: r.ok });
    }

    if (path === 'msg') {
      if (!okEndpoint(body.endpoint)) return json({ ok: true, msg: null });
      return json({ ok: true, msg: await kv.get(`msg:${await hash(body.endpoint)}`, 'json') });
    }
  } catch (e) {
    return json({ ok: false, why: 'server' }, 500);
  }
  return json({ ok: false, why: 'not found' }, 404);
}
