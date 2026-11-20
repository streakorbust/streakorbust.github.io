// Streak or Bust UI: renders engine snapshots, plays events as animations, handles input,
// and runs live online rooms (the host's phone runs the game; guests mirror it).
(function () {
  'use strict';
  const { Game, breakdown } = StreakOrBust;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const NUM_COLORS = ['#7c8798', '#e63946', '#f77f00', '#e0a400', '#5fae3e', '#12a36b', '#0fa3b1', '#2f80ed', '#5b4fe0', '#9b51e0', '#d63ab8', '#e8456b', '#8d5b2f'];
  const P_COLORS = ['#f0602b', '#1b8fd6', '#e0367a', '#2fa84f', '#8b5cf6', '#d99a00', '#0f9e8e', '#c2410c', '#3b5bdb', '#d6409f'];
  const pc = (i) => P_COLORS[i % P_COLORS.length];
  const MAX_PLAYERS = 4;
  const SEAT_MAX = 4; // up to this many players, show everyone's cards at once (4 = 2x2 grid)

  const SAVE = 'streakorbust.save.v1'; // one-phone game in progress
  const LAST = 'streakorbust.last.v1'; // summary of the most recent finished game, for the home-screen recap
  const PREFS = 'streakorbust.prefs.v1';
  const HOSTED = 'streakorbust.hosted.v1'; // online game this phone is hosting, so the room can be reopened
  const ROOM = 'streakorbust.room.v1'; // online room this phone joined as a guest, for one-tap rejoin
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const prefs = Object.assign({ names: [], count: 2, target: 200, myName: '', mode: 'local', cid: '' }, store.get(PREFS) || {});
  prefs.count = Math.min(prefs.count, MAX_PLAYERS);
  prefs.target = 200; // every visit starts at the standard 200; pick 100 or Custom per game
  const debug = /[?&]debug\b/.test(location.search);
  // This phone's id in online rooms, so a dropped player gets their seat back when they reconnect.
  // (?debug gives each tab its own id, to test a room with two tabs.)
  if (!prefs.cid) { prefs.cid = Math.random().toString(36).slice(2, 12); store.set(PREFS, prefs); }
  const myCid = debug ? (() => {
    try { return sessionStorage.dcid || (sessionStorage.dcid = Math.random().toString(36).slice(2, 12)); } catch (e) { return Math.random().toString(36).slice(2, 12); }
  })() : prefs.cid;

  let game = null;
  let busy = false;
  let focusP = 0;
  let lastTurnP = null;
  let dealing = false;
  let undo = null; // { snap, timer, pending } after a CLOSE, until the next action ({ online } in rooms)

  // Online rooms
  let mode = 'local'; // 'local' (one phone) | 'host' | 'guest'
  let mySeat = null; // this phone's player index in an online game
  let presence = []; // online: false for players whose phone has dropped out
  let guestX = null; // guests keep their own badges/moments (the host's aren't sent)
  let pendingAct = null; // guest: waiting for the host to apply our move
  const isMine = (i) => mode === 'local' || i === mySeat;

  // Turn nudge: online, if it becomes your turn while you're looking at another app or tab,
  // the tab title flashes until you come back. No sound, no vibration.
  const BASE_TITLE = document.title;
  let nudgeTimer = null;
  function nudge(on) {
    clearInterval(nudgeTimer);
    nudgeTimer = null;
    document.title = BASE_TITLE;
    if (!on) return;
    let k = 0;
    document.title = '🔔 Your turn!';
    nudgeTimer = setInterval(() => { document.title = (++k % 2) ? BASE_TITLE : '🔔 Your turn!'; }, 1000);
  }
  // The game's public web address.
  const SITE_URL = 'https://streakorbust.com/';
  // Running inside the App Store app (Capacitor) rather than a browser.
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // ---------------- card art ----------------
  const arm = (k) => `<g transform="rotate(${k * 60} 32 32)"><path d="M32 32V6M25 12l7 6.5 7-6.5M27.5 21.5l4.5 3.5 4.5-3.5"/></g>`;
  const ICONS = {
    // Chill: a snowflake
    lock: `<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${[0, 1, 2, 3, 4, 5].map(arm).join('')}<circle cx="32" cy="32" r="4.5" fill="#2f5fd0" stroke="#fff" stroke-width="3"/></svg>`,
    // Hat Trick: three cards fanned out, a 3 on the front one
    rush: `<svg viewBox="0 0 64 64"><g stroke="#1f9d5a" stroke-width="2.2"><rect x="7" y="15" width="24" height="34" rx="5" transform="rotate(-18 19 32)" fill="#d9f7e6"/><rect x="20" y="12" width="24" height="34" rx="5" fill="#eefcf4"/><rect x="33" y="15" width="24" height="34" rx="5" transform="rotate(18 45 32)" fill="#fff"/></g><text x="45" y="40.5" transform="rotate(18 45 32)" text-anchor="middle" font-size="21" font-weight="900" fill="#1f9d5a" font-family="ui-rounded, system-ui, sans-serif">3</text></svg>`,
    // Lifeline: a heart with a heartbeat line
    shield: `<svg viewBox="0 0 64 64"><path d="M32 57C10 41 4 31 4 21 4 12 11 6 19 6c6 0 10 3 13 8 3-5 7-8 13-8 8 0 15 6 15 15 0 10-6 20-28 36z" fill="#fff"/><path d="M11 30h12l4-9 6 17 5-12 3 4h12" fill="none" stroke="#8441d4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  const ACTION_NAME = { lock: 'Chill', rush: 'Hat Trick', shield: 'Lifeline' };

  function cardHTML(c, cls = '') {
    switch (c.kind) {
      case 'num':
        return `<div class="card num ${c.value === 6 || c.value === 9 ? 'u69 ' : ''}${c.value >= 10 ? 'two ' : ''}${cls}" style="--c:${NUM_COLORS[c.value]}"><span class="big">${c.value}</span></div>`;
      case 'mod':
        return `<div class="card mod ${cls}"><span class="big">+${c.value}</span></div>`;
      case 'x2':
        return `<div class="card x2 ${cls}"><span class="big">×2</span></div>`;
      case 'lock':
        return `<div class="card lock ${cls}"><div class="ic">${ICONS.lock}</div></div>`;
      case 'rush':
        return `<div class="card rush ${cls}"><div class="ic">${ICONS.rush}</div></div>`;
      case 'shield':
        return `<div class="card shield ${cls}"><div class="ic">${ICONS.shield}</div></div>`;
    }
    return '';
  }
  const cardName = (c) => (c.kind === 'num' ? String(c.value) : c.kind === 'mod' ? `+${c.value}` : c.kind === 'x2' ? '×2' : ACTION_NAME[c.kind]);

  // ---------------- effects ----------------
  const fx = (() => {
    const cv = $('#fx'); const cx = cv.getContext('2d');
    let parts = []; let running = false;
    function size() { const d = window.devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); }
    addEventListener('resize', size); size();
    function loop() {
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.vy += 0.32; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 1;
        cx.save(); cx.globalAlpha = Math.min(1, p.life / 30); cx.translate(p.x, p.y); cx.rotate(p.r);
        cx.fillStyle = p.c;
        if (p.round) { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, 7); cx.fill(); } else cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        cx.restore();
      }
      if (parts.length) requestAnimationFrame(loop); else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    // n pieces from (x, y) given as fractions of the screen; cols overrides the confetti palette.
    function burst(n = 160, y = 0.4, cols = ['#ffd23f', '#ff6b1a', '#ff3d81', '#3ddcff', '#a3e635', '#c084fc', '#fff'], x = 0.5) {
      for (let i = 0; i < n; i++) {
        parts.push({ x: innerWidth * x + (Math.random() - 0.5) * 60, y: innerHeight * y, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5, s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], life: 110 + Math.random() * 60, round: Math.random() < 0.3 });
      }
      if (!running) { running = true; requestAnimationFrame(loop); }
    }
    return { burst };
  })();

  // ---------------- heat ----------------
  const numsOf = (p) => p.cards.filter((c) => c.kind === 'num').length;
  function setHeat(n, live) {
    $('#heat').style.opacity = live && n >= 3 ? (Math.min(1, (n - 2) / 5) * 0.9).toFixed(2) : 0;
  }
  // Pulse the warm glow while the player on turn holds 5-6 numbers.
  const heart = (() => {
    let rate = 0;
    function stop() { rate = 0; $('#heat').classList.remove('beat'); }
    function set(ms) {
      if (ms === rate) return;
      stop();
      if (!ms) return;
      rate = ms;
      $('#heat').style.setProperty('--beat', ms + 'ms');
      $('#heat').classList.add('beat');
    }
    return { set, stop };
  })();

  // ---------------- achievements, moments ----------------
  const ACH = {
    sweep: ['🌟', 'Clean Sweep', 'Collected 7 different numbers'],
    greedy: ['🤑', 'Greedy', 'Busted holding 6 numbers'],
    nerves: ['😎', 'Nerves of Steel', 'Closed holding 6 numbers'],
    ice: ['🧊', 'Cold Shoulder', 'Chilled a rival sitting on 40+'],
    saved: ['🛟', 'Saved by the Bell', 'A Lifeline saved you'],
    survivor: ['💪', 'Survivor', 'Made it through a Hat Trick'],
    bigbank: ['💰', 'Big Bank', 'Scored 60+ in one round'],
    zero: ['🎯', 'Zero Hero', 'Won a round holding the 0'],
    comeback: ['🚀', 'Comeback Kid', 'Won after trailing by 50+'],
  };
  // App-side extras saved with the game: achievements, round moments, biggest deficits.
  function X() {
    if (mode === 'guest') return guestX || (guestX = { ach: {}, moments: [], maxDef: [] });
    if (!game.s.x) game.s.x = { ach: {}, moments: [], maxDef: [] };
    return game.s.x;
  }
  const badgeQ = [];
  let badgeBusy = false;
  function award(i, id) {
    const x = X();
    const list = x.ach[i] || (x.ach[i] = []);
    if (list.includes(id)) return;
    list.push(id);
    badgeQ.push([game.s.players[i].name, id]);
    runBadges();
  }
  async function runBadges() {
    if (badgeBusy) return;
    badgeBusy = true;
    while (badgeQ.length) {
      const [name, id] = badgeQ.shift();
      const [e, t, d] = ACH[id];
      const el = $('#badge');
      el.innerHTML = `<span class="be">${e}</span><div><small>${esc(name)} unlocked</small><b>${t}</b><span class="d">${d}</span></div>`;
      el.classList.add('show');
      await sleep(2400);
      el.classList.remove('show');
      await sleep(450);
    }
    badgeBusy = false;
  }
  const moment = (w, html) => X().moments.push({ w, html });
  const rawPts = (p) => breakdown(Object.assign({}, p, { status: 'active' })).score;

  // Badges and round highlights for each event (runs alongside the animations).
  function react(ev) {
    const s = ev.snap, P = s.players;
    const nm = (i) => `<b>${esc(P[i].name)}</b>`;
    switch (ev.type) {
      case 'roundStart':
        X().moments = [];
        break;
      case 'bust': {
        const pts = rawPts(P[ev.p]);
        if (numsOf(P[ev.p]) === 6) award(ev.p, 'greedy');
        moment(pts, `💥 ${nm(ev.p)} busted holding ${pts} points`);
        break;
      }
      case 'saved':
        award(ev.p, 'saved');
        moment(25 + breakdown(P[ev.p]).score, `🛟 A Lifeline saved ${nm(ev.p)}`);
        break;
      case 'sweep':
        award(ev.p, 'sweep');
        moment(999, `🌟 ${nm(ev.p)} made a Clean Sweep`);
        break;
      case 'lock': {
        const pts = breakdown(P[ev.t]).score;
        if (ev.t !== ev.p) {
          if (pts >= 40) award(ev.p, 'ice');
          moment(pts * 1.1, `🧊 ${nm(ev.p)} chilled ${nm(ev.t)} at ${pts}`);
        }
        break;
      }
      case 'rushDone':
        if (P[ev.p].status === 'active') award(ev.p, 'survivor');
        break;
      case 'stay':
        if (!ev.forced && numsOf(P[ev.p]) === 6) {
          award(ev.p, 'nerves');
          moment(45, `😎 ${nm(ev.p)} walked away holding 6 numbers`);
        }
        break;
      case 'roundEnd': {
        const x = X(), rows = ev.summary.rows;
        const best = rows.slice().sort((a, b) => b.score - a.score)[0];
        if (best.score > 0) {
          moment(best.score * 0.9, `💰 ${nm(best.i)} banked ${best.score}`);
          if (rows.filter((r) => r.score === best.score).length === 1 && best.nums.includes(0)) award(best.i, 'zero');
        }
        rows.forEach((r) => { if (r.score >= 60) award(r.i, 'bigbank'); });
        const lead = Math.max(...rows.map((r) => r.after));
        rows.forEach((r) => { x.maxDef[r.i] = Math.max(x.maxDef[r.i] || 0, lead - r.after); });
        if (s.phase === 'over' && (x.maxDef[s.winner] || 0) >= 50) award(s.winner, 'comeback');
        break;
      }
    }
  }

  // Where a player's cards live on screen: their row in table view, else their score chip.
  const playerEl = (i) => $(`#seats .seat[data-i="${i}"] .seat-cards`) || $(`#rail .chip[data-i="${i}"]`);

  // Deal animation: the revealed card shrinks into that player's spot.
  function flyToChip(card, i) {
    const from = $('#reveal .flipper');
    const chip = playerEl(i);
    if (!from || !chip) { hideReveal(true); return; }
    const a = from.getBoundingClientRect(), b = chip.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.innerHTML = cardHTML(card);
    const el = wrap.firstChild;
    el.classList.add('flycard');
    Object.assign(el.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px' });
    document.body.appendChild(el);
    hideReveal(false);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.25) rotate(-8deg)`, opacity: 0.6 }], { duration: 340, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    anim.onfinish = () => {
      el.remove();
      const c = playerEl(i);
      if (c) c.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    };
    // onfinish can be skipped if the page is backgrounded mid-animation; never leave the card behind.
    setTimeout(() => el.remove(), 700);
  }

  function flash(kind) {
    const t = $('#table');
    t.classList.remove('flashred', 'flashlock', 'flashgold'); void t.offsetWidth;
    t.classList.add('flash' + kind);
    setTimeout(() => t.classList.remove('flash' + kind), 650);
  }
  function stamp(text, kind, sub, player) {
    const el = $('#stamp');
    el.className = ''; void el.offsetWidth;
    const seat = player != null && $(`#seats .seat[data-i="${player}"]`);
    if (seat) { const r = seat.getBoundingClientRect(); el.style.top = r.top + r.height / 2 + 'px'; }
    else el.style.top = '';
    el.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    el.className = 'show ' + kind;
  }
  let toastTimer = null;
  function toast(msg, ms = 1800) {
    const el = $('#toast');
    el.innerHTML = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // Safety net: if the game's own code ever breaks, say so and offer a reload instead of leaving a
  // frozen screen. Games are saved after every move, so a reload picks up right where it left off.
  let crashShown = false;
  function crashed(where) {
    if (crashShown || !/\/(app|engine|net)\.js/.test(String(where || ''))) return;
    crashShown = true;
    const el = document.createElement('div');
    el.id = 'crashNote';
    el.innerHTML = '<span>Something went wrong on this screen.<small>Your game is saved.</small></span><button class="btn pink" type="button">Reload</button>';
    el.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(el);
  }
  window.addEventListener('error', (e) => crashed(e.filename || (e.error && e.error.stack)));
  window.addEventListener('unhandledrejection', (e) => crashed(e.reason && e.reason.stack));
  function banner(title, sub, color) {
    const el = $('#banner');
    el.style.setProperty('--pc', color);
    el.innerHTML = `<div class="inner"><small>${esc(sub)}</small><b>${esc(title)}</b></div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  let revealToken = 0;
  function shake() {
    const el = $('#stage');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
  }
  function showReveal(card, tense) {
    const el = $('#reveal');
    revealToken++;
    el.className = tense ? 'tense' : '';
    el.innerHTML = `<div class="flipper">${cardHTML(card)}<div class="card back"></div></div>`;
  }
  function hideReveal(animate) {
    const el = $('#reveal');
    if (!el.innerHTML) return;
    const tok = ++revealToken;
    if (!animate) { el.innerHTML = ''; return; }
    el.classList.add('out');
    setTimeout(() => { if (tok === revealToken) { el.innerHTML = ''; el.className = ''; } }, 300);
  }

  // Reshuffle, right on the table: the discards appear in the middle, turn face down, get
  // riffled, then fly into the Flip button, which fills back up as its card count climbs.
  async function shuffleAnim(snap) {
    const total = snap && snap.deck ? snap.deck.length : 0;
    const pool = snap && snap.deck ? snap.deck.filter((c) => c && c.kind) : [];
    const face = (k) => cardHTML(pool.length ? pool[(k * 7) % pool.length] : { kind: 'num', value: 1 + ((k * 5) % 12) });
    const stage = ($('#stage') || document.body).getBoundingClientRect();
    const flip = $('#btnFlip');
    const fb = flip.getBoundingClientRect();
    const cx = stage.left + stage.width / 2, cy = stage.top + stage.height * 0.42;
    const W = Math.min(76, stage.width * 0.2), H = W * 1.4;
    const n = 8, dur = 1500;

    const box = document.createElement('div');
    box.className = 'shufflefx';
    box.style.left = cx - W / 2 + 'px';
    box.style.top = cy - H / 2 + 'px';
    box.style.width = W + 'px';
    box.innerHTML = `<div class="sf-label">Shuffling the discards…</div>`
      + Array.from({ length: n }, (_, k) => `<div class="sf-card">${face(k)}<div class="card back"></div></div>`).join('');
    document.body.appendChild(box);
    const label = box.querySelector('.sf-label');
    label.animate([{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 250, fill: 'both' });

    // 1) discards fan in face up, 2) turn face down, 3) riffle twice.
    const cards = [...box.querySelectorAll('.sf-card')];
    cards.forEach((c, k) => {
      const side = k % 2 ? 1 : -1;
      const y = -k * 1.5;
      const fan = (k - (n - 1) / 2) * 13;
      c.animate([
        { transform: `translate(${fan}px, 30px) rotate(${fan / 2}deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${fan}px, 0) rotate(${fan / 2}deg)`, opacity: 1, offset: 0.16 },
        { transform: `translate(${fan}px, 0) rotate(${fan / 2}deg)`, offset: 0.3 },
        { transform: `translate(0, ${y}px)`, offset: 0.42 },
        { transform: `translate(${side * W * 0.62}px, ${y}px) rotate(${side * 8}deg)`, offset: 0.56 },
        { transform: `translate(0, ${y}px)`, offset: 0.7 },
        { transform: `translate(${side * W * 0.62}px, ${y}px) rotate(${side * 8}deg)`, offset: 0.84 },
        { transform: `translate(0, ${y}px)`, offset: 1 },
      ], { duration: dur, delay: k * 20, easing: 'ease-in-out', fill: 'both' });
      c.lastElementChild.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], { duration: dur, delay: k * 20, fill: 'both' });
    });
    await sleep(dur + 160);

    // 4) the new deck drops into the Flip button, which refills with a sweep and a counting number.
    label.textContent = 'Cards shuffled!';
    const dx = fb.left + fb.width / 2 - cx, dy = fb.top + fb.height / 2 - cy;
    cards.forEach((c, k) => {
      c.animate([
        { transform: `translate(0, ${-k * 1.5}px)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.2 },
      ], { duration: 520, delay: k * 45, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'both' });
    });
    await sleep(380);
    flip.classList.add('refilling');
    const fill = document.createElement('i');
    fill.className = 'refill';
    flip.prepend(fill);
    const fillDur = 800;
    fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: fillDur, easing: 'cubic-bezier(.3, .7, .3, 1)', fill: 'forwards' });
    const count = $('#deckCount');
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / fillDur);
        const v = Math.round(total * (1 - Math.pow(1 - k, 2)));
        count.textContent = `${v} card${v === 1 ? '' : 's'} left`;
        if (k < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
      setTimeout(resolve, fillDur + 400); // never hang if frames are paused (backgrounded tab)
    });
    flip.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
    box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    fill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
    await sleep(420);
    box.remove();
    fill.remove();
    flip.classList.remove('refilling');
  }

  // Bust: split the (already swollen, glowing) revealed card along a jagged crack. The halves ease
  // apart, tilt and sink while fading — one smooth motion, no snap.
  function shatterReveal() {
    const face = $('#reveal .flipper > .card:not(.back)');
    if (!face) return;
    const a = face.getBoundingClientRect();
    const crack = '55% 0, 42% 28%, 60% 50%, 41% 74%, 52% 100%';
    const halves = [
      { clip: `polygon(0 0, ${crack}, 0 100%)`, mid: 'translate(-8px, 2px) rotate(-3deg)', to: 'translate(-38px, 70px) rotate(-14deg)' },
      { clip: `polygon(${crack}, 100% 100%, 100% 0)`, mid: 'translate(8px, 3px) rotate(3deg)', to: 'translate(38px, 82px) rotate(15deg)' },
    ];
    halves.forEach((h) => {
      const el = face.cloneNode(true);
      el.classList.add('shard');
      Object.assign(el.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', clipPath: h.clip, webkitClipPath: h.clip });
      document.body.appendChild(el);
      el.animate([
        { transform: 'none', opacity: 1 },
        { transform: h.mid, opacity: 1, offset: 0.3 },
        { transform: h.to, opacity: 0 },
      ], { duration: 900, easing: 'cubic-bezier(.3, .6, .35, 1)', fill: 'forwards' });
      setTimeout(() => el.remove(), 950);
    });
    hideReveal(false);
  }

  // ---------------- rendering ----------------
  function statusTag(p) {
    if (p.status === 'sitout') return '<span class="tag-s sitout">SITTING OUT</span>';
    if (p.status === 'busted') return '<span class="tag-s bust">BUST</span>';
    if (p.sweep) return '<span class="tag-s closed">SWEEP</span>';
    if (p.status === 'locked') return '<span class="tag-s locked">CHILLED</span>';
    if (p.status === 'stayed') return '<span class="tag-s closed">CLOSED</span>';
    if (p.skipUsed) return '<span class="tag-s skip">SKIPPED</span>';
    return '';
  }

  function render(s, focus, newId) {
    $('#roundLbl').textContent = `Round ${s.round}`;
    $('#targetLbl').textContent = `to ${s.target}`;
    $('#deckCount').textContent = `${s.deck.length} card${s.deck.length === 1 ? '' : 's'} left`;
    const turnP = s.awaiting && s.awaiting.type === 'decide' ? s.awaiting.p : null;
    // Whose turn to show: the player deciding now, or (during animations) the last player to get a turn.
    const cur = turnP != null ? turnP : s.phase === 'play' ? lastTurnP : null;
    const tp = $('#turnPill');
    tp.classList.toggle('hidden', cur == null);
    if (cur != null) { tp.textContent = mode !== 'local' && cur === mySeat ? 'Your turn' : `${s.players[cur].name}'s turn`; tp.style.setProperty('--pc', pc(cur)); }

    // score rail
    $('#rail').innerHTML = s.players.map((p, i) => {
      const b = breakdown(p);
      const cls = ['chip'];
      if (i === cur) cls.push('turn');
      if (i === focus) cls.push('focus');
      if (p.status !== 'active') cls.push('out', p.status);
      if (p.sweep) cls.push('sweep');
      const live = s.phase === 'play' && (p.status !== 'busted' || b.score > 0) && (p.cards.length || p.status !== 'active') ? `<span class="plus">+${b.score}</span>` : '';
      return `<button class="chip ${cls.join(' ')}" data-i="${i}" style="--pc:${pc(i)}">${i === s.dealer ? '<span class="dealer">Dealer</span>' : ''}
        <div class="nm">${esc(p.name)}</div><div class="tot">${p.total}</div>
        <div class="rd">${live}${statusTag(p)}${p.shields.length && p.status === 'active' ? `<span class="tag-s sc">♥${p.shields.length > 1 ? p.shields.length : ''}</span>` : ''}</div>
        <div class="bar"><i style="width:${Math.min(100, (p.total / s.target) * 100)}%"></i></div></button>`;
    }).join('');

    // 2-3 players: everyone's hand on one screen. More: score rail plus the focused hand.
    const railMode = s.players.length > SEAT_MAX;
    $('#table').classList.toggle('railmode', railMode);
    renderSeats(s, focus, cur, newId, railMode ? [focus] : null);
    $('#seats').classList.toggle('hasturn', cur != null);
    const fp = s.players[focus];
    setHeat(numsOf(fp), fp.status === 'active' && s.phase === 'play' && isMine(focus));

    // controls
    const ctr = $('#controls');
    const canAct = !busy && turnP != null && isMine(turnP) && !pendingAct && !(mode !== 'local' && rejoining[turnP]) && (mode !== 'guest' || Net.connected);
    ctr.classList.toggle('locked', !canAct);
    ctr.classList.toggle('watching', mode !== 'local' && !(turnP != null && isMine(turnP)));
    $('#btnFlip').classList.toggle('nudge', canAct);
    const skipOk = canAct && game && game.canSkip(turnP);
    $('#btnSkip').classList.toggle('off', !skipOk);
    // The label describes the player whose turn it is, not whether the button is tappable at this
    // instant (it's briefly locked during every animation), so it doesn't flicker.
    const sp = cur != null ? s.players[cur] : null;
    const lastIn = sp && sp.status === 'active' && s.players.filter((p) => p.status === 'active').length <= 1;
    $('#skipSub').textContent = sp && sp.skipUsed ? 'used' : lastIn ? 'last one in' : '1 per round';
  }

  const bustCardHTML = (p, newId) => cardHTML(p.bust, p.bust.id === newId ? 'new' : '').replace(/<\/div>$/, '<div class="xmark">✕</div></div>');

  // Size hand cards to the screen (not the hand): pick the slot layout (2, 3, 4, 5 or 7 per row)
  // that gives the biggest number cards while leaving room for a full bonus/action row of 7.
  // Sizes depend only on the screen, so cards never change size during a round.
  function layoutSeats() {
    // Size for the tightest hand so every hand fits.
    const bodies = [...document.querySelectorAll('#seats .seat-body')];
    if (!bodies.length) return;
    const W = Math.min(...bodies.map((b) => b.clientWidth));
    const H = Math.min(...bodies.map((b) => b.clientHeight));
    const g = 6, rowGap = 6;
    let best = null;
    for (const cols of [2, 3, 4, 5, 7]) {
      const rows = Math.ceil(7 / cols);
      const byWidth = (W - (cols - 1) * g) / cols;
      // Reserve a bonus/action row at least ~55% of a number card's size; all 7 must fit across.
      const byHeight = (H - rowGap - (rows - 1) * g) / (1.4 * (rows + 0.55));
      const cw = Math.floor(Math.min(byWidth, byHeight, 110));
      if (!best || cw > best.cw) best = { cols, cw, rows };
    }
    // Bonus/action cards then take whatever height is left, as long as all 7 still fit across.
    const numsH = best.rows * best.cw * 1.4 + (best.rows - 1) * g;
    const xw = Math.floor(Math.min((W - 6 * g) / 7, (H - rowGap - numsH) / 1.4, best.cw));
    const seats = $('#seats');
    seats.style.setProperty('--cols', best.cols);
    seats.style.setProperty('--cw', best.cw + 'px');
    seats.style.setProperty('--xw', xw + 'px');
  }

  // only: player indexes to show (rail mode shows just the focused hand), or null for everyone.
  function renderSeats(s, focus, turnP, newId, only) {
    // Each hand: name/score row, number slots, then a bonus/action row with room for all 7.
    $('#seats').classList.toggle('four', s.players.length === 4);
    const html = s.players.map((p, i) => {
      if (only && !only.includes(i)) return '';
      const b = breakdown(p);
      const nums = p.cards.filter((c) => c.kind === 'num');
      const cls = ['seat'];
      if (i === turnP) cls.push('turn'); else if (i === focus) cls.push('focus');
      const online = mode !== 'local';
      if (online && i === mySeat) cls.push('me');
      if (p.status !== 'active') cls.push('out', p.status);
      let row = nums.map((c) => cardHTML(c, c.id === newId ? 'new' : '')).join('');
      let used = nums.length;
      if (p.bust) { row += bustCardHTML(p, newId); used++; }
      for (let k = used; k < 7; k++) row += '<div class="slot"></div>';
      const extras = p.cards.filter((c) => c.kind !== 'num');
      extras.push(...p.shields);
      const extrasHTML = extras.map((c) => cardHTML(c, c.id === newId ? 'new' : '')).join('');
      const tag = (i === turnP ? `<span class="tag-s turn">${isMine(i) ? 'YOUR TURN' : 'TURN'}</span>` : statusTag(p))
        + (online && i === mySeat ? '<span class="tag-s you">You</span>' : '')
        + (online && presence[i] === false && p.status !== 'sitout'
          ? (awayMs(i) != null && awayMs(i) < BOT_AFTER_MS ? '<span class="tag-s away">Away</span>' : '<span class="tag-s bot">BOT</span>') : '')
        + (online && rejoining[i] ? '<span class="tag-s rejoin">Rejoining</span>' : '');
      return `<div class="${cls.join(' ')}" data-i="${i}" style="--pc:${pc(i)}">
        <div class="seat-head">
          <div class="seat-name"><span class="nm">${esc(p.name)}</span>${tag}${i === s.dealer ? '<span class="tag-s dealer">Dealer</span>' : ''}</div>
          <div class="seat-score"><span class="seat-rd">+${b.score} <small>this round</small></span><span class="seat-tot">${p.total}</span></div>
        </div>
        <div class="seat-body">
          <div class="seat-cards">${row}</div>
          <div class="seat-extras">${extrasHTML || '<span class="xhint">Bonus &amp; action cards</span>'}</div>
        </div>
      </div>`;
    }).join('');
    // Update hands in place when the same players are showing, so the turn highlight, dimming
    // and colors animate between players instead of snapping.
    const box = $('#seats');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const next = [...tmp.children];
    const cur = [...box.children];
    if (cur.length === next.length && cur.every((el, k) => el.dataset.i === next[k].dataset.i)) {
      cur.forEach((el, k) => {
        if (el.className !== next[k].className) el.className = next[k].className;
        if (el.innerHTML !== next[k].innerHTML) el.innerHTML = next[k].innerHTML;
      });
    } else {
      box.replaceChildren(...next);
    }
    layoutSeats();
  }

  // ---------------- sound and buzz ----------------
  // Short sounds made on the fly (no audio files to download) and a light buzz on phones that
  // support it. The speaker button on the table turns both off; this phone remembers the choice.
  const sfx = (() => {
    // Soft, soothing sounds: rounded tones with slow fades (nothing clicks or snaps), notes from a
    // five-note scale so everything sounds good together, the harsh top end filtered off, and a
    // touch of warm echo. Even the bad moments (a bust) are a gentle low "whoomp", not a buzz.
    let ctx = null;
    let out = null; // everything plays through here: soft filter + gentle echo
    let dry = null; // clean path with no echo, for single tones that shouldn't repeat
    const on = () => prefs.sound !== false;
    const SCALE = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // G A C D E G A C
    function ac() {
      try {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const master = ctx.createGain();
          master.gain.value = 0.55;
          const soft = ctx.createBiquadFilter();
          soft.type = 'lowpass';
          soft.frequency.value = 3200;
          soft.Q.value = 0.5;
          const echo = ctx.createDelay(1);
          echo.delayTime.value = 0.19;
          const fb = ctx.createGain();
          fb.gain.value = 0.22;
          const wet = ctx.createGain();
          wet.gain.value = 0.16;
          const echoSoft = ctx.createBiquadFilter();
          echoSoft.type = 'lowpass';
          echoSoft.frequency.value = 1800;
          master.connect(soft).connect(ctx.destination);
          soft.connect(echo);
          echo.connect(echoSoft).connect(fb).connect(echo);
          echoSoft.connect(wet).connect(ctx.destination);
          out = master;
          dry = ctx.createGain();
          dry.gain.value = 0.55;
          const drySoft = ctx.createBiquadFilter();
          drySoft.type = 'lowpass';
          drySoft.frequency.value = 3200;
          dry.connect(drySoft).connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { ctx = null; }
      return ctx;
    }
    document.addEventListener('pointerdown', () => { if (on()) ac(); }, { passive: true });
    // A rounded tone: a slow-ish fade in, a long gentle fade out, and an optional soft overtone
    // (bell) or a gentle pitch glide.
    function tone(freq, dur = 0.35, o = {}) {
      const c = ctx;
      if (!c) return;
      const at = c.currentTime + (o.at || 0);
      const vol = o.vol || 0.1;
      const attack = o.attack || 0.025;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      g.connect(o.dry ? dry : out);
      const parts = o.bell ? [[1, 1], [2, 0.18], [3, 0.05]] : [[1, 1]];
      for (const [mult, level] of parts) {
        const osc = c.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq * mult, at);
        if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * mult * o.glide), at + dur);
        const pg = c.createGain();
        pg.gain.value = level;
        if (o.trem) {
          // A soft tremble: the volume sways gently a few times a second.
          const lfo = c.createOscillator();
          lfo.frequency.value = o.trem;
          const depth = c.createGain();
          depth.gain.value = level * 0.35;
          lfo.connect(depth).connect(pg.gain);
          lfo.start(at);
          lfo.stop(at + dur + 0.05);
        }
        osc.connect(pg).connect(g);
        osc.start(at);
        osc.stop(at + dur + 0.05);
      }
    }
    // A soft breath of air (card sliding, shuffling): quiet, filtered, with gentle edges.
    function air(dur = 0.12, o = {}) {
      const c = ctx;
      if (!c) return;
      const at = c.currentTime + (o.at || 0);
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = o.freq || 1400;
      f.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.05, at + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(at);
      src.stop(at + dur + 0.02);
    }
    const play = (fn) => { if (!on() || !ac()) return; try { fn(); } catch (e) { /* no sound */ } };
    const buzz = (pattern) => {
      if (!on() || !navigator.vibrate || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return;
      try { navigator.vibrate(pattern); } catch (e) { /* no buzz */ }
    };
    // A little run of notes from the scale, each ringing softly into the next.
    const run = (steps, o = {}) => steps.forEach((k, i) => tone(SCALE[k] * (o.oct || 1), o.dur || 0.6, { vol: o.vol || 0.08, at: i * (o.gap || 0.11), bell: true, attack: 0.02 }));
    return {
      // "Rise into it": as the card turns, a soft note five steps below the landing note that's
      // about to play, so the flip always leads up into it. n = the number the card will be
      // in the hand (0 for bonus and action cards).
      flip: (n) => play(() => tone((n ? SCALE[Math.min(n, 8) - 1] : SCALE[6]) * 2 / 3, 0.22, { vol: 0.05, attack: 0.03, dry: true })),
      // Each new number is the next note up the scale, so a growing hand climbs gently.
      place: (n) => play(() => tone(SCALE[Math.max(0, Math.min(n, 8) - 1)], 0.45, { vol: 0.1, dry: true })),
      bonus: () => play(() => tone(SCALE[6], 0.45, { vol: 0.075, dry: true })),
      // "Held breath": a warm, softly trembling chord (G and D) that swells in while the card turns.
      tense: () => {
        play(() => {
          tone(392, 1.2, { vol: 0.07, attack: 0.45, trem: 6 });
          tone(587.33, 1.2, { vol: 0.05, attack: 0.5, trem: 6 });
        });
        buzz([20, 180, 20]);
      },
      bust: () => { play(() => { tone(220, 0.7, { vol: 0.09, glide: 0.5, attack: 0.03 }); tone(165, 0.8, { vol: 0.06, glide: 0.5, attack: 0.05, at: 0.05 }); }); buzz([60, 80, 90]); },
      saved: () => { play(() => run([3, 5, 7], { vol: 0.07, gap: 0.1, dur: 0.8 })); buzz([30, 40, 30]); },
      sweep: () => { play(() => run([0, 2, 4, 5, 7], { vol: 0.08, gap: 0.12, dur: 1.1 })); buzz([40, 60, 40, 60, 90]); },
      bank: () => play(() => run([2, 4], { vol: 0.065, gap: 0.09, dur: 0.7 })),
      chill: () => play(() => run([7, 5, 6], { vol: 0.045, gap: 0.09, dur: 0.9, oct: 1 })),
      hat: () => play(() => [0, 1, 2].forEach((k) => tone(SCALE[2 + k * 2], 0.35, { vol: 0.06, at: k * 0.13, bell: true }))),
      shuffle: () => play(() => { for (let k = 0; k < 6; k++) air(0.12, { vol: 0.03, at: k * 0.09, freq: 1200 + k * 120 }); }),
      turn: () => { play(() => tone(SCALE[4], 0.45, { vol: 0.05, bell: true })); buzz(20); },
      win: () => { play(() => { run([0, 2, 4, 7], { vol: 0.08, gap: 0.16, dur: 1.4 }); tone(SCALE[0] / 2, 1.6, { vol: 0.05, at: 0.48, attack: 0.1 }); }); buzz([50, 70, 50, 70, 120]); },
      join: () => { play(() => run([2, 4, 5], { vol: 0.06, gap: 0.12, dur: 0.8 })); buzz([40, 50, 40]); },
    };
  })();
  function paintSound() {
    const b = $('#btnSound');
    if (!b) return;
    const off = prefs.sound === false;
    b.classList.toggle('muted', off);
    b.setAttribute('aria-label', off ? 'Sound is off. Tap to turn it on' : 'Sound is on. Tap to mute');
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor" stroke-width="1.6"/>${off
      ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>' : '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.3 6.5a7.5 7.5 0 0 1 0 11"/>'}</svg>`;
  }

  // ---------------- first-game tips ----------------
  // The first time someone plays on this phone, short tips pop up at the right moments, once each.
  // The phone remembers, so they never show again (How to play can bring them back).
  const TIPS = {
    flip: 'Tap <b>Flip</b> to draw a card. Every new number adds to your score.',
    dup: 'Careful: flip a number you <b>already have</b> and you bust, losing this round\'s numbers.',
    close: 'Happy with your points? Tap <b>Close</b> to bank them and sit out the rest of the round.',
    action: 'Action card! <b>Chill</b> banks someone\'s points and stops their round. <b>Hat Trick</b> makes them take 3 cards. A <b>Lifeline</b> saves you from one bust.',
  };
  let tipShown = null;
  function tip(key, anchor) {
    prefs.tips = prefs.tips || {};
    if (prefs.tipsOff || prefs.tips[key] || tipShown) return;
    prefs.tips[key] = true;
    store.set(PREFS, prefs);
    const el = $('#tip');
    tipShown = key;
    el.innerHTML = `<div class="tip-txt">${TIPS[key]}</div><div class="tip-btns"><button type="button" class="tip-ok">Got it</button><button type="button" class="tip-skip">Skip tips</button></div>`;
    const r = anchor ? anchor.getBoundingClientRect() : null;
    el.style.top = '';
    el.style.bottom = r ? `${Math.max(12, window.innerHeight - r.top + 10)}px` : '';
    el.classList.toggle('mid', !r);
    el.classList.add('show');
    const done = () => { el.classList.remove('show'); tipShown = null; };
    el.querySelector('.tip-ok').onclick = done;
    el.querySelector('.tip-skip').onclick = () => { prefs.tipsOff = true; store.set(PREFS, prefs); done(); };
    clearTimeout(tip.timer);
    tip.timer = setTimeout(done, 9000);
  }
  const hideTip = () => { if (tipShown) { $('#tip').classList.remove('show'); tipShown = null; } };

  // ---------------- event playback ----------------
  async function play(ev) {
    const s = ev.snap;
    const name = (i) => esc(s.players[i].name);
    const nm = (i) => `<b style="color:${pc(i)}">${name(i)}</b>`;
    react(ev);
    switch (ev.type) {
      case 'roundStart': {
        hideReveal(false);
        lastTurnP = null;
        focusP = (ev.dealer + 1) % s.players.length;
        render(s, focusP);
        banner(`Round ${ev.round}`, `${s.players[ev.dealer].name} deals`, '#1677c9');
        await sleep(750);
        break;
      }
      case 'reshuffle':
        sfx.shuffle();
        await shuffleAnim(s);
        break;
      case 'turn':
        render(s, ev.p);
        focusP = ev.p;
        if (ev.p !== lastTurnP) {
          if (mode === 'local' || ev.p === mySeat) sfx.turn();
          if (mode === 'local') banner(s.players[ev.p].name, 'Your turn', pc(ev.p));
          else if (ev.p === mySeat) banner('Your turn', s.players[ev.p].name, pc(ev.p));
          else banner(s.players[ev.p].name, 'is up', pc(ev.p));
          await sleep(260);
        }
        lastTurnP = ev.p;
        break;
      case 'draw': {
        focusP = ev.p;
        dealing = ev.deal;
        render(s, ev.p);
        // Flipping while holding 5 or 6 numbers: slow it down and let the heart pound.
        const tense = !ev.deal && numsOf(s.players[ev.p]) >= 5;
        showReveal(ev.card, tense);
        if (tense) sfx.tense();
        else sfx.flip(ev.card.kind === 'num' ? numsOf(s.players[ev.p]) + 1 : 0);
        await sleep(ev.deal ? 360 : tense ? 1150 : 440);
        break;
      }
      case 'place':
        if (dealing) flyToChip(ev.card, ev.p); else hideReveal(true);
        render(s, ev.p, ev.card.id);
        if (ev.card.kind === 'num') sfx.place(numsOf(s.players[ev.p])); else sfx.bonus();
        if (ev.card.kind === 'shield') toast(`${nm(ev.p)} is holding a Lifeline`);
        await sleep(ev.card.kind === 'num' ? 180 : 320);
        break;
      case 'bust': {
        // The duplicate swells and glows red, then splits and the halves drift apart; the hand
        // pulses red under a BUST stamp.
        $('#reveal').classList.add('busting');
        flash('red');
        sfx.bust();
        shake();
        await sleep(340);
        shatterReveal();
        render(s, ev.p, ev.card.id);
        const seat = $(`#seats .seat[data-i="${ev.p}"]`);
        if (seat) seat.classList.add('busting');
        stamp('BUST!', 'bust', `Another ${ev.card.value}`, ev.p);
        await sleep(850);
        break;
      }
      case 'saved':
        stamp('SAVED!', 'saved', 'Lifeline used up', ev.p);
        toast(`A Lifeline saved ${nm(ev.p)}`);
        flash('gold');
        sfx.saved();
        fx.burst(70, 0.45, ['#ffd23f', '#ffb020', '#fff4c2', '#fff']);
        await sleep(500);
        hideReveal(true);
        render(s, ev.p);
        await sleep(450);
        break;
      case 'sweep':
        hideReveal(true);
        render(s, ev.p, ev.card.id);
        stamp('CLEAN SWEEP!', 'sweep', '+15 bonus', ev.p);
        flash('gold'); fx.burst(200);
        sfx.sweep();
        await sleep(1700);
        break;
      case 'setAside':
        toast(`${ACTION_NAME[ev.card.kind]} waits until these 3 cards are done`);
        await sleep(550);
        hideReveal(true);
        await sleep(180);
        break;
      case 'chooseTarget':
        // The picker that follows says once, clearly, who drew the card.
        await sleep(450);
        tip('action', null);
        hideReveal(true);
        await sleep(160);
        break;
      case 'lock': {
        hideReveal(true);
        focusP = ev.t;
        render(s, ev.t);
        stamp('CHILLED', 'lock', null, ev.t);
        flash('ice');
        sfx.chill();
        const pts = breakdown(s.players[ev.t]).score;
        toast(ev.auto && ev.t === ev.p
          ? `${nm(ev.t)} is the only one left and has to take it. Chilled with ${pts}`
          : ev.t === ev.p ? `${nm(ev.t)} chilled themselves with ${pts}` : `${nm(ev.p)} chilled ${nm(ev.t)}, who keeps ${pts}`, 2400);
        await sleep(1050);
        break;
      }
      case 'rush':
        hideReveal(true);
        focusP = ev.t;
        render(s, ev.t);
        stamp('HAT TRICK!', 'rush', '3 cards in a row', ev.t);
        sfx.hat();
        toast(ev.auto && ev.t === ev.p
          ? `${nm(ev.t)} is the only one left and has to take 3 cards!`
          : ev.t === ev.p ? `${nm(ev.t)} takes the Hat Trick: 3 cards in a row!` : `${nm(ev.p)} makes ${nm(ev.t)} take 3 cards!`, 2200);
        await sleep(1000);
        break;
      case 'rushDone':
        await sleep(100);
        break;
      case 'giveShield':
        hideReveal(true);
        render(s, ev.t, ev.card.id);
        toast(`${nm(ev.p)} already had one, so ${nm(ev.t)} gets the Lifeline`, 2200);
        await sleep(750);
        break;
      case 'discardAction':
        hideReveal(true);
        toast(ev.extra ? `${nm(ev.p)} already has a Lifeline, so the extra one is discarded` : `Nobody can take the ${ACTION_NAME[ev.card.kind]}, so it's discarded`);
        await sleep(700);
        break;
      case 'stay':
        render(s, ev.p);
        if (!ev.forced) sfx.bank();
        toast(ev.forced ? `Out of cards, so ${nm(ev.p)} closes` : `${nm(ev.p)} closes with <b>${breakdown(s.players[ev.p]).score}</b>`);
        await sleep(450);
        break;
      case 'skip':
        render(s, ev.p);
        toast(`${nm(ev.p)} skips this turn`);
        await sleep(400);
        break;
      case 'leave':
        render(s, focusP);
        await sleep(300);
        break;
      case 'roundEnd':
        hideReveal(false);
        render(s, focusP);
        await sleep(320);
        break;
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    heart.stop();
    waitNote('');
    $('#controls').classList.add('locked');
    try {
      while (game.events.length) {
        const ev = game.events.shift();
        // Off the table (went to the menu): skip the animation but still count badges/highlights.
        if ($('#table').classList.contains('active')) await play(ev); else react(ev);
      }
    } catch (e) { console.error(e); }
    busy = false;
    dealing = false;
    settle();
  }

  function settle() {
    const s = game.s;
    const a = s.awaiting;
    if (a && a.p != null) focusP = a.p;
    render(s, focusP);
    if (s.phase === 'over' && !X().recorded) { X().recorded = true; recordLastGame(s); }
    if (mode === 'local') store.set(SAVE, s); else if (mode === 'host') { saveHosted(); hostWatch(); }
    else if (mode === 'guest' && s.phase === 'over') store.del(ROOM); // finished: nothing left to rejoin
    // Left for the home screen while animations were finishing: keep the save, but don't pop
    // in-game sheets over the menu. Continue picks up from here.
    if (!$('#table').classList.contains('active')) { heart.stop(); return; }
    if (!a) return;
    const myMove = mode !== 'local' && a.p === mySeat && (a.type === 'decide' || a.type === 'target');
    if (myMove && document.hidden) nudge(true); else if (!myMove) nudge(false);
    if (a.type === 'decide' && isMine(a.p)) {
      const n = numsOf(s.players[a.p]);
      if (n >= 3) tip('close', $('#btnClose')); else if (n >= 2) tip('dup', $('#btnFlip')); else tip('flip', $('#btnFlip'));
      heart.set(n >= 6 ? 650 : n === 5 ? 900 : 0);
    } else heart.stop();
    waitNote('');
    if (a.type === 'target') {
      if (isMine(a.p) && !rejoining[a.p]) showTarget(a);
      else waitNote(`<b style="color:${pc(a.p)}">${esc(s.players[a.p].name)}</b> is choosing who gets the ${ACTION_NAME[a.action]}…`);
    }
    else if (a.type === 'summary' || a.type === 'over') showSummary();
    if (undo && undo.pending) {
      undo.pending = false;
      if (a.type === 'decide') {
        $('#undo').classList.remove('hidden');
        const bar = $('#undo i');
        bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
        undo.timer = setTimeout(clearUndo, 5000);
      }
    }
  }

  function clearUndo() {
    if (!undo) return;
    clearTimeout(undo.timer);
    undo = null;
    $('#undo').classList.add('hidden');
  }

  function doUndo() {
    if (!undo || busy) return;
    if (undo.online) { clearUndo(); closeModal(); act('undo'); return; }
    const snap = undo.snap;
    clearUndo();
    closeModal();
    game = Game.load(JSON.parse(snap));
    lastTurnP = game.s.awaiting.p;
    toast('Close undone. Still your turn');
    settle();
  }

  // ---------------- modals ----------------
  // cls: extra classes for the sheet (the action picker uses a full-screen style).
  // onDismiss: for sheets you can close without choosing (rules, menus, confirms). They get a
  // close button, closing by tapping outside, and swipe-down-to-close.
  let modalDismiss = null;
  function openModal(html, onBind, cls = '', onDismiss = null) {
    const m = $('#modal');
    modalDismiss = onDismiss;
    m.className = cls + (onDismiss ? ' dismissable' : '');
    m.style.transform = '';
    m.style.transition = '';
    m.innerHTML = (onDismiss ? '<div class="grab" aria-hidden="true"></div><button class="mclose" aria-label="Close">✕</button>' : '') + html;
    $('#modalWrap').classList.remove('hidden');
    m.scrollTop = 0;
    if (onDismiss) m.querySelector('.mclose').onclick = () => onDismiss();
    if (onBind) onBind(m);
  }
  function closeModal() { modalDismiss = null; $('#modalWrap').classList.add('hidden'); $('#modal').innerHTML = ''; $('#modal').className = ''; $('#modal').style.transform = ''; }
  const backToTable = () => { closeModal(); if (game && $('#table').classList.contains('active') && !busy) settle(); };

  // Tap outside a closable sheet, or drag it down from the top, to close it.
  $('#modalWrap').addEventListener('click', (e) => { if (e.target === $('#modalWrap') && modalDismiss) modalDismiss(); });
  (() => {
    const m = $('#modal');
    let drag = null;
    m.addEventListener('touchstart', (e) => {
      if (!modalDismiss || m.scrollTop > 0 || e.touches.length > 1) { drag = null; return; }
      drag = { y: e.touches[0].clientY, dy: 0 };
    }, { passive: true });
    m.addEventListener('touchmove', (e) => {
      if (!drag) return;
      drag.dy = e.touches[0].clientY - drag.y;
      if (drag.dy > 0 && m.scrollTop <= 0) {
        e.preventDefault();
        m.style.transition = 'none';
        m.style.transform = `translateY(${drag.dy}px)`;
      } else if (drag.dy < 0) { drag = null; m.style.transform = ''; }
    }, { passive: false });
    const end = () => {
      if (!drag) return;
      const dy = drag.dy;
      drag = null;
      m.style.transition = 'transform .22s ease';
      if (dy > 90 && modalDismiss) {
        m.style.transform = 'translateY(105%)';
        const fn = modalDismiss;
        setTimeout(() => fn(), 200);
      } else {
        m.style.transform = '';
      }
    };
    m.addEventListener('touchend', end);
    m.addEventListener('touchcancel', end);
  })();

  // Full-screen action picker: the card floats at the top, players fill the rest as big buttons.
  // Full-screen action picker. One clear line says who drew the card; each player row shows
  // their points this round and their game total.
  function showTarget(a) {
    const s = game.s;
    const who = mode !== 'local' && a.p === mySeat ? 'You' : esc(s.players[a.p].name);
    const how = {
      lock: "Choose who gets chilled. They keep this round's points and sit out the rest of the round.",
      rush: 'Choose who takes the next 3 cards, one at a time.',
      shield: 'You can only hold one Lifeline. Choose who gets this one.',
    }[a.action];
    const opts = a.options.map((i, k) => {
      const p = s.players[i]; const b = breakdown(p);
      const n = p.cards.filter((c) => c.kind === 'num').length;
      return `<button data-i="${i}" style="--pc:${pc(i)}; animation-delay:${0.12 + k * 0.06}s">
        <div class="pk-who"><div class="pn"><span class="pn-t">${esc(p.name)}</span>${i === a.p ? '<span class="you">YOU</span>' : ''}</div>
        <div class="pm">${n} number${n === 1 ? '' : 's'}${p.shields.length ? ` · ${p.shields.length} Lifeline${p.shields.length > 1 ? 's' : ''}` : ''}</div></div>
        <div class="pk-stat rd">+${b.score}</div><div class="pk-stat tot">${p.total}</div></button>`;
    }).join('');
    openModal(`<div class="pk-hero">
      <div class="pk-card">${cardHTML(a.card)}</div>
      <h2><span style="color:${pc(a.p)}">${who}</span> drew ${ACTION_NAME[a.action]}</h2><p>${how}</p></div>
      <div class="pk-cols"><span>Player</span><span>Round</span><span>Total</span></div>
      <div class="pick">${opts}</div>`, (m) => {
      m.querySelectorAll('.pick button').forEach((b) => b.addEventListener('click', () => {
        clearUndo();
        closeModal();
        act('target', +b.dataset.i);
      }));
    }, `picker ${a.action}`);
  }

  // The winner's brag card: a tall picture (fits phone screens and group chats) with a glowing
  // gradient, confetti, a fan of game cards, the winner's name, and a medal scoreboard.
  async function winCard(s) {
    // Taller for 3 or 4 players, so the scoreboard never runs into the footer.
    const W = 1080, H = 1350 + Math.max(0, s.players.length - 2) * 80;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    let seed = 7 + s.round * 31 + s.players.reduce((n, pl) => n + pl.total, 0);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    const win = s.players[s.winner];

    // Background: deep purple into pink into orange, with a warm glow behind the cards.
    const bg = g.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, '#2a0f5c'); bg.addColorStop(0.45, '#8b1fa8'); bg.addColorStop(0.78, '#ff3d81'); bg.addColorStop(1, '#ff8a3d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, 470, 20, W / 2, 470, 520);
    glow.addColorStop(0, 'rgba(255, 214, 90, .55)'); glow.addColorStop(0.5, 'rgba(255, 140, 90, .18)'); glow.addColorStop(1, 'rgba(255, 140, 90, 0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // Soft light spots.
    for (let k = 0; k < 16; k++) {
      const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 110;
      const spot = g.createRadialGradient(x, y, 0, x, y, r);
      spot.addColorStop(0, `rgba(255,255,255,${0.05 + rnd() * 0.08})`); spot.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = spot; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // Confetti.
    const conf = ['#ffd23f', '#3ddcff', '#a3e635', '#ff6b1a', '#ffffff', '#c084fc', '#ff8fb8'];
    for (let k = 0; k < 70; k++) {
      const x = rnd() * W, y = rnd() * 700, a = rnd() * Math.PI;
      g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = 0.55 + rnd() * 0.45;
      g.fillStyle = conf[k % conf.length];
      if (k % 3) g.fillRect(-9, -4, 18, 8); else { g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }

    // Logo and name.
    try {
      const icon = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'icons/icon-192.png'; });
      g.save(); rr(W / 2 - 52, 62, 104, 104, 26); g.clip(); g.drawImage(icon, W / 2 - 52, 62, 104, 104); g.restore();
    } catch (e) { /* no logo */ }
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = `800 40px ${font}`;
    if ('letterSpacing' in g) g.letterSpacing = '6px';
    g.fillText('STREAK OR BUST', W / 2, 222);
    if ('letterSpacing' in g) g.letterSpacing = '0px';

    // A fan of three game cards.
    const fan = [[7, -16, -150], [12, 0, 0], [3, 16, 150]];
    fan.forEach(([v, deg, dx]) => {
      g.save();
      g.translate(W / 2 + dx, 470 + Math.abs(dx) * 0.18);
      g.rotate((deg * Math.PI) / 180);
      g.shadowColor = 'rgba(30, 0, 60, .45)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
      g.fillStyle = '#fff'; rr(-95, -135, 190, 270, 26); g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = NUM_COLORS[v]; g.lineWidth = 6; rr(-80, -120, 160, 240, 18); g.stroke();
      g.fillStyle = NUM_COLORS[v]; g.font = `900 ${v >= 10 ? 112 : 130}px ${font}`; g.textBaseline = 'middle';
      g.fillText(String(v), 0, 8);
      g.restore();
    });
    g.textBaseline = 'alphabetic';

    // WINNER badge, the name, and the score.
    const badge = g.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0);
    badge.addColorStop(0, '#ffe27a'); badge.addColorStop(1, '#ffb020');
    g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 20; g.shadowOffsetY = 6;
    g.fillStyle = badge; rr(W / 2 - 130, 660, 260, 64, 32); g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#4a2400'; g.font = `900 34px ${font}`;
    if ('letterSpacing' in g) g.letterSpacing = '5px';
    g.fillText('🏆 WINNER', W / 2, 704);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.shadowColor = 'rgba(40, 0, 60, .5)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.fillStyle = '#fff'; g.font = `900 ${win.name.length > 10 ? 96 : 120}px ${font}`;
    g.fillText(win.name, W / 2, 840, W - 140);
    g.shadowColor = 'transparent';
    g.fillStyle = '#ffd23f'; g.font = `800 54px ${font}`;
    g.fillText(`${win.total} points`, W / 2, 912);

    // Scoreboard on frosted glass.
    const rows = s.players.map((pl, i) => ({ pl, i })).sort((a, b) => b.pl.total - a.pl.total);
    const rowH = 76, top = 960, boxH = rows.length * rowH + 28;
    g.fillStyle = 'rgba(255,255,255,.14)'; rr(150, top, W - 300, boxH, 30); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; rr(150, top, W - 300, boxH, 30); g.stroke();
    const medals = ['🥇', '🥈', '🥉', '🎖️'];
    rows.forEach(({ pl, i }, k) => {
      const y = top + 14 + k * rowH;
      if (i === s.winner) { g.fillStyle = 'rgba(255, 210, 63, .22)'; rr(164, y, W - 328, rowH - 8, 20); g.fill(); }
      const mid = y + (rowH - 8) / 2 + 13;
      g.textAlign = 'left'; g.font = `40px ${font}`; g.fillStyle = '#fff';
      g.fillText(medals[k] || '', 190, mid);
      g.font = `800 40px ${font}`; g.fillText(pl.name, 260, mid, 520);
      g.textAlign = 'right'; g.font = `900 42px ${font}`;
      g.fillText(String(pl.total), W - 190, mid);
    });

    // Footer: a challenge and the link.
    g.textAlign = 'center';
    g.fillStyle = '#fff'; g.font = `800 44px ${font}`;
    g.fillText(mode === 'local' ? 'Think you can beat that?' : 'Think you can beat me?', W / 2, H - 120);
    g.font = `700 32px ${font}`;
    const link = 'Play free at streakorbust.com';
    const lw = g.measureText(link).width + 64;
    g.fillStyle = '#fff'; rr(W / 2 - lw / 2, H - 92, lw, 58, 29); g.fill();
    g.fillStyle = '#7a1fa2'; g.fillText(link, W / 2, H - 52);

    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  async function shareWin(s) {
    const win = s.players[s.winner];
    const others = s.players.filter((_, i) => i !== s.winner).sort((a, b) => b.total - a.total);
    const vs = others.length === 1 ? ` ${win.total} to ${others[0].total}` : ` with ${win.total} points`;
    const text = mode === 'local'
      ? `${win.name} just won Streak or Bust${vs}! 🔥 Think you can beat that?`
      : `I just won Streak or Bust${vs}! 🔥 Think you can beat me?`;
    try {
      const blob = await winCard(s);
      const file = blob && new File([blob], 'streak-or-bust-win.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `${text} ${SITE_URL}` });
        return;
      }
      if (navigator.share) { await navigator.share({ title: 'Streak or Bust', text, url: SITE_URL }); return; }
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'streak-or-bust-win.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      try { await navigator.clipboard.writeText(`${text} ${SITE_URL}`); toast('Picture saved and message copied. Paste it to your friends!', 3200); } catch (e) { toast('Picture saved!', 2400); }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast("Couldn't share right now", 2400);
    }
  }

  function showSummary() {
    const s = game.s;
    const sum = s.summary;
    const over = s.phase === 'over';
    const rows = sum.rows.slice().sort((x, y) => y.after - x.after);
    const lead = rows[0].after;
    const rowsHTML = rows.map((r) => {
      const p = s.players[r.i];
      let detail;
      if (r.busted) detail = `Busted on another ${p.bust ? p.bust.value : ''}${r.mods.length ? ` · kept ${r.mods.map((m) => `+${m}`).join(' ')}` : ''}`;
      else if (!r.nums.length && !r.mods.length) detail = 'No cards';
      else detail = `${r.nums.join(' + ') || '0'}${r.x2 ? ' ×2' : ''}${r.mods.map((m) => ` + ${m}`).join('')}${r.bonus ? ' + 15 sweep' : ''}`;
      return `<div class="sumrow ${r.after === lead ? 'lead' : ''}" style="--pc:${pc(r.i)}">
        <div class="sn">${esc(p.name)} <span class="gain ${r.score ? '' : 'zero'}">+${r.score}</span></div>
        <div class="st" data-from="${r.before}" data-to="${r.after}">${r.before}</div>
        <div class="sb">${detail}</div>
        <div class="bar"><i data-w="${Math.min(100, (r.after / s.target) * 100)}"></i></div></div>`;
    }).join('');
    const x = X();
    const nextDealer = s.players[(s.dealer + 1) % s.players.length].name;

    // Lead change since last round
    const uniqueMax = (key) => {
      const m = Math.max(...sum.rows.map((r) => r[key]));
      const at = sum.rows.filter((r) => r[key] === m);
      return at.length === 1 && m > 0 ? at[0].i : -1;
    };
    const before = uniqueMax('before'), after = uniqueMax('after');
    const newLead = sum.round > 1 && after >= 0 && after !== before && !over
      ? `<span class="newlead">👑 New leader: ${esc(s.players[after].name)}</span>` : '';

    const top = (x.moments || []).slice().sort((a, b) => b.w - a.w)[0];
    const momentHTML = top ? `<div class="moment"><small>Moment of the round</small>${top.html}</div>` : '';

    let achHTML = '';
    if (over) {
      const rowsA = s.players.map((p, i) => ({ p, i, list: x.ach[i] || [] })).filter((r) => r.list.length);
      // One flowing row of chips, each with the player's name, so the final screen stays short.
      if (rowsA.length) achHTML = `<h3 style="margin:4px 0 8px">Badges earned</h3><div class="achflow">${rowsA.map((r) =>
        r.list.map((id) => `<span class="achchip" style="--pc:${pc(r.i)}"><b>${esc(r.p.name)}</b> ${ACH[id][0]} ${ACH[id][1]}</span>`).join('')).join('')}</div>`;
    }

    const head = over
      ? `<div class="winner" style="--pc:${pc(s.winner)}"><small>Winner</small><h2>${esc(s.players[s.winner].name)} wins!</h2><p>Final score ${s.players[s.winner].total} after ${sum.round} round${sum.round === 1 ? '' : 's'}</p></div>`
      : `<h2>Round ${sum.round} results</h2><p>First to ${s.target} wins. ${newLead}</p>`;
    // Once a round is over it's final: no undoing the close that ended it.
    clearUndo();
    let btns;
    if (!over) btns = `<button class="btn primary big" id="mNext">Next round<small>${esc(nextDealer)} deals</small></button>`;
    else if (mode === 'local') btns = `<button class="btn primary big" id="mRematch">Rematch</button><button class="btn ghost" id="mNew">New players</button>`;
    else if (mode === 'host') btns = `<button class="btn primary big" id="mRematch">Rematch</button><button class="btn ghost" id="mLeave">End room</button>`;
    else btns = `<button class="btn primary big" disabled>Waiting for a rematch…</button><button class="btn ghost" id="mLeave">Leave room</button>`;
    // Only the winner gets to brag: on a shared phone that's whoever won, online it's the winner's own phone.
    const canBrag = over && (mode === 'local' || s.winner === mySeat);
    if (canBrag) btns = '<button class="btn share-win" id="mShareWin">🏆 Share your win</button>' + btns;
    // The final screen fits on one phone screen: no "moment of the round", no per-round math.
    openModal(over ? `${head}<div class="sumrows final">${rowsHTML}</div>${achHTML}<div class="mbtns">${btns}</div>`
      : `${head}${momentHTML}<div class="sumrows">${rowsHTML}</div>${achHTML}<div class="mbtns">${btns}</div>`, (m) => {
      requestAnimationFrame(() => m.querySelectorAll('.bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }));
      countUp(m.querySelectorAll('.st'));
      if (over) { fx.burst(260, 0.3); setTimeout(() => fx.burst(180, 0.35), 700); sfx.win(); }
      const sw = m.querySelector('#mShareWin');
      if (sw) sw.addEventListener('click', () => shareWin(s));
      const nx = m.querySelector('#mNext');
      if (nx) nx.addEventListener('click', () => { clearUndo(); closeModal(); act('next'); });
      const rm = m.querySelector('#mRematch');
      if (rm) rm.addEventListener('click', () => { clearUndo(); closeModal(); if (mode === 'host') hostStart(); else startGame(s.players.map((p) => p.name), s.target); });
      const lv = m.querySelector('#mLeave');
      if (lv) lv.addEventListener('click', () => leaveRoom());
      const nw = m.querySelector('#mNew');
      if (nw) nw.addEventListener('click', () => { clearUndo(); closeModal(); store.del(SAVE); game = null; showSetup(); });
    }, (s.players.length >= 4 ? 'results many' : 'results') + (over ? ' final' : ''));
  }

  function countUp(els) {
    const t0 = performance.now();
    const dur = 900;
    function tick(t) {
      const k = Math.min(1, (t - t0 - 200) / dur);
      const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3);
      els.forEach((el) => { const a = +el.dataset.from, b = +el.dataset.to; el.textContent = Math.round(a + (b - a) * e); });
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const N = (v) => ({ kind: 'num', value: v });
  const RULES_HTML = `<h2>How to play</h2><div class="rules">
    <p class="lead">Flip cards, build your streak, and stop before you bust. Easy to learn, hard to put down.</p>
    <div class="basics">
      <p class="goal">🏆 First to <b>200 points</b> wins.<small> Or set your own target.</small></p>
      <ol class="steps3">
        <li><span class="n">1</span><span><b>Flip</b> a card on your turn. Every new number adds to your score.</span></li>
        <li><span class="n">2</span><span>Flip a number you <b>already have</b> and you <b>bust</b>. Your numbers for this round are gone.</span></li>
        <li><span class="n">3</span><span><b>Close</b> whenever you like to lock in your points for the round.</span></li>
      </ol>
      <div class="bust-ex">
        <div class="minis">${cardHTML(N(3))}${cardHTML(N(7))}${cardHTML(N(10))}<span class="plus">+</span>${cardHTML(N(7), 'bustcard')}</div>
        <p>You have 3, 7, and 10. Then another 7 shows up. Bust!</p>
      </div>
      <p class="trick">Every flip could be your best card or your last. How far will you push it?</p>
    </div>

    <h3>Scoring</h3>
    <div class="minis">${cardHTML(N(3))}${cardHTML(N(9))}${cardHTML({ kind: 'x2' })}${cardHTML({ kind: 'mod', value: 4 })}</div>
    <ul><li>Add up your numbers, double them with a <b>×2</b>, then add your <b>+</b> cards.</li>
      <li>This hand is worth (3 + 9) × 2 + 4 = <b>28</b>.</li>
      <li>Busted? You still keep your + cards.</li>
      <li>Get 7 different numbers for a <b>Clean Sweep</b>. The round ends right away, and you get <b>+15</b>.</li></ul>

    <h3>Action cards</h3>
    <div class="minis">${cardHTML({ kind: 'lock' })}${cardHTML({ kind: 'rush' })}${cardHTML({ kind: 'shield' })}</div>
    <ul><li><b>Chill</b>: pick anyone still in, even yourself. They keep their points and sit out the rest of the round.</li>
      <li><b>Hat Trick</b>: pick anyone still in. They have to flip 3 cards in a row.</li>
      <li><b>Lifeline</b>: keep it. It saves you from one bust. Collect as many as you can.</li>
      <li>Last one in? Chill and Hat Trick have to go to you.</li></ul>

    <h3>How a round goes</h3><ul>
      <li>Everyone starts with one card, then you take turns.</li>
      <li>The round ends when everyone has closed, busted, or been chilled.</li>
      <li>Once someone reaches the target, the highest score wins. Tied? Keep playing.</li></ul>

    <h3>Handy extras</h3><ul>
      <li><b>Skip</b>: pass your turn without flipping, once per round.</li>
      <li><b>Undo</b>: closed by mistake? You have 5 seconds to take it back.</li>
      <li>Out of cards? The discards get shuffled into a new deck.</li></ul>

    <h3>Playing online</h3><ul>
      <li><b>Lost your connection?</b> Everyone waits 15 seconds for you. After that, a bot plays your turns so the game keeps moving.</li>
      <li><b>Gone a full minute?</b> The bot finishes the round for you, then you sit out with your score frozen.</li>
      <li><b>Tap Rejoin</b> any time to jump back in on your next turn.</li>
      <li><b>Host dropped?</b> They get the same 15 seconds. Then the next player's phone takes over, and the game keeps going.</li>
      <li><b>Host leaving?</b> They can hand the game to the next player and everyone else keeps playing, or end it for everyone.</li>
      <li><b>Tapped Leave?</b> You're out right away, with no bot. Come back any time with the room code.</li>
      <li>It takes at least 2 players. If everyone else is out, the game pauses until someone's back.</li></ul>
  </div><div class="mbtns" style="margin-top:16px"><button class="btn primary" id="mOk">Got it</button><button class="btn ghost" id="mTipsAgain">Show the tips again in my next game</button></div>`;

  function showRules() {
    openModal(RULES_HTML, (m) => {
      m.querySelector('#mOk').addEventListener('click', backToTable);
      m.querySelector('#mTipsAgain').addEventListener('click', () => { prefs.tips = {}; prefs.tipsOff = false; store.set(PREFS, prefs); toast("You'll see the tips again in your next game"); backToTable(); });
    }, 'rules-sheet', backToTable);
  }

  function showMenu() {
    heart.stop();
    if (mode !== 'local') { showRoomMenu(); return; }
    openModal(`<h2>Menu</h2><div class="menu-list">
      <button class="btn ghost" id="mRules">How to play</button>
      <button class="btn ghost" id="mShare">Share this game</button>
      <button class="btn ghost" id="mHome">Main menu (game is saved)</button>
      <button class="btn ghost" id="mEnd" style="color:var(--bad)">End this game</button>
      <button class="btn primary" id="mBack">Back to the table</button></div>`, (m) => {
      m.querySelector('#mRules').onclick = showRules;
      m.querySelector('#mShare').onclick = shareApp;
      m.querySelector('#mHome').onclick = () => { closeModal(); showSetup(); };
      m.querySelector('#mEnd').onclick = () => {
        openModal(`<h2>End this game?</h2><p>Scores will be lost.</p><div class="mbtns"><button class="btn pink" id="mYes">End game</button><button class="btn ghost" id="mNo">Keep playing</button></div>`, (mm) => {
          mm.querySelector('#mYes').onclick = () => { store.del(SAVE); game = null; closeModal(); showSetup(); };
          mm.querySelector('#mNo').onclick = () => { closeModal(); settle(); };
        }, '', backToTable);
      };
      m.querySelector('#mBack').onclick = () => { closeModal(); settle(); };
    }, '', backToTable);
  }

  // ---------------- screens ----------------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  }

  function showSetup() {
    showScreen('setup');
    letSleep();
    heart.stop();
    clearUndo();
    setHeat(0, false);
    // Clear any in-game banner, label, message or flying card left over from the table.
    ['#banner', '#stamp', '#toast'].forEach((q) => $(q).classList.remove('show'));
    hideReveal(false);
    document.querySelectorAll('.shard, .flycard').forEach((el) => el.remove());
    const saved = store.get(SAVE);
    const canResume = !!(saved && saved.phase !== 'over' && saved.players);
    const resume = $('#btnResume');
    resume.classList.toggle('hidden', !canResume);
    // One game at a time: while a game is saved, the only choices are continue or end it.
    $('#setup').classList.toggle('has-save', canResume);
    $('#btnEndSaved').classList.toggle('hidden', !canResume);
    if (canResume) {
      const who = saved.players.map((p, i) => `<b style="color:${pc(i)}">${esc(p.name)}</b>`).join(' · ');
      const lead = saved.players.map((p) => p.total).join(' – ');
      resume.innerHTML = `<span class="rs-txt"><span class="rs-title">Continue your game</span>
        <span class="rs-sub">Round ${saved.round} · ${lead} · to ${saved.target}</span><span class="rs-who">${who}</span></span>
        <span class="rs-go" aria-hidden="true">▶</span>`;
    }
    renderRecap(canResume);
    renderNames();
    renderOnlineHome();
  }

  // ---------------- last game recap ----------------
  function recordLastGame(s) {
    store.set(LAST, {
      when: Date.now(), target: s.target, rounds: s.round, winner: s.winner,
      players: s.players.map((p, i) => ({ name: p.name, total: p.total, i })),
    });
  }

  // Trophy, winner line, and a score bar per player; Play again starts a rematch (only when no game is saved).
  function renderRecap(hasSave) {
    const box = $('#recap');
    const last = store.get(LAST);
    box.classList.toggle('hidden', !last);
    if (!last) return;
    const ranked = last.players.slice().sort((x, y) => y.total - x.total).slice(0, 3);
    const top = Math.max(1, ranked[0].total);
    const winner = last.players[last.winner] || ranked[0];
    box.innerHTML = `<div class="rc-head"><span class="rc-trophy" aria-hidden="true">🏆</span>
        <div class="rc-txt"><div class="rc-title"><b style="color:${pc(winner.i)}">${esc(winner.name)}</b> won last game!</div><div class="rc-sub">Played to ${last.target}</div></div>
        ${hasSave ? '' : '<button class="rc-again" id="btnPlayAgain">Play again</button>'}</div>
      <div class="rc-rows">${ranked.map((p) => `<div class="rc-row" style="--pc:${pc(p.i)}"><span class="rc-name">${esc(p.name)}</span>
        <span class="rc-bar"><i data-w="${Math.round((p.total / top) * 100)}"></i></span><span class="rc-pts">${p.total}</span></div>`).join('')}</div>`;
    setTimeout(() => box.querySelectorAll('.rc-bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }), 60);
    const again = box.querySelector('#btnPlayAgain');
    if (again) again.onclick = () => needOnlyLocal(() => startGame(last.players.map((p) => p.name), last.target));
  }

  function renderNames() {
    $('#pCount').textContent = prefs.count;
    $('#pPlus').disabled = prefs.count >= MAX_PLAYERS; // 4 players max
    $('#pMinus').disabled = prefs.count <= 2;
    // Always a 2x2 grid of slots, so changing the player count with − / + never moves anything
    // else on the screen. Empty slots are faded placeholders.
    const wrap = $('#names');
    wrap.classList.add('two-col');
    const shown = +(wrap.dataset.count || prefs.count);
    wrap.dataset.count = prefs.count;
    wrap.innerHTML = Array.from({ length: MAX_PLAYERS }, (_, i) => (i < prefs.count
      ? `<div class="nameIn${i >= shown ? ' new' : ''}" style="color:${pc(i)}"><span class="sw"></span><input maxlength="14" autocomplete="off" autocapitalize="words" placeholder="Player ${i + 1}" value="${esc(prefs.names[i] || '')}" data-i="${i}"></div>`
      : `<div class="nameIn empty" style="color:${pc(i)}" aria-hidden="true"><span class="sw"></span><div class="ph"></div></div>`)).join('');
    wrap.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
      prefs.names[+inp.dataset.i] = inp.value; store.set(PREFS, prefs);
    }));
    paintTarget('#targetSeg', prefs.target);
  }

  function startGame(names, target, deck) {
    mode = 'local';
    mySeat = null;
    store.del(SAVE);
    clearUndo();
    // Remember who played (typed names only, not "Player 2" defaults) so the next setup is pre-filled.
    prefs.names = names.map((n, i) => (n === `Player ${i + 1}` ? '' : n));
    prefs.count = names.length;
    prefs.target = target;
    store.set(PREFS, prefs);
    game = new Game(names, { target, dealer: names.length - 1, deck });
    game.s.x = { ach: {}, moments: [], maxDef: [] };
    showScreen('table');
    keepAwake();
    game.startRound();
    store.set(SAVE, game.s); // saved from the first moment, even if you leave during the deal
    pump();
  }

  // Keep the screen on while playing, and in the waiting room so the room stays open for friends
  // (a phone that locks pauses the page, and the room with it). Back on the home screen it's let go.
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* not allowed */ }
  }
  function letSleep() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* already gone */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      nudge(false);
      if (mode !== 'local') Net.wake();
      if ($('#lobby').classList.contains('active')) keepAwake();
      if (game) {
        keepAwake();
        const a = game.s.awaiting;
        const modalOpen = !$('#modalWrap').classList.contains('hidden');
        if (!busy && !modalOpen && a && a.type === 'decide' && isMine(a.p) && $('#table').classList.contains('active')) {
          const n = numsOf(game.s.players[a.p]);
          heart.set(n >= 6 ? 650 : n === 5 ? 900 : 0);
        }
      }
    } else {
      heart.stop();
    }
  });

  // ---------------- online rooms ----------------
  // The host's phone runs the real game engine. Every move (the host's own or a guest's) is
  // applied there, and the resulting events are sent to every guest, whose phones play the same
  // animations. Guests only send requests ("flip", "close", "pick player 2"...); the host checks
  // that it's really that player's turn before applying it.
  let members = []; // host: [{ cid, name, peer, on }] in seat order
  let lobbyTarget = 200; // host: chosen target score
  let lobbyData = null; // guest: last lobby update from the host
  let hostSeat = 0; // which seat's phone is running the game (changes after a host handoff)
  let seatList = []; // guest: player ids in seat order, so this phone can take over if the host drops
  let takingOver = false; // guest: trying to take over the room right now
  let nextTakeover = 0; // guest: don't try again before this time
  let quietUntil = 0; // new host: friends switching over aren't announced as "joined"
  let soloShown = false; // host: the "waiting for players" pause is up
  let handingOff = false; // host: leaving on purpose, so the room isn't ended for everyone
  let hostLeftOnPurpose = false; // guest: the host tapped Leave and handed the game on
  let hostUndo = null; // host: { seat, snap } right after someone closes, until the next move
  let netEpoch = 0; // bumps on every create/join so a delayed leave() can't hit a newer room
  const sentEvs = new WeakSet();

  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
  const seatCids = () => members.map((m) => m.cid);
  // Guests get the state without the deck order (only its size) and without the host's extras.
  function strip(s) {
    const c = Object.assign({}, s, { deck: s.deck.map(() => 0) });
    delete c.x;
    return c;
  }
  function waitNote(html) {
    const el = $('#waitNote');
    el.innerHTML = html;
    el.classList.toggle('show', !!html);
  }
  function closeResults() { if ($('#modal').classList.contains('results')) closeModal(); }
  function clearPending() { clearTimeout(pendingAct); pendingAct = null; }

  // One entry point for every move, whatever the mode.
  function act(a, i) {
    if (mode === 'guest') {
      if (!Net.send({ t: 'act', a, i })) { toast('Reconnecting to the room…'); return; }
      clearPending();
      pendingAct = setTimeout(() => { pendingAct = null; if (game && !busy) settle(); }, 6000);
      $('#controls').classList.add('locked');
      return;
    }
    if (mode === 'host') { hostApply(mySeat, a, i); return; }
    if (a === 'hit') game.hit();
    else if (a === 'stay') game.stay();
    else if (a === 'skip') game.skip();
    else if (a === 'target') game.chooseTarget(i);
    else if (a === 'next') game.nextRound();
    pump();
  }

  function broadcastEvents() {
    if (mode !== 'host' || !game) return;
    const evs = game.events.filter((e) => !sentEvs.has(e));
    if (!evs.length) return;
    evs.forEach((e) => sentEvs.add(e));
    Net.broadcast({ t: 'ev', evs: evs.map((e) => Object.assign({}, e, { snap: strip(e.snap) })), state: strip(game.s) });
  }

  function hostApply(seat, a, i) {
    if (!game || seat < 0) return;
    const s = game.s, aw = s.awaiting;
    if (!aw || soloShown) return; // paused: waiting for players
    if (a === 'undo') {
      if (!hostUndo || hostUndo.seat !== seat || aw.type !== 'decide') return; // a finished round can't be undone
      game = Game.load(JSON.parse(hostUndo.snap));
      hostUndo = null;
      closeModal();
      lastTurnP = game.s.awaiting.p;
      Net.broadcast({ t: 'sync', state: strip(game.s), seats: seatCids(), host: mySeat, presence, undoBy: seat });
      toast(`<b>${esc(game.s.players[seat].name)}</b> took back their close`);
      settle();
      return;
    }
    const mine = aw.p === seat;
    if (a === 'next') { if (aw.type !== 'summary') return; closeResults(); game.nextRound(); }
    else if (a === 'target') { if (aw.type !== 'target' || !mine || !aw.options.includes(i)) return; game.chooseTarget(i); }
    else if (aw.type !== 'decide' || !mine) return;
    else if (a === 'hit') game.hit();
    else if (a === 'skip') { if (!game.canSkip(seat)) return; game.skip(); }
    else if (a === 'stay') { const snap = JSON.stringify(s); game.stay(); hostUndo = { seat, snap }; }
    else return;
    if (a !== 'stay') hostUndo = null;
    if (seat !== mySeat && undo && !undo.pending) clearUndo(); // someone else moved: our undo is gone
    broadcastEvents();
    saveHosted();
    pump();
  }

  // ---------- away players: a bot plays for them ----------
  // Someone's phone drops: they're tagged AWAY and everyone gets 15 seconds to see whether they
  // come right back. Still gone after 15 seconds: the host's phone plays their turns with a simple
  // bot (tagged BOT). Gone a full minute: the bot finishes the round, then they sit out with their
  // score frozen.
  // Whenever they reconnect they're tagged REJOINING and take over at the start of their next turn.
  const BOT_DELAY_MS = 900;
  const BOT_AFTER_MS = 15000;
  const SIT_OUT_MS = 60000;
  const HOST_WAIT_MS = 90000; // if the game still can't be reached after this long, offer to leave
  let botTimer = null;
  let botKey = null;
  let graceTimer = null;
  let rejoining = []; // guests: seats whose player is back but waiting for their next turn
  let goneAt = []; // guests: when each away player dropped (in this phone's clock), from the host

  // How long has this seat's player been away? null if they're here.
  function awayMs(i) {
    if (mode === 'host') { const m = members[i]; return m && !m.on && m.awaySince ? Date.now() - m.awaySince : null; }
    return presence[i] === false && goneAt[i] ? Date.now() - goneAt[i] : null;
  }
  const goneList = () => members.map((m) => (!m.on && m.awaySince ? Date.now() - m.awaySince : null));

  // Is the bot in charge of this seat for the current decision?
  let botHoldUntil = 0;
  function botRuns(seat, a) {
    const m = members[seat];
    if (!m || m.left || m.cid === myCid || Date.now() < botHoldUntil) return false; // left on purpose: never a bot
    if (!m.on) return !!m.awaySince && Date.now() - m.awaySince >= BOT_AFTER_MS;
    return !!m.rejoin && a.type !== 'decide';
  }

  // The bot plays like a casual player, not a perfect one: each round it picks a points number
  // to stop at (somewhere from 15 to 30), stops a bit sooner once its hand gets crowded, and
  // gets a little braver while it holds a Lifeline.
  const botStops = {};
  function botChoose(a) {
    const s = game.s;
    const me = s.players[a.p];
    if (a.type === 'decide') {
      const plan = botStops[a.p];
      if (!plan || plan.round !== s.round) botStops[a.p] = { round: s.round, stop: 15 + Math.floor(Math.random() * 16) };
      let stop = botStops[a.p].stop;
      if (numsOf(me) >= 5) stop -= 8;
      if (me.shields.length) stop += 8;
      return breakdown(me).score >= stop ? ['stay'] : ['hit'];
    }
    const others = a.options.filter((i) => i !== a.p);
    if (!others.length) return ['target', a.options[0]];
    const any = others[Math.floor(Math.random() * others.length)];
    if (a.action === 'lock') {
      // Chill whoever's winning the game, like most people would.
      return ['target', others.slice().sort((x, y) => s.players[y].total - s.players[x].total)[0]];
    }
    return ['target', any];
  }

  // Host: after every settle, see whether it's a bot's move (or a returning player's turn).
  function hostWatch() {
    if (mode !== 'host' || !game) return;
    const a = game.s.awaiting;
    if (a && a.type === 'decide' && a.p != null) {
      const m = members[a.p];
      if (m && m.on && m.rejoin) { m.rejoin = false; presenceChanged(); toast(`<b>${esc(m.name)}</b> is back in control`); }
    }
    const key = a && a.p != null && (a.type === 'decide' || a.type === 'target') && botRuns(a.p, a)
      ? `${game.s.round}:${a.type}:${a.p}:${game.s.deck.length}:${game.s.discard.length}` : null;
    // Their turn, but they've only just dropped: check again the moment the 15 seconds are up.
    clearTimeout(graceTimer);
    const am = a && a.p != null ? members[a.p] : null;
    if (!key && am && !am.on && am.awaySince && (a.type === 'decide' || a.type === 'target')) {
      const wait = Math.max(am.awaySince + BOT_AFTER_MS, botHoldUntil) - Date.now();
      if (wait > 0) graceTimer = setTimeout(hostWatch, wait + 50);
    }
    if (key === botKey) return;
    clearTimeout(botTimer);
    botKey = key;
    if (!key) return;
    botTimer = setTimeout(() => {
      botKey = null;
      const now = game && game.s.awaiting;
      if (!now || now.p !== a.p || now.type !== a.type || !botRuns(now.p, now)) return;
      const [act2, i] = botChoose(now);
      hostApply(now.p, act2, i);
      hostUndo = null;
    }, BOT_DELAY_MS);
  }

  // ---------- connection notes ----------
  // Nobody should stare at a frozen screen. Whenever the room link is down, a note at the top says
  // what's going on, with a running clock. If the game can't be reached for a while, guests are
  // offered a way out.
  let lostSince = null; // guest: when the link to the host dropped
  let lostAsked = false; // guest: already asked "keep waiting or leave?"
  let hostOffSince = null; // host: when this phone lost its own connection
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function hostLabel() {
    const p0 = game ? game.s.players[hostSeat] : lobbyData && lobbyData.members[0];
    return p0 && p0.name ? `<b>${esc(p0.name)}</b>` : 'The host';
  }
  function showCountdown(p) {
    if (p == null) { lostSince = null; lostAsked = false; } else if (!lostSince) lostSince = Date.now();
    paintConn();
  }
  function connText() {
    const offline = navigator.onLine === false;
    if (mode === 'guest' && lostSince) {
      const ms = Date.now() - lostSince;
      if (offline) return `You're offline. Reconnecting when your signal is back… <b>${clock(ms)}</b>`;
      if (takingOver) return 'Moving the game to your phone…';
      if (!game && !lobbyData) return `Reconnecting… <b>${clock(ms)}</b>`;
      if (ms < BOT_AFTER_MS) return `${hostLabel()} (host) dropped out. Game moves on in <b>${clock(BOT_AFTER_MS - ms + 999)}</b>`;
      const next = successorName();
      if (hostLeftOnPurpose) return `${hostLabel()} left. Moving the game to ${next ? `${next}'s phone` : 'the next phone'}…`;
      return next ? `Moving the game to ${next}'s phone… <b>${clock(ms)}</b>` : `Reconnecting to the game… <b>${clock(ms)}</b>`;
    }
    if (mode === 'host' && hostOffSince && Date.now() - hostOffSince > 1500) {
      return `You lost your connection. Reconnecting… <b>${clock(Date.now() - hostOffSince)}</b>`;
    }
    // Someone just dropped: everyone sees the 30-second wait count down, whoever's turn it is.
    if (game && mode !== 'local') {
      const waiting = game.s.players.map((p, i) => ({ p, i, ms: awayMs(i) }))
        .filter((x) => x.i !== mySeat && x.ms != null && x.ms < BOT_AFTER_MS && x.p.status !== 'sitout')
        .sort((x, y) => y.ms - x.ms);
      if (waiting.length) {
        const w = waiting[0];
        const more = waiting.length > 1 ? ` (+${waiting.length - 1} more)` : '';
        return `<b>${esc(w.p.name)}</b> dropped out${more}. Bot takes over in <b>${clock(BOT_AFTER_MS - w.ms + 999)}</b>`;
      }
    }
    return '';
  }
  function paintConn() {
    const html = connText();
    const el = $('#awayNote');
    el.innerHTML = html;
    el.classList.toggle('show', !!html && $('#table').classList.contains('active'));
    const lb = $('#lbConn');
    if (lb) lb.innerHTML = html;
  }
  function askKeepWaiting() {
    openModal(`<h2>Still connecting</h2><p>We can't reach the game right now. It picks up right where it left off as soon as we do. You can keep waiting or leave the room.</p>
      <div class="mbtns"><button class="btn pink" id="mWait">Keep waiting</button><button class="btn ghost" id="mLeaveRoom">Leave room</button></div>`, (m) => {
      m.querySelector('#mWait').onclick = backToTable;
      m.querySelector('#mLeaveRoom').onclick = () => leaveRoom();
    }, '', backToTable);
  }
  // ---------- host handoff ----------
  // The host's phone drops: after the same 30-second countdown anyone gets, the next phone in seat
  // order takes over the room. The room's code is a lock only one phone can hold, so there's never
  // two hosts. The new host rebuilds the hidden deck from cards nobody has seen (see
  // Game.takeOver), a bot plays the old host's turns, and the old host rejoins as a player.
  function successorOrder() {
    if (game) {
      const n = game.s.players.length;
      const order = [];
      for (let k = 1; k < n; k++) {
        const i = (hostSeat + k) % n;
        if (presence[i] !== false) order.push(i);
      }
      return order;
    }
    return lobbyData ? lobbyData.members.slice(1).map((m) => m.cid) : [];
  }
  function successorName() {
    const first = successorOrder()[0];
    if (first == null || first === mySeat || first === myCid) return null;
    const name = game ? game.s.players[first] && game.s.players[first].name : (lobbyData.members.find((m) => m.cid === first) || {}).name;
    return name ? `<b>${esc(name)}</b>` : null;
  }
  async function takeOver() {
    takingOver = true;
    paintConn();
    const code = Net.code;
    try {
      await Net.host(code, { tries: 2 });
    } catch (e) {
      // Someone else got there first, or the old host is still holding the room: stay a guest.
      takingOver = false;
      nextTakeover = Date.now() + 20000;
      if (mode === 'guest') Net.rejoin(code);
      return;
    }
    takingOver = false;
    if (mode !== 'guest') { Net.leave(); return; } // left the room meanwhile
    becomeHost(code);
  }
  function becomeHost(code) {
    const oldHost = hostSeat;
    const droppedAt = lostSince || Date.now();
    const oldName = game ? game.s.players[oldHost] && game.s.players[oldHost].name : lobbyData && lobbyData.members[0] && lobbyData.members[0].name;
    mode = 'host';
    clearPending();
    clearUndo();
    hostUndo = null;
    showCountdown(null);
    if (!$('#modalWrap').classList.contains('hidden') && $('#modal').querySelector('#mWait')) closeModal();
    quietUntil = Date.now() + 20000;
    store.del(ROOM);
    alertsOn = false;
    pushSubscribe(code).then((ok) => { alertsOn = ok; renderAlerts(); });
    if (!game) {
      // Still in the lobby: just keep the room open with this phone as host.
      const now2 = Date.now();
      members = [{ cid: myCid, name: prefs.myName || 'Player', peer: null, on: true }].concat((lobbyData ? lobbyData.members.slice(1) : [])
        .filter((m) => m.cid !== myCid).map((m) => ({ cid: m.cid, name: m.name, peer: null, on: false, awaySince: now2, restored: true })));
      mySeat = 0;
      hostSeat = 0;
      lobbyTarget = lobbyData ? lobbyData.target : 200;
      lobbyData = null;
      showLobby();
      saveLobby();
      hostLeftOnPurpose = false;
      toast(`${oldName ? `<b>${esc(oldName)}</b>` : 'The host'} left, so you're hosting this room now`, 3500);
      return;
    }
    const leftOnPurpose = hostLeftOnPurpose;
    hostLeftOnPurpose = false;
    game = Game.takeOver(JSON.parse(JSON.stringify(game.s)));
    game.s.x = game.s.x || { ach: {}, moments: [], maxDef: [] };
    const now = Date.now();
    members = seatList.map((cid, i) => {
      const wasHere = presence[i] !== false && i !== oldHost;
      return {
        cid, name: game.s.players[i].name, peer: null, on: i === mySeat,
        fresh: wasHere, // friends who were connected are just switching over: no "is back" notes
        awaySince: i === mySeat ? null : i === oldHost ? droppedAt : !wasHere && goneAt[i] ? goneAt[i] : now,
        totalAtDrop: game.s.players[i].total,
      };
    });
    hostSeat = mySeat;
    lobbyTarget = game.s.target;
    if (leftOnPurpose && members[oldHost]) {
      members[oldHost].left = true;
      members[oldHost].awaySince = now - SIT_OUT_MS;
      game.leave(oldHost); // out right away, like anyone who taps Leave
    }
    presence = members.map((m) => m.on);
    rejoining = [];
    botHoldUntil = now + 8000; // give friends' phones a moment to switch over
    setTimeout(hostWatch, 8100);
    saveHosted();
    toast(leftOnPurpose ? `<b>${esc(oldName || 'The host')}</b> left, so your phone is running the game now`
      : `<b>${esc(oldName || 'The host')}</b>'s connection dropped, so your phone is running the game now`, 4000);
    lastTurnP = null;
    if (!busy) settle();
  }

  // Fewer than 2 players still in (everyone else gone a minute or left): pause until someone's back.
  const andList = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);
  function soloCheck() {
    if (game.s.phase === 'over') return;
    const inGame = game.s.players.filter((pl) => !(pl.out && pl.status === 'sitout')).length;
    if (inGame >= 2) {
      if (soloShown) { soloShown = false; if ($('#modal').querySelector('#mSoloEnd')) closeModal(); if (!busy) settle(); toast('Back to the game!', 1800); }
      return;
    }
    const clk = $('#modal').querySelector('#soloClock');
    if (soloShown && clk) { clk.textContent = clock(Date.now() - soloSince); return; } // already showing: tick the timer
    if (busy || !$('#table').classList.contains('active')) return;
    if (!soloShown) soloSince = Date.now();
    soloShown = true;
    const gone = game.s.players.filter((pl, i) => i !== mySeat && pl.out && pl.status === 'sitout').map((pl) => `<b>${esc(pl.name)}</b>`);
    openModal(`<h2>Waiting for players</h2><p>${andList(gone)} ${gone.length > 1 ? 'are' : 'is'} out of the game, and you need at least 2 players. The game picks up as soon as someone rejoins with room code <b>${esc(Net.code || '')}</b>.</p>
      <p class="solo-clock">Waiting <b id="soloClock">${clock(Date.now() - soloSince)}</b></p>
      <div class="mbtns"><button class="btn ghost" id="mSoloEnd" style="color:var(--bad)">End the game</button></div>`, (m) => {
      m.querySelector('#mSoloEnd').onclick = () => { soloShown = false; leaveRoom(); };
    }, '', null);
  }
  let soloSince = 0;

  // Host's phone came back online: friends' phones reconnect on their own within a few seconds,
  // so don't start the bot for them, and restart their away clocks from now.
  function hostBack() {
    botHoldUntil = Date.now() + 8000;
    members.forEach((m) => { if (!m.on && m.awaySince) m.awaySince = Date.now(); });
    toast("You're back online. Friends are reconnecting…", 2500);
  }
  setInterval(() => {
    if (mode === 'host') {
      const inRoom = $('#lobby').classList.contains('active') || $('#table').classList.contains('active');
      const off = inRoom && (!Net.connected || navigator.onLine === false);
      if (off && !hostOffSince) hostOffSince = Date.now();
      else if (!off && hostOffSince) { const was = Date.now() - hostOffSince; hostOffSince = null; if (was > 1500) hostBack(); }
    } else hostOffSince = null;
    if (mode === 'guest' && lostSince && !takingOver && navigator.onLine !== false && (game || lobbyData)) {
      // The host has been gone 15 seconds: the next phone in line takes over the game. Phones
      // further down the line wait a little longer, in case the first one is gone too.
      const order = successorOrder();
      let rank = order.indexOf(game ? mySeat : myCid);
      if (rank < 0) rank = order.length;
      if (Date.now() >= Math.max(lostSince + BOT_AFTER_MS + rank * 5000, nextTakeover)) takeOver();
    }
    if (mode === 'guest' && lostSince && !lostAsked && Date.now() - lostSince > HOST_WAIT_MS && $('#modalWrap').classList.contains('hidden')) {
      lostAsked = true;
      askKeepWaiting();
    }
    if (mode === 'host' && game) soloCheck();
    if (mode === 'host' && !game && members.some((m) => m.on === false && m.awaySince && Date.now() - m.awaySince > BOT_AFTER_MS)) {
      members = members.filter((m) => {
        if (m.on !== false || !m.awaySince || Date.now() - m.awaySince <= BOT_AFTER_MS) return true;
        if (!m.restored) toast(`<b>${esc(m.name)}</b> left the room`, 2500);
        return false;
      });
      lobbyChanged();
    }
    paintConn();
    // A dropped player's AWAY tag turns into BOT once their 15 seconds are up.
    if (game && mode !== 'local') {
      const sig = game.s.players.map((_, i) => { const ms = awayMs(i); return ms == null ? '' : ms < BOT_AFTER_MS ? 'a' : 'b'; }).join();
      if (sig !== tagSig) { tagSig = sig; if (!busy && $('#table').classList.contains('active')) render(game.s, focusP); }
    }
  }, 1000);
  let tagSig = '';
  // Host: every few seconds, check for anyone who's been gone a minute. The bot finishes the round
  // they're in, then they sit out (no cards, no turns, total frozen) from the next round until
  // they come back.
  setInterval(() => {
    if (mode !== 'host' || !game || hostOffSince) return; // while the host is offline, nobody's clock runs
    const s = game.s;
    let changed = false;
    members.forEach((m, i) => {
      const p = s.players[i];
      if (m.on || !m.awaySince || Date.now() - m.awaySince < SIT_OUT_MS || !p || p.out) return;
      p.out = true; // sits out from the next round; the bot keeps playing this one for them
      changed = true;
      if (m.left) return; // they chose to leave; everyone was already told
      const playing = s.phase === 'play' && p.status === 'active';
      const note = playing
        ? `<b>${esc(m.name)}</b> has been gone a minute. The bot finishes this round for them, then they sit out until they're back.`
        : `<b>${esc(m.name)}</b> has been gone a minute, so they sit out until they're back.`;
      toast(note, 3200);
      members.forEach((x) => { if (x.peer && x.on) Net.sendTo(x.peer, { t: 'note', html: note }); });
    });
    if (changed) {
      saveHosted();
      Net.broadcast({ t: 'sync', state: strip(s), seats: seatCids(), host: mySeat, presence, rejoin: members.map((x) => !!(x.on && x.rejoin)), gone: goneList() });
      if (!busy && $('#table').classList.contains('active')) render(s, focusP);
    }
  }, 5000);

  const hostedByMe = (h) => !!h && (h.host ? h.host === myCid : !!(h.members && h.members[0] && h.members[0].cid === myCid));
  function saveHosted() {
    if (mode !== 'host' || !game) return;
    store.set(HOSTED, { code: Net.code, host: myCid, members: members.map(({ cid, name }) => ({ cid, name })), target: game.s.target, state: game.s, when: Date.now() });
  }

  function presenceChanged() {
    presence = members.map((m) => m.cid === myCid || m.on);
    rejoining = members.map((m) => !!(m.on && m.rejoin));
    Net.broadcast({ t: 'presence', on: presence, rejoin: rejoining, gone: goneList(), host: mySeat });
    if (game && !busy && $('#table').classList.contains('active')) render(game.s, focusP);
  }

  function lobbyChanged() {
    Net.broadcast({ t: 'lobby', members: members.map(({ cid, name, on }) => ({ cid, name, on: on !== false })), target: lobbyTarget });
    if ($('#lobby').classList.contains('active')) renderLobby();
    saveLobby();
  }
  // Waiting in the lobby counts too: if the phone closes the page, the room can be reopened.
  function saveLobby() {
    if (mode !== 'host' || game || !Net.code) return;
    store.set(HOSTED, { code: Net.code, host: myCid, members: members.map(({ cid, name }) => ({ cid, name })), target: lobbyTarget, state: null, lobby: true, when: Date.now() });
  }

  function hostMsg(d, peerId) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') {
      const cid = String(d.cid || '').slice(0, 40);
      const name = cleanName(d.name);
      if (!cid || cid === myCid) return;
      let m = members.find((x) => x.cid === cid);
      if (game) {
        if (!m) { Net.sendTo(peerId, { t: 'refuse', why: 'started' }); Net.kick(peerId); return; }
        const wasOff = !m.on;
        m.peer = peerId; m.on = true; m.awaySince = null; m.left = false;
        if (wasOff && !m.fresh) m.rejoin = true; // takes over again at the start of their next turn
        const fresh = m.fresh;
        m.fresh = false;
        const seatP = game.s.players[members.indexOf(m)];
        if (seatP) {
          seatP.out = false;
          // Back mid-round after sitting out: they're in again from their next turn (with an empty hand).
          if (seatP.status === 'sitout' && game.s.phase === 'play') seatP.status = 'active';
        }
        // Tell the returning player what happened while they were gone, and let everyone else know.
        const back = wasOff && !fresh ? { gained: seatP && m.totalAtDrop != null ? seatP.total - m.totalAtDrop : 0 } : null;
        Net.sendTo(peerId, { t: 'sync', state: strip(game.s), seats: seatCids(), host: mySeat, presence: members.map((x) => x.cid === myCid || x.on), rejoin: members.map((x) => !!(x.on && x.rejoin)), gone: goneList(), back });
        presenceChanged();
        if (back) {
          const note = `<b>${esc(m.name)}</b> is back and plays on their next turn`;
          toast(note, 3000);
          members.forEach((x) => { if (x !== m && x.peer && x.on) Net.sendTo(x.peer, { t: 'note', html: note }); });
        }
        hostWatch();
        return;
      }
      if (!m) {
        if (members.length >= MAX_PLAYERS) { Net.sendTo(peerId, { t: 'refuse', why: 'full' }); Net.kick(peerId); return; }
        m = { cid, name, peer: peerId, on: true };
        members.push(m);
        if (Date.now() > quietUntil) joinAlert(name);
      } else { m.peer = peerId; m.on = true; m.name = name; m.awaySince = null; m.restored = false; }
      lobbyChanged();
      return;
    }
    const m = members.find((x) => x.peer === peerId);
    if (!m) return;
    if (d.t === 'bye') { guestQuit(m); return; }
    if (!game) return;
    if (d.t === 'act') hostApply(members.indexOf(m), String(d.a), Number(d.i));
  }

  // A guest tapped Leave. In the lobby they're simply gone. Mid-game they sit out right away (no
  // bot, no waiting); they can still come back with the room code and play from their next turn.
  function guestQuit(m) {
    m.peer = null;
    if (!game) {
      members = members.filter((x) => x !== m);
      lobbyChanged();
      toast(`<b>${esc(m.name)}</b> left the room`, 2500);
      return;
    }
    const i = members.indexOf(m);
    m.on = false;
    m.left = true;
    m.awaySince = Date.now() - SIT_OUT_MS; // past every limit: no countdown, no bot
    m.totalAtDrop = game.s.players[i] ? game.s.players[i].total : 0;
    if (game.s.awaiting && game.s.awaiting.p === i && game.s.awaiting.type === 'decide') hostUndo = null;
    game.leave(i); // out right away: no bot ever plays for someone who chose to leave
    broadcastEvents();
    saveHosted();
    presenceChanged();
    pump();
    const note = `<b>${esc(m.name)}</b> left the game. They can come back any time with the room code.`;
    toast(note, 3200);
    members.forEach((x) => { if (x !== m && x.peer && x.on) Net.sendTo(x.peer, { t: 'note', html: note }); });
  }

  function hostLeft(peerId) {
    const m = members.find((x) => x.peer === peerId);
    if (!m) return;
    m.peer = null;
    if (!game) { m.on = false; m.awaySince = Date.now(); lobbyChanged(); return; } // 15 seconds to come back (a reload, a blip)
    m.on = false;
    m.awaySince = Date.now();
    m.totalAtDrop = game.s.players[members.indexOf(m)] ? game.s.players[members.indexOf(m)].total : 0;
    presenceChanged();
    hostWatch();
    const note = `<b>${esc(m.name)}</b> dropped out. If they're not back in 15 seconds, a bot plays for them.`;
    toast(note, 3200);
    members.forEach((x) => { if (x !== m && x.peer && x.on) Net.sendTo(x.peer, { t: 'note', html: note }); });
  }

  function hostStart() {
    members = members.filter((m) => m.on !== false); // anyone still reconnecting misses this game
    if (members.length < 2) { lobbyChanged(); return; }
    clearUndo();
    hostUndo = null;
    mySeat = members.findIndex((m) => m.cid === myCid);
    hostSeat = mySeat;
    const names = members.map((m) => m.name);
    game = new Game(names, { target: lobbyTarget, dealer: names.length - 1 });
    game.s.x = { ach: {}, moments: [], maxDef: [] };
    presence = members.map((m) => m.cid === myCid || m.on);
    Net.broadcast({ t: 'start', state: strip(game.s), seats: seatCids(), host: mySeat, presence });
    closeModal();
    lastTurnP = null;
    showScreen('table');
    keepAwake();
    game.startRound();
    broadcastEvents();
    saveHosted();
    pump();
  }

  function guestMsg(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'lobby': {
        const had = lobbyData ? lobbyData.members.map((x) => x.cid) : null;
        lobbyData = d;
        if (had) d.members.forEach((x) => { if (!had.includes(x.cid) && x.cid !== myCid) joinAlert(x.name); });
        if (!game) showLobby();
        break;
      }
      case 'start':
        if (Net.code) store.set(ROOM, { code: Net.code, when: Date.now() });
        clearPending();
        clearUndo();
        mySeat = d.seats.indexOf(myCid);
        seatList = d.seats.slice();
        hostSeat = d.host != null ? d.host : 0;
        presence = d.presence || [];
        guestX = null;
        game = Game.load(d.state);
        lastTurnP = null;
        closeModal();
        showScreen('table');
        keepAwake();
        render(game.s, 0);
        break;
      case 'sync': {
        // Joining or rejoining mid-game, or someone undid a close: jump straight to the host's state.
        clearPending();
        clearUndo();
        mySeat = d.seats.indexOf(myCid);
        seatList = d.seats.slice();
        if (d.host != null && d.host !== hostSeat && game) toast(`<b>${esc(game.s.players[d.host] ? game.s.players[d.host].name : 'A friend')}</b>'s phone is running the game now`, 3500);
        if (d.host != null) hostSeat = d.host;
        presence = d.presence || presence;
        if (d.gone) setGone(d.gone);
        game = Game.load(d.state);
        const a = game.s.awaiting;
        lastTurnP = a && a.p != null ? a.p : null;
        closeModal();
        if (!$('#table').classList.contains('active')) { showScreen('table'); keepAwake(); }
        if (d.rejoin) rejoining = d.rejoin;
        if (d.back) {
          const g = d.back.gained;
          const bot = g > 0 ? ` While you were away, the bot added <b>${g}</b> to your score.` : '';
          toast(`Welcome back! You're in again on your next turn.${bot}`, 5000);
        }
        if (d.undoBy != null) toast(`<b>${esc(game.s.players[d.undoBy].name)}</b> took back their close`);
        if (!busy) settle();
        break;
      }
      case 'ev':
        if (!game) return;
        clearPending();
        if (undo && !undo.pending) clearUndo();
        if (d.evs.some((e) => e.type === 'roundStart')) closeResults();
        game.events.push(...d.evs);
        game.s = d.state;
        pump();
        break;
      case 'sitout':
        if (game) (d.out || []).forEach((o, i) => { if (game.s.players[i]) game.s.players[i].out = o; });
        break;
      case 'note':
        toast(d.html, 3000);
        break;
      case 'presence':
        presence = d.on || [];
        rejoining = d.rejoin || [];
        setGone(d.gone || []);
        if (d.host != null) hostSeat = d.host;
        if (game && !busy && $('#table').classList.contains('active')) render(game.s, focusP);
        break;
      case 'refuse':
        toast(d.why === 'full' ? 'That room is full (4 players max)' : 'That game has already started', 3000);
        leaveRoom(true);
        break;
      case 'handoff':
        // Skip the 15-second wait: the chosen phone takes over now, the others give it a head start.
        hostLeftOnPurpose = true;
        lostSince = Date.now() - BOT_AFTER_MS;
        lostAsked = false;
        nextTakeover = d.toCid === myCid ? 0 : Date.now() + 10000;
        paintConn();
        break;
      case 'end':
        toast(`${game || lobbyData ? hostLabel() : 'The host'} ended the game`, 3000);
        leaveRoom(true);
        break;
    }
  }

  function setGone(list) { goneAt = list.map((ms) => (ms == null ? null : Date.now() - ms)); }

  // ---------- join alerts ----------
  // Someone joins your room: a pop-up, a short chime, and a buzz (where phones allow it). If the
  // game is in the background, a notification too. Sound needs one tap on the page first.
  function joinAlert(name) {
    toast(`<b>${esc(name)}</b> joined!`, 2600);
    sfx.join();
    if (mode === 'host' && document.hidden) showAlert(`${name} joined your room`, 'Tap to get the game going.');
  }

  // ---------- lock-screen alerts (Web Push) ----------
  // The host can ask to be alerted when friends join. If the host's phone has the game in the
  // background (say, in Messages sending the invite), a friend who taps the link can't reach the
  // room, so their phone asks our server to send the host a notification. Works on Android, and
  // on iPhone once the game is added to the Home Screen.
  const pushOK = () => !NATIVE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iosBrowser = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches);
  const fromB64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  const API = (path) => (location.protocol.startsWith('http') && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '' : SITE_URL.replace(/\/$/, '')) + path;
  let alertsOn = false;
  async function pushSubscribe(code) {
    if (!pushOK() || Notification.permission !== 'granted' || !code) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const k = await (await fetch(API('/push/key'), { cache: 'no-store' })).json();
        if (!k.key) return false;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(k.key) });
      }
      const r = await fetch(API('/push/subscribe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: code, sub: sub.toJSON() }) });
      return !!(r.ok && (await r.json()).ok);
    } catch (e) { return false; }
  }
  async function pushForget(code) {
    if (!pushOK() || !code) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) fetch(API('/push/forget'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: code, endpoint: sub.endpoint }) }).catch(() => {});
    } catch (e) { /* nothing to forget */ }
  }
  async function showAlert(title, body) {
    try {
      if (!pushOK() || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'join', renotify: true });
    } catch (e) { /* the pop-up is enough */ }
  }
  // Friend's phone: the room isn't answering, so ask the server to alert the host.
  async function pingHost(code) {
    try {
      const r = await fetch(API('/push/notify'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: code, name: prefs.myName || '' }) });
      return !!(r.ok && (await r.json()).sent);
    } catch (e) { return false; }
  }
  async function turnOnAlerts() {
    try {
      const ok = (await Notification.requestPermission()) === 'granted';
      alertsOn = ok && (await pushSubscribe(Net.code));
      if (!alertsOn) toast(ok ? "Alerts aren't available right now" : 'Alerts are off. You can turn them on in your phone settings.', 3000);
    } catch (e) { alertsOn = false; }
    renderAlerts();
  }
  function renderAlerts() {
    const el = $('#lbAlerts');
    if (!el) return;
    let html = '';
    if (mode === 'host' && !game) {
      if (alertsOn) html = "<span class=\"lb-alert-on\">🔔 You'll get a notification when friends join</span>";
      else if (pushOK() && Notification.permission !== 'denied') html = '<button class="btn link" id="lbAlertBtn" type="button">🔔 Notify me when friends join</button>';
      else if (iosBrowser()) html = '<span class="lb-alert-tip">Tip: add the game to your Home Screen to get a notification when friends join.</span>';
    }
    el.innerHTML = html;
    const b = $('#lbAlertBtn');
    if (b) b.onclick = turnOnAlerts;
  }

  // ---------- lobby ----------
  function showLobby() {
    showScreen('lobby');
    keepAwake();
    renderLobby();
  }
  function renderLobby() {
    const isHost = mode === 'host';
    const list = isHost ? members : lobbyData ? lobbyData.members : [];
    const target = isHost ? lobbyTarget : lobbyData ? lobbyData.target : 200;
    $('#lobby').classList.toggle('is-host', isHost);
    $('#lbCode').textContent = Net.code || '····';
    $('#lbCount').textContent = list.length ? `${list.length} of ${MAX_PLAYERS}` : '';
    const here = list.filter((m) => m.on !== false).length;
    $('#lbPlayers').innerHTML = list.map((m, i) => `<div class="lb-p${m.on === false ? ' away' : ''}" style="--pc:${pc(i)}"><span class="sw"></span><span class="lb-n">${esc(m.name)}</span>`
      + `${m.on === false ? '<span class="tag-s away">Reconnecting…</span>' : ''}${i === 0 ? '<span class="tag-s dealer">Host</span>' : ''}${m.cid === myCid ? '<span class="tag-s you">You</span>' : ''}</div>`).join('')
      + (list.length < MAX_PLAYERS ? `<div class="lb-p empty"><span class="sw"></span><span class="lb-n">${list.length ? 'Waiting for friends…' : 'Connecting…'}</span></div>` : '');
    paintTarget('#lbTarget', target);
    $('#lbNote').textContent = isHost
      ? (here < 2 ? 'Send friends the code or invite link. You need at least 2 players.' : `Ready when you are. First to ${target} wins.`)
      : `Waiting for ${list[0] ? list[0].name : 'the host'} to start. First to ${target} wins.`;
    $('#lbStart').disabled = here < 2;
    renderAlerts();
  }

  // In the App Store app, links point at the website so friends without the app can join too.
  // Share the game itself (not a room): native share sheet on phones, else copy the link.
  async function shareApp() {
    const url = SITE_URL;
    try {
      if (navigator.share) { await navigator.share({ title: 'Streak or Bust', text: 'Come play Streak or Bust with me! A fast-paced push-your-luck card game.', url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied. Paste it to your friends!'); } catch (e) { toast(`Share this link: <b>${esc(url.replace('https://', ''))}</b>`, 3500); }
  }

  const roomLink = () => `${NATIVE ? SITE_URL : location.origin + location.pathname}?room=${Net.code}`;
  async function invite() {
    const url = roomLink();
    try {
      if (navigator.share) { await navigator.share({ title: 'Streak or Bust', text: `Join my Streak or Bust game, a fast-paced push-your-luck card game! Room code: ${Net.code}`, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { toast(`Room code: <b>${esc(Net.code)}</b>`, 3000); }
  }

  // ---------- create / join / leave ----------
  function myName() {
    const inp = $('#myName');
    const n = inp.value.replace(/\s+/g, ' ').trim();
    if (!n) { inp.focus(); toast('Type your name first'); return null; }
    prefs.myName = n;
    store.set(PREFS, prefs);
    return n.slice(0, 14);
  }
  const netError = (e) => (e && e.message === 'no-room' ? null
    : e && e.message === 'offline' ? 'You look offline. Online games need an internet connection.'
      : 'Couldn\'t reach the room. Check your connection and try again.');
  function setNetBusy(on, label) {
    ['#btnCreate', '#btnJoin', '#btnRejoin'].forEach((q) => { $(q).disabled = on; });
    $('#btnCreate').textContent = on && label ? label : 'Create a room';
  }

  async function createRoom(reopen) {
    const name = reopen ? (reopen.members.find((m) => m.cid === myCid) || {}).name || myName() : myName();
    if (!name) return;
    const epoch = ++netEpoch;
    setNetBusy(true, reopen ? 'Reopening…' : 'Creating…');
    mode = 'host';
    game = null;
    try {
      await Net.host(reopen ? reopen.code : null, reopen ? { tries: 3 } : {});
    } catch (e) {
      if (epoch !== netEpoch) return;
      mode = 'local';
      setNetBusy(false);
      if (reopen && e.type === 'unavailable-id') {
        // A friend's phone took over while this one was away: join as a player instead.
        store.del(HOSTED);
        toast("A friend's phone is running this game now. Joining as a player…", 3200);
        joinRoom(reopen.code);
        return;
      }
      toast(netError(e), 3200);
      return;
    }
    if (epoch !== netEpoch) return;
    setNetBusy(false);
    alertsOn = false;
    pushSubscribe(Net.code).then((ok) => { alertsOn = ok; renderAlerts(); });
    if (reopen && reopen.lobby) {
      const now = Date.now();
      members = [{ cid: myCid, name, peer: null, on: true }].concat((reopen.members || []).filter((m) => m.cid !== myCid)
        .map((m) => ({ cid: m.cid, name: m.name, peer: null, on: false, awaySince: now, restored: true })));
      mySeat = 0;
      lobbyTarget = reopen.target || 200;
      showLobby();
      saveLobby();
      toast(`Room <b>${esc(Net.code)}</b> is open again`, 2500);
      return;
    }
    if (reopen) {
      members = reopen.members.map((m) => ({ cid: m.cid, name: m.name, peer: null, on: m.cid === myCid, fresh: true, awaySince: m.cid === myCid ? null : Date.now() }));
      botHoldUntil = Date.now() + 8000; // friends' phones reconnect on their own; don't play for them yet
      setTimeout(hostWatch, 8100);
      mySeat = members.findIndex((m) => m.cid === myCid);
      hostSeat = mySeat;
      lobbyTarget = reopen.target;
      presence = members.map((m) => m.cid === myCid);
      game = Game.load(reopen.state);
      lastTurnP = null;
      showScreen('table');
      keepAwake();
      settle();
      toast(`Room <b>${esc(Net.code)}</b> is open again. Friends rejoin automatically.`, 3200);
      return;
    }
    members = [{ cid: myCid, name, peer: null, on: true }];
    mySeat = 0;
    lobbyTarget = 200;
    showLobby();
    saveLobby();
  }

  async function joinRoom(code) {
    const name = myName();
    if (!name) return;
    code = Net.cleanCode(code);
    if (code.length !== 4) { $('#joinCode').focus(); toast('Room codes are 4 letters'); return; }
    const epoch = ++netEpoch;
    setNetBusy(true);
    mode = 'guest';
    game = null;
    lobbyData = null;
    // The room isn't answering: the host may have switched apps to send the invite. Keep looking
    // for a while (with a clock and a Cancel button) and ask the server to alert the host.
    const started = Date.now();
    let pinged = null;
    for (;;) {
      try {
        await Net.join(code);
        break;
      } catch (e) {
        if (epoch !== netEpoch) return;
        if (e && e.message === 'no-room' && Date.now() - started < 90000) {
          if (pinged === null) { pinged = false; pingHost(code).then((ok) => { pinged = ok; }); }
          joinStatus(code, started, () => pinged);
          await new Promise((r) => setTimeout(r, 2500));
          if (epoch !== netEpoch) return;
          continue;
        }
        mode = 'local';
        setNetBusy(false);
        joinStatus(null);
        toast(netError(e) || (pinged !== null ? `Room <b>${esc(code)}</b> didn't answer. Ask the host to open the game, then try again.` : `No room found with code <b>${esc(code)}</b>`), 4000);
        return;
      }
    }
    if (epoch !== netEpoch) return;
    joinStatus(null);
    setNetBusy(false);
    store.set(ROOM, { code, when: Date.now() });
    if (!game && !$('#lobby').classList.contains('active')) showLobby();
  }

  // "Looking for room ABCD… 0:12" under the Join button while the room isn't answering.
  let joinTick = null;
  function joinStatus(code, started, pinged) {
    clearInterval(joinTick);
    const el = $('#joinStatus');
    if (!code) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const paint = () => {
      const p = pinged();
      el.innerHTML = `<span>Looking for room <b>${esc(code)}</b>… <b class="clk">${clock(Date.now() - started)}</b></span>`
        + `<small>${p ? "The host's phone got a notification to open the game." : 'If the host switched apps, ask them to open the game again.'}</small>`
        + '<button class="btn link" id="joinCancel" type="button">Cancel</button>';
      $('#joinCancel').onclick = () => { ++netEpoch; Net.leave(); mode = 'local'; setNetBusy(false); joinStatus(null); };
    };
    paint();
    el.classList.remove('hidden');
    joinTick = setInterval(paint, 1000);
  }

  // The host taps Leave but the others want to keep playing: hand the room to the next connected
  // player's phone right away (no 15-second wait, since it's on purpose). Like anyone who leaves,
  // the host is out at once with no bot, and can rejoin later with the room code.
  function nextHostSeat() {
    const n = members.length;
    for (let k = 1; k < n; k++) {
      const i = (mySeat + k) % n;
      if (members[i] && members[i].on !== false && members[i].peer && members[i].cid !== myCid) return i;
    }
    return null;
  }
  function hostHandOff() {
    const to = nextHostSeat();
    if (to == null) { leaveRoom(); return; }
    const name = members[to].name;
    const inGame = !!game;
    Net.broadcast({ t: 'handoff', from: mySeat, toCid: members[to].cid });
    handingOff = true;
    leaveRoom();
    handingOff = false;
    toast(inGame ? `You left. The game keeps going on <b>${esc(name)}</b>'s phone.` : `You left. <b>${esc(name)}</b> is hosting the room now.`, 3500);
  }
  function askHostLeave(inLobby) {
    const to = nextHostSeat();
    if (to == null) { leaveRoom(); return; }
    const who = `<b>${esc(members[to].name)}</b>`;
    openModal(`<h2>${inLobby ? 'Leave the room?' : 'Leave the game?'}</h2><p>${inLobby ? `${who} can keep the room open for everyone else, or you can close it.` : `The game keeps going on ${who}'s phone, and you can rejoin with the room code. Or end it for everyone.`}</p>
      <div class="mbtns"><button class="btn pink" id="mHandOff">${inLobby ? `Leave, ${esc(members[to].name)} hosts` : 'Leave, others keep playing'}</button>
      <button class="btn ghost" id="mEndAll" style="color:var(--bad)">${inLobby ? 'Close the room for everyone' : 'End the game for everyone'}</button>
      <button class="btn ghost" id="mStay">${inLobby ? 'Stay' : 'Keep playing'}</button></div>`, (m) => {
      m.querySelector('#mHandOff').onclick = hostHandOff;
      m.querySelector('#mEndAll').onclick = () => leaveRoom();
      m.querySelector('#mStay').onclick = inLobby ? closeModal : () => { closeModal(); settle(); };
    }, '', inLobby ? closeModal : backToTable);
  }

  // silent: the room ended on the other side, just tidy up.
  function leaveRoom(silent) {
    const was = mode;
    if (was === 'host') { if (!handingOff) Net.broadcast({ t: 'end' }); store.del(HOSTED); pushForget(Net.code); }
    if (was === 'guest') { store.del(ROOM); if (!silent) Net.send({ t: 'bye' }); }
    alertsOn = false;
    const epoch = netEpoch;
    setTimeout(() => { if (epoch === netEpoch) Net.leave(); }, !silent ? 400 : 0);
    mode = 'local';
    game = null;
    members = [];
    lobbyData = null;
    mySeat = null;
    presence = [];
    hostUndo = null;
    clearPending();
    clearUndo();
    waitNote('');
    clearTimeout(botTimer); botKey = null; rejoining = [];
    hostSeat = 0; seatList = []; takingOver = false; nextTakeover = 0; soloShown = false; hostLeftOnPurpose = false;
    showCountdown(null);
    closeModal();
    showSetup();
  }

  function showRoomMenu() {
    const a = game && game.s.awaiting;
    const cover = mode === 'host' && a && a.p != null && presence[a.p] === false && (a.type === 'decide' || a.type === 'target');
    const coverBtn = cover ? `<button class="btn ghost" id="mCover">Move for ${esc(game.s.players[a.p].name)} (away)</button>` : '';
    openModal(`<h2>Room ${esc(Net.code || '')}</h2><div class="menu-list">
      ${coverBtn}
      <button class="btn ghost" id="mRules">How to play</button>
      <button class="btn ghost" id="mShare">Share this game</button>
      <button class="btn ghost" id="mLeave" style="color:var(--bad)">Leave the game</button>
      <button class="btn primary" id="mBack">Back to the table</button></div>`, (m) => {
      m.querySelector('#mRules').onclick = showRules;
      m.querySelector('#mShare').onclick = shareApp;
      const cb = m.querySelector('#mCover');
      if (cb) cb.onclick = () => { closeModal(); hostCover(); };
      m.querySelector('#mLeave').onclick = () => {
        const host = mode === 'host';
        if (host && nextHostSeat() != null) { askHostLeave(false); return; }
        openModal(`<h2>${host ? 'End the game?' : 'Leave the game?'}</h2><p>${host ? 'Everyone in the room will be sent back to the menu.' : 'Your seat stays open, so you can rejoin with the code while the game is on.'}</p>
          <div class="mbtns"><button class="btn pink" id="mYes">${host ? 'End game' : 'Leave'}</button><button class="btn ghost" id="mNo">Keep playing</button></div>`, (mm) => {
          mm.querySelector('#mYes').onclick = () => leaveRoom();
          mm.querySelector('#mNo').onclick = () => { closeModal(); settle(); };
        }, '', backToTable);
      };
      m.querySelector('#mBack').onclick = () => { closeModal(); settle(); };
    }, '', backToTable);
  }

  // ---------- one game at a time ----------
  // A phone can have a one-phone game OR an online game going, never both. Starting one while the
  // other is still saved asks first.
  function localGameSaved() {
    const s = store.get(SAVE);
    return !!(s && s.players && s.phase !== 'over');
  }
  function onlineGameSaved() {
    const hosted = store.get(HOSTED);
    if (hosted && hosted.state && hosted.state.phase !== 'over' && hostedByMe(hosted)) return hosted.code;
    const room = store.get(ROOM);
    if (room && Date.now() - room.when < 12 * 3600e3) return room.code;
    return null;
  }
  function needOnlyLocal(go) {
    const code = onlineGameSaved();
    if (!code) { go(); return; }
    openModal(`<h2>Leave your online game?</h2><p>You're still in online room <b>${esc(code)}</b>. You can play one game at a time, so leave that room to start a game on this phone.</p>
      <div class="mbtns"><button class="btn pink" id="mYes">Leave room and play here</button><button class="btn ghost" id="mNo">Keep my online game</button></div>`, (m) => {
      m.querySelector('#mYes').onclick = () => { store.del(HOSTED); store.del(ROOM); closeModal(); go(); };
      m.querySelector('#mNo').onclick = () => { closeModal(); setHomeMode('online'); };
    }, '', closeModal);
  }
  function needOnlyOnline(go) {
    if (!localGameSaved()) { go(); return; }
    openModal(`<h2>End your game on this phone?</h2><p>You have a one-phone game going. You can play one game at a time, so end it to play online.</p>
      <div class="mbtns"><button class="btn pink" id="mYes">End it and play online</button><button class="btn ghost" id="mNo">Keep my game</button></div>`, (m) => {
      m.querySelector('#mYes').onclick = () => { store.del(SAVE); closeModal(); go(); };
      m.querySelector('#mNo').onclick = () => { closeModal(); setHomeMode('local'); };
    }, '', closeModal);
  }

  // Home screen: mode tabs, the remembered name, and "rejoin/reopen" for an unfinished online game.
  function setHomeMode(m) {
    prefs.mode = m;
    store.set(PREFS, prefs);
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#onlinePane').classList.toggle('hidden', m !== 'online');
    $('#localPane').classList.toggle('hidden', m !== 'local');
  }
  function renderOnlineHome() {
    setHomeMode(prefs.mode === 'online' ? 'online' : 'local');
    if (!$('#myName').value) $('#myName').value = prefs.myName || '';
    setNetBusy(false);
    const btn = $('#btnRejoin');
    const hosted = store.get(HOSTED);
    const room = store.get(ROOM);
    let html = '';
    const hostOk = hosted && hosted.state && hosted.state.phase !== 'over' && hostedByMe(hosted);
    const lobbyOk = hosted && hosted.lobby && Date.now() - hosted.when < 12 * 3600e3;
    const roomOk = room && Date.now() - room.when < 12 * 3600e3;
    if (lobbyOk && !(roomOk && room.when > hosted.when)) {
      html = `<span class="rs-txt"><span class="rs-title">Reopen room ${esc(hosted.code)}</span><span class="rs-sub">Your friends can still join with this code</span></span>`;
      btn.onclick = () => needOnlyOnline(() => createRoom(hosted));
    } else if (hostOk && !(roomOk && room.when > hosted.when)) {
      const who = hosted.members.map((m, i) => `<b style="color:${pc(i)}">${esc(m.name)}</b>`).join(' · ');
      html = `<span class="rs-txt"><span class="rs-title">Reopen room ${esc(hosted.code)}</span><span class="rs-sub">Round ${hosted.state.round} · you're the host</span><span class="rs-who">${who}</span></span>`;
      btn.onclick = () => needOnlyOnline(() => createRoom(hosted));
    } else if (roomOk) {
      html = `<span class="rs-txt"><span class="rs-title">Rejoin room ${esc(room.code)}</span><span class="rs-sub">Pick up where you left off</span></span>`;
      btn.onclick = () => needOnlyOnline(() => joinRoom(room.code));
    }
    if (html) btn.innerHTML = html + '<span class="rs-go" aria-hidden="true">▶</span>';
    btn.classList.toggle('hidden', !html);
  }

  function initOnline() {
    Net.on('message', (d, peerId) => { if (mode === 'host') hostMsg(d, peerId); else if (mode === 'guest') guestMsg(d); });
    Net.on('leave', (peerId) => { if (mode === 'host') hostLeft(peerId); });
    Net.on('open', () => {
      if (mode !== 'guest') return;
      Net.send({ t: 'hello', cid: myCid, name: prefs.myName });
      if (lostSince && Date.now() - lostSince > 3000 && !hostLeftOnPurpose) toast(`Reconnected. You're back in the game.`, 2200);
      hostLeftOnPurpose = false;
      if (lostAsked && !$('#modalWrap').classList.contains('hidden') && $('#modal').querySelector('#mWait')) backToTable();
      showCountdown(null);
    });
    Net.on('lost', () => {
      if (mode !== 'guest') return;
      showCountdown(-1);
      if (game && !busy) render(game.s, focusP);
    });
    Net.on('error', () => { if (mode === 'host') toast('Room connection hiccup. Reconnecting…', 2500); });
    Net.on('deposed', () => {
      if (mode !== 'host') return;
      const code = Net.code;
      store.del(HOSTED);
      store.set(ROOM, { code, when: Date.now() });
      mode = 'guest';
      members = [];
      hostUndo = null;
      hostOffSince = null;
      soloShown = false;
      clearTimeout(botTimer); botKey = null; clearTimeout(graceTimer);
      closeModal();
      showCountdown(-1);
      toast("While you were away, a friend's phone took over the game. Rejoining as a player…", 4000);
      Net.rejoin(code);
    });

    document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setHomeMode(b.dataset.m)));
    $('#btnCreate').onclick = () => needOnlyOnline(() => createRoom(null));
    $('#btnJoin').onclick = () => needOnlyOnline(() => joinRoom($('#joinCode').value));
    $('#joinCode').addEventListener('input', (e) => { e.target.value = Net.cleanCode(e.target.value); });
    $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') needOnlyOnline(() => joinRoom(e.target.value)); });
    $('#myName').addEventListener('input', (e) => { prefs.myName = e.target.value; store.set(PREFS, prefs); });
    $('#lbShare').onclick = invite;
    $('#lbStart').onclick = () => { if (mode === 'host') hostStart(); };
    $('#lbLeave').onclick = () => { if (mode === 'host' && nextHostSeat() != null) askHostLeave(true); else leaveRoom(); };
    bindTarget('#lbTarget', () => lobbyTarget, (v) => {
      if (mode !== 'host') return;
      lobbyTarget = v;
      prefs.target = v;
      store.set(PREFS, prefs);
      lobbyChanged();
    });
    // Opened from a "friend wants to join" notification: reopen your room straight away.
    if (/[?&]reopen\b/.test(location.search)) {
      history.replaceState(null, '', location.pathname + (debug ? '?debug' : ''));
      const hosted = store.get(HOSTED);
      if (hosted && hostedByMe(hosted)) { prefs.mode = 'online'; setTimeout(() => createRoom(hosted), 0); }
    }
    // Opened from an invite link: fill in the code and point at the Join button.
    const m = /[?&]room=([A-Za-z]{4})\b/.exec(location.search);
    if (m) {
      prefs.mode = 'online';
      $('#joinCode').value = Net.cleanCode(m[1]);
      history.replaceState(null, '', location.pathname + (debug ? '?debug' : ''));
      setTimeout(() => toast(prefs.myName ? 'Tap <b>Join</b> to get in the game' : 'Type your name, then tap <b>Join</b>', 3000), 300);
    }
  }

  // ---------------- wiring ----------------
  $('#pMinus').onclick = () => { if (prefs.count > 2) { prefs.count--; store.set(PREFS, prefs); renderNames(); } };
  $('#pPlus').onclick = () => { if (prefs.count < MAX_PLAYERS) { prefs.count++; store.set(PREFS, prefs); renderNames(); } };
  // Target score: 100, 200 or any custom number.
  function paintTarget(sel, v) {
    document.querySelectorAll(`${sel} button`).forEach((b) => {
      const custom = b.dataset.v === 'custom';
      const on = custom ? v !== 200 : +b.dataset.v === v;
      b.classList.toggle('on', on);
      if (custom) b.textContent = on ? `${v} ✎` : 'Custom';
    });
  }
  function askTarget(current, done) {
    openModal(`<h2>Play to how many points?</h2><p>Pick any number from 25 to 1000.</p>
      <input id="mTarget" class="target-in" type="number" inputmode="numeric" min="25" max="1000" step="5" value="${current !== 200 ? current : 150}">
      <div class="mbtns"><button class="btn primary" id="mSet">Set target</button><button class="btn ghost" id="mCancel">Cancel</button></div>`, (m) => {
      const inp = m.querySelector('#mTarget');
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
      const set = () => {
        const v = Math.round(+inp.value);
        if (!(v >= 25 && v <= 1000)) { toast('Pick a number from 25 to 1000'); return; }
        closeModal();
        done(v);
      };
      m.querySelector('#mSet').onclick = set;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') set(); });
      m.querySelector('#mCancel').onclick = closeModal;
    }, '', closeModal);
  }
  function bindTarget(sel, get, set) {
    document.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.v === 'custom') askTarget(get(), set); else set(+b.dataset.v);
    }));
  }
  bindTarget('#targetSeg', () => prefs.target, (v) => { prefs.target = v; store.set(PREFS, prefs); renderNames(); });
  $('#btnStart').onclick = () => needOnlyLocal(() => {
    const names = Array.from({ length: prefs.count }, (_, i) => (prefs.names[i] || '').trim() || `Player ${i + 1}`);
    startGame(names, prefs.target);
  });
  $('#btnResume').onclick = () => needOnlyLocal(() => {
    const saved = store.get(SAVE);
    if (!saved) return;
    mode = 'local';
    mySeat = null;
    game = Game.load(saved);
    lastTurnP = null;
    showScreen('table');
    keepAwake();
    settle();
  });
  $('#btnRules').onclick = showRules;
  $('#btnShareApp').onclick = shareApp;
  $('#btnEndSaved').onclick = () => {
    openModal(`<h2>End this game and start a new one?</h2><p>The current scores will be lost.</p>
      <div class="mbtns"><button class="btn pink" id="mYes">End it and start new</button><button class="btn ghost" id="mNo">Keep playing this one</button></div>`, (m) => {
      m.querySelector('#mYes').onclick = () => { store.del(SAVE); game = null; closeModal(); showSetup(); };
      m.querySelector('#mNo').onclick = closeModal;
    }, '', closeModal);
  };
  $('#btnMenu').onclick = () => { showMenu(); };
  $('#btnSound').onclick = () => { prefs.sound = prefs.sound === false; store.set(PREFS, prefs); paintSound(); if (prefs.sound) sfx.turn(); toast(prefs.sound ? 'Sound and buzz on' : 'Sound and buzz off', 1400); };
  paintSound();
  ['#btnFlip', '#btnClose', '#btnSkip'].forEach((q) => $(q).addEventListener('click', hideTip));

  const canAct = () => !busy && !pendingAct && game && game.s.awaiting && game.s.awaiting.type === 'decide' && isMine(game.s.awaiting.p) && (mode !== 'guest' || Net.connected);
  function doFlip() {
    if (!canAct()) return;
    clearUndo();
    act('hit');
  }

  // One tap flips.
  $('#btnFlip').addEventListener('click', doFlip);

  $('#btnClose').onclick = () => {
    if (!canAct()) return;
    clearUndo();
    if (mode !== 'local') { undo = { online: true, timer: null, pending: true }; act('stay'); return; }
    const snap = JSON.stringify(game.s);
    game.stay();
    undo = { snap, timer: null, pending: true };
    pump();
  };
  $('#undo').onclick = doUndo;
  addEventListener('resize', () => { if (game && $('#table').classList.contains('active')) layoutSeats(); });
  $('#btnSkip').onclick = () => {
    if (!canAct() || !game.canSkip(game.s.awaiting.p)) return;
    clearUndo();
    act('skip');
  };
  // Tap a score chip to peek at that player's cards.
  $('#rail').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || busy || !game) return;
    render(game.s, +chip.dataset.i);
  });

  // ---------------- install app ----------------
  // Android / desktop Chrome: use the browser's own install prompt. iPhone: there's no prompt,
  // so show the two taps it takes in Safari. Hidden once the app is installed.
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvt = null;
  const isPhone = isIOS || matchMedia('(pointer: coarse)').matches;
  function showInstallBtn() { $('#btnInstall').classList.toggle('hidden', NATIVE || installed() || !(installEvt || isPhone)); }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showInstallBtn(); });
  addEventListener('appinstalled', () => { installEvt = null; showInstallBtn(); toast('Installed! Open Streak or Bust from your home screen'); });
  const shareIcon = '<svg class="ios-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M7 11H5v10h14V11h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  $('#btnInstall').onclick = async () => {
    if (installEvt) {
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) { /* ignore */ }
      installEvt = null;
      showInstallBtn();
      return;
    }
    openModal(`<h2>Install the app</h2><div class="steps">
      <div class="step"><span class="n">1</span><span>Tap your browser's <b>Share</b> button ${shareIcon} or its <b>⋮</b> menu.</span></div>
      <div class="step"><span class="n">2</span><span>Tap <b>Add to Home Screen</b>. You may need to scroll down to find it.</span></div>
      <div class="step"><span class="n">3</span><span>Tap <b>Add</b>. The game shows up on your home screen like any other app.</span></div>
      </div><div class="mbtns"><button class="btn primary" id="mOk">Got it</button></div>`, (m) => { m.querySelector('#mOk').onclick = closeModal; }, '', closeModal);
  };
  showInstallBtn();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // Testing hook: open with ?debug to get window.__deal(names, cardsInDrawOrder).
  if (debug) {
    // Load any game state straight onto the table (for layout checks).
    window.__load = (state) => { mode = 'local'; mySeat = null; game = Game.load(state); lastTurnP = null; closeModal(); showScreen('table'); settle(); };
    window.__summary = () => showSummary();
    window.__state = () => (game ? JSON.parse(JSON.stringify(game.s)) : null);
    window.__winCard = async () => URL.createObjectURL(await winCard(game.s));
    window.__sfx = sfx;
    window.__picker = (action) => { const s = game.s; showTarget({ p: 0, action, card: { kind: action }, options: s.players.map((_, i) => i) }); };
    window.__shuffle = () => {
      // Demo with a realistic size: every card that isn't on the table right now.
      const onTable = game ? game.s.players.reduce((n, p) => n + p.cards.length + p.shields.length + (p.bust ? 1 : 0), 0) : 0;
      return shuffleAnim({ deck: StreakOrBust.buildDeck().slice(0, 94 - onTable) });
    };
    window.__deal = (names, cards, target = 200) => {
      const filler = StreakOrBust.buildDeck().filter((c) => c.kind === 'num');
      startGame(names, target, filler.concat(cards.slice().reverse()));
    };
  }
  initOnline();
  showSetup();
})();
