// Streak or Bust connection server (signal.streakorbust.com).
//
// Phones in a room find each other through here, then talk directly (or through the relay).
// It speaks the same small protocol as the public PeerJS server, so the game's PeerJS code works
// unchanged: a phone opens a WebSocket with its id, and the server passes OFFER / ANSWER /
// CANDIDATE / LEAVE messages to the phone they're addressed to. No game data goes through here.
//
// Each room code gets its own Durable Object (ids look like streakorbust-room-ABCD for the host
// and streakorbust-g-ABCD-xxxx for guests), so rooms never share anything and it scales out.
// Heartbeats are answered automatically without waking the room up (cheap), and their timestamps
// tell us when a phone has silently disappeared, so a dropped host's room id frees up quickly.

const ALLOWED = [/^https:\/\/(www\.)?streakorbust\.com$/, /^https:\/\/([a-z0-9-]+\.)?streakorbust\.pages\.dev$/, /^capacitor:\/\/localhost$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RELAY = new Set(['OFFER', 'ANSWER', 'CANDIDATE', 'LEAVE', 'EXPIRE']);
const SILENT_MS = 15000; // no heartbeat for this long: that phone is gone

const shardOf = (id) => {
  const m = /^streakorbust-(?:room|g)-([A-Z]{4})(?:-|$)/.exec(id);
  return m ? `room-${m[1]}` : 'lobby';
};
const randomId = () => `streakorbust-x-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (origin && !ALLOWED.some((re) => re.test(origin))) return new Response('Not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });

    // PeerJS asks for a random id when a phone doesn't bring its own (the game always does).
    if (/\/id$/.test(url.pathname)) return new Response(randomId(), { headers: { ...cors, 'Content-Type': 'text/plain' } });

    if (/\/peerjs$/.test(url.pathname)) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const id = url.searchParams.get('id') || '';
      const token = url.searchParams.get('token') || '';
      if (!ID_OK.test(id) || !token) return new Response('Bad id', { status: 400 });
      const room = env.ROOMS.get(env.ROOMS.idFromName(shardOf(id)));
      return room.fetch(request);
    }

    return new Response('Streak or Bust connection server is running.', { headers: { ...cors, 'Content-Type': 'text/plain' } });
  },
};

export class Rooms {
  constructor(state) {
    this.state = state;
    // Answer heartbeats without waking the room (and remember when each phone last sent one).
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"HEARTBEAT"}', '{"type":"HEARTBEAT"}'));
  }

  lastHeard(ws) {
    const att = ws.deserializeAttachment() || {};
    const beat = this.state.getWebSocketAutoResponseTimestamp(ws);
    return Math.max(att.at || 0, beat ? beat.getTime() : 0, att.seen || 0);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const token = url.searchParams.get('token');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // One phone per id. The same phone coming back (same token) replaces its old link; another
    // phone can take the id only if the current holder has gone silent.
    for (const old of this.state.getWebSockets(id)) {
      const att = old.deserializeAttachment() || {};
      if (att.token === token || Date.now() - this.lastHeard(old) > SILENT_MS) {
        try { old.close(1000, 'replaced'); } catch (e) { /* already closed */ }
      } else {
        server.accept();
        server.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } }));
        server.close(1008, 'ID is taken');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    this.state.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, token, at: Date.now() });
    server.send(JSON.stringify({ type: 'OPEN' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
    if (!msg || !RELAY.has(msg.type) || !msg.dst) return;
    const att = ws.deserializeAttachment() || {};
    att.seen = Date.now();
    ws.serializeAttachment(att);
    const dst = String(msg.dst);
    const out = JSON.stringify({ type: msg.type, src: att.id, dst, payload: msg.payload });
    const targets = this.state.getWebSockets(dst).filter((t) => Date.now() - this.lastHeard(t) <= SILENT_MS);
    if (targets.length) {
      for (const t of targets) { try { t.send(out); } catch (e) { /* closing */ } }
    } else if (msg.type === 'OFFER') {
      // Nobody with that id here: tell the sender right away (the game shows "Looking for room").
      ws.send(JSON.stringify({ type: 'EXPIRE', src: dst, dst: att.id }));
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) { /* already closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch (e) { /* already closed */ }
  }
}
