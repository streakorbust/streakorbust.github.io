// Live rooms: a thin wrapper over PeerJS (WebRTC data channels, free public signaling server).
// The host's phone runs the game; guests connect to the host's peer id, which is built from
// the room code. No accounts, no game server. App-level messages are plain JSON objects.
(function (global) {
  'use strict';

  // The App Store app ships its own copy of PeerJS (no code loaded from the internet); the website uses the CDN.
  const PEERJS_URL = global.Capacitor ? 'peerjs.min.js' : 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'streakorbust-room-';
  const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: codes never spell words, no 0/O or 1/I mixups
  const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  let handlers = {};
  let peer = null;
  let role = null; // 'host' | 'guest' | null
  let code = null;
  let left = true; // true once leave() is called: stop reconnecting
  const conns = new Map(); // host: guest peer id -> DataConnection
  let hostConn = null; // guest: connection to the host
  let retryTimer = null;
  let everConnected = false;

  const emit = (type, ...args) => { if (handlers[type]) handlers[type](...args); };

  let loading = null;
  function load() {
    if (global.Peer) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.onload = () => (global.Peer ? resolve() : reject(new Error('offline')));
      s.onerror = () => { loading = null; s.remove(); reject(new Error('offline')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function reset() {
    clearTimeout(retryTimer);
    conns.clear();
    hostConn = null;
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } }
    peer = null;
  }

  function keepSignal(p) {
    // The phone dropped its link to the signaling server (backgrounded, network blip): rejoin it.
    p.on('disconnected', () => {
      if (left || p !== peer) return;
      setTimeout(() => { if (!left && p === peer && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* retried on wake */ } } }, 1000);
    });
  }

  // ---------- host ----------
  // wanted: reopen a specific code (after the host's app restarted). The old id can stay
  // reserved on the server for a little while, so keep trying for ~20s.
  async function host(wanted) {
    await load();
    left = false;
    role = 'host';
    let tries = 0;
    return new Promise((resolve, reject) => {
      const attempt = (c) => {
        reset();
        code = c;
        const p = new Peer(PREFIX + c);
        peer = p;
        let opened = false;
        keepSignal(p);
        p.on('open', () => { opened = true; resolve(c); });
        p.on('connection', (conn) => {
          conn.on('open', () => { conns.set(conn.peer, conn); });
          conn.on('data', (d) => emit('message', d, conn.peer));
          conn.on('close', () => { if (conns.get(conn.peer) === conn) { conns.delete(conn.peer); emit('leave', conn.peer); } });
          conn.on('error', () => { /* close handles it */ });
        });
        p.on('error', (e) => {
          if (p !== peer) return;
          if (!opened && e.type === 'unavailable-id') {
            if (!wanted && tries++ < 6) return attempt(newCode());
            if (wanted && tries++ < 10) { p.destroy(); return setTimeout(() => { if (!left) attempt(c); }, 2000); }
          }
          if (!opened) { reject(e); return; }
          emit('error', e);
        });
      };
      attempt(wanted ? cleanCode(wanted) : newCode());
    });
  }

  const broadcast = (msg) => { for (const c of conns.values()) { try { c.send(msg); } catch (e) { /* closing */ } } };
  const sendTo = (id, msg) => { const c = conns.get(id); if (c) { try { c.send(msg); } catch (e) { /* closing */ } } };
  const kick = (id) => { const c = conns.get(id); if (c) setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 300); };

  // ---------- guest ----------
  // Resolves once connected to the host; rejects if the room can't be found the first time.
  async function join(wanted) {
    await load();
    left = false;
    role = 'guest';
    code = cleanCode(wanted);
    everConnected = false;
    reset();
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = () => { if (!settled) { settled = true; resolve(code); } };
      const fail = (e) => { if (!settled) { settled = true; left = true; reset(); reject(e); } };
      const p = new Peer();
      peer = p;
      keepSignal(p);
      p.on('open', () => connect(ok, fail));
      p.on('error', (e) => {
        if (p !== peer) return;
        if (!everConnected) fail(e.type === 'peer-unavailable' ? new Error('no-room') : e);
        else scheduleRetry();
      });
      setTimeout(() => fail(new Error('timeout')), 15000);
    });
  }

  function connect(ok, fail) {
    if (left || !peer || peer.destroyed) return;
    if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* retry below */ } scheduleRetry(); return; }
    const conn = peer.connect(PREFIX + code, { reliable: true });
    const t = setTimeout(() => { if (!conn.open) { try { conn.close(); } catch (e) { /* ignore */ } if (everConnected) scheduleRetry(); } }, 10000);
    conn.on('open', () => {
      clearTimeout(t);
      hostConn = conn;
      everConnected = true;
      clearTimeout(retryTimer);
      emit('open');
      if (ok) ok();
    });
    conn.on('data', (d) => emit('message', d));
    conn.on('close', () => {
      if (hostConn !== conn) return;
      hostConn = null;
      if (!left) { emit('lost'); scheduleRetry(); }
    });
    conn.on('error', () => { /* close handles it */ });
    if (fail) conn.on('error', fail);
  }

  function scheduleRetry(ms = 2500) {
    if (left || role !== 'guest') return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!hostConn && !left) connect(); }, ms);
  }

  const send = (msg) => { if (hostConn) { try { hostConn.send(msg); return true; } catch (e) { /* closing */ } } return false; };

  // ---------- shared ----------
  function leave() {
    left = true;
    role = null;
    code = null;
    reset();
  }

  // Back from the background: reconnect right away instead of waiting for a timer.
  function wake() {
    if (left || !peer) return;
    if (peer.destroyed) { if (role === 'host') host(code).catch(() => emit('error', { type: 'reopen' })); return; }
    if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
    if (role === 'guest' && !hostConn) scheduleRetry(300);
  }

  global.Net = {
    load, host, join, leave, wake, broadcast, sendTo, send, kick, cleanCode,
    on(type, fn) { handlers[type] = fn; },
    get role() { return role; },
    get code() { return code; },
    get connected() { return role === 'host' ? !!(peer && peer.open) : !!hostConn; },
  };
})(window);
