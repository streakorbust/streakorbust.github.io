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
    const anim = el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.25) rotate(-8deg)`, opacity: 0.6 }], { duration: 460, easing: 'cubic-bezier(.4, 0, .2, 1)' });
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
  function banner(title, sub, color) {
    const el = $('#banner');
    el.style.setProperty('--pc', color);
    el.innerHTML = `<div class="inner"><small>${esc(sub)}</small><b>${esc(title)}</b></div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  let revealToken = 0;
  function showReveal(card) {
    const el = $('#reveal');
    revealToken++;
    el.className = '';
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
    const used = turnP != null && s.players[turnP].skipUsed;
    const skipOk = canAct && game && game.canSkip(turnP);
    $('#btnSkip').classList.toggle('off', !skipOk);
    $('#skipSub').textContent = used ? 'used' : turnP != null && !skipOk ? 'last one in' : '1 per round';
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
        + (online && presence[i] === false && p.status !== 'sitout' ? '<span class="tag-s bot">BOT</span>' : '')
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
        await sleep(1100);
        break;
      }
      case 'reshuffle':
        await shuffleAnim(s);
        break;
      case 'turn':
        render(s, ev.p);
        focusP = ev.p;
        if (ev.p !== lastTurnP) {
          if (mode === 'local') banner(s.players[ev.p].name, 'Your turn', pc(ev.p));
          else if (ev.p === mySeat) banner('Your turn', s.players[ev.p].name, pc(ev.p));
          else banner(s.players[ev.p].name, 'is up', pc(ev.p));
          await sleep(500);
        }
        lastTurnP = ev.p;
        break;
      case 'draw':
        focusP = ev.p;
        dealing = ev.deal;
        render(s, ev.p);
        showReveal(ev.card);
        await sleep(ev.deal ? 560 : 680);
        break;
      case 'place':
        if (dealing) flyToChip(ev.card, ev.p); else hideReveal(true);
        render(s, ev.p, ev.card.id);
        if (ev.card.kind === 'shield') toast(`${nm(ev.p)} is holding a Lifeline`);
        await sleep(ev.card.kind === 'num' ? 300 : 500);
        break;
      case 'bust': {
        // The duplicate swells and glows red, then splits and the halves drift apart; the hand
        // pulses red under a BUST stamp.
        $('#reveal').classList.add('busting');
        flash('red');
        await sleep(420);
        shatterReveal();
        render(s, ev.p, ev.card.id);
        const seat = $(`#seats .seat[data-i="${ev.p}"]`);
        if (seat) seat.classList.add('busting');
        stamp('BUST!', 'bust', `Another ${ev.card.value}`, ev.p);
        await sleep(1150);
        break;
      }
      case 'saved':
        stamp('SAVED!', 'saved', 'Lifeline used up', ev.p);
        toast(`A Lifeline saved ${nm(ev.p)}`);
        flash('gold');
        await sleep(700);
        hideReveal(true);
        render(s, ev.p);
        await sleep(700);
        break;
      case 'sweep':
        hideReveal(true);
        render(s, ev.p, ev.card.id);
        stamp('CLEAN SWEEP!', 'sweep', '+15 bonus', ev.p);
        flash('gold'); fx.burst(200);
        await sleep(2100);
        break;
      case 'setAside':
        toast(`${ACTION_NAME[ev.card.kind]} waits until these 3 cards are done`);
        await sleep(800);
        hideReveal(true);
        await sleep(250);
        break;
      case 'chooseTarget':
        // The picker that follows says once, clearly, who drew the card.
        await sleep(700);
        hideReveal(true);
        await sleep(250);
        break;
      case 'lock': {
        hideReveal(true);
        focusP = ev.t;
        render(s, ev.t);
        stamp('CHILLED', 'lock', null, ev.t);
        flash('ice');
        const pts = breakdown(s.players[ev.t]).score;
        toast(ev.auto && ev.t === ev.p
          ? `${nm(ev.t)} is the only one left and has to take it. Chilled with ${pts}`
          : ev.t === ev.p ? `${nm(ev.t)} chilled themselves with ${pts}` : `${nm(ev.p)} chilled ${nm(ev.t)}, who keeps ${pts}`, 2400);
        await sleep(1500);
        break;
      }
      case 'rush':
        hideReveal(true);
        focusP = ev.t;
        render(s, ev.t);
        stamp('HAT TRICK!', 'rush', '3 cards in a row', ev.t);
        toast(ev.auto && ev.t === ev.p
          ? `${nm(ev.t)} is the only one left and has to take 3 cards!`
          : ev.t === ev.p ? `${nm(ev.t)} takes the Hat Trick: 3 cards in a row!` : `${nm(ev.p)} makes ${nm(ev.t)} take 3 cards!`, 2200);
        await sleep(1400);
        break;
      case 'rushDone':
        await sleep(150);
        break;
      case 'giveShield':
        hideReveal(true);
        render(s, ev.t, ev.card.id);
        toast(`${nm(ev.p)} already had one, so ${nm(ev.t)} gets the Lifeline`, 2200);
        await sleep(1100);
        break;
      case 'discardAction':
        hideReveal(true);
        toast(ev.extra ? `${nm(ev.p)} already has a Lifeline, so the extra one is discarded` : `Nobody can take the ${ACTION_NAME[ev.card.kind]}, so it's discarded`);
        await sleep(1000);
        break;
      case 'stay':
        render(s, ev.p);
        toast(ev.forced ? `Out of cards, so ${nm(ev.p)} closes` : `${nm(ev.p)} closes with <b>${breakdown(s.players[ev.p]).score}</b>`);
        await sleep(750);
        break;
      case 'skip':
        render(s, ev.p);
        toast(`${nm(ev.p)} skips this turn`);
        await sleep(650);
        break;
      case 'roundEnd':
        hideReveal(false);
        render(s, focusP);
        await sleep(450);
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
    // Left for the home screen while animations were finishing: keep the save, but don't pop
    // in-game sheets over the menu. Continue picks up from here.
    if (!$('#table').classList.contains('active')) { heart.stop(); return; }
    if (!a) return;
    if (a.type === 'decide' && isMine(a.p)) {
      const n = numsOf(s.players[a.p]);
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
  function openModal(html, onBind, cls = '') {
    $('#modal').className = cls;
    $('#modal').innerHTML = html;
    $('#modalWrap').classList.remove('hidden');
    $('#modal').scrollTop = 0;
    if (onBind) onBind($('#modal'));
  }
  function closeModal() { $('#modalWrap').classList.add('hidden'); $('#modal').innerHTML = ''; $('#modal').className = ''; }

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
        <div class="pm">${n}/7 numbers${p.shields.length ? ` · ${p.shields.length} Lifeline${p.shields.length > 1 ? 's' : ''}` : ''}</div></div>
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

  function showSummary() {
    const s = game.s;
    const sum = s.summary;
    const over = s.phase === 'over';
    const rows = sum.rows.slice().sort((x, y) => y.after - x.after);
    const lead = rows[0].after;
    const rowsHTML = rows.map((r) => {
      const p = s.players[r.i];
      let detail;
      if (r.busted) detail = `Busted on a second ${p.bust ? p.bust.value : ''}${r.mods.length ? ` · kept ${r.mods.map((m) => `+${m}`).join(' ')}` : ''}`;
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
      if (rowsA.length) achHTML = `<h3 style="margin:4px 0 8px">Badges earned</h3><div class="achlist">${rowsA.map((r) =>
        `<div class="achrow" style="--pc:${pc(r.i)}"><span class="an">${esc(r.p.name)}</span><div class="achchips">${r.list.map((id) => `<span class="achchip">${ACH[id][0]} ${ACH[id][1]}</span>`).join('')}</div></div>`).join('')}</div>`;
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
    openModal(`${head}${momentHTML}<div class="sumrows">${rowsHTML}</div>${achHTML}<div class="mbtns">${btns}</div>`, (m) => {
      requestAnimationFrame(() => m.querySelectorAll('.bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }));
      countUp(m.querySelectorAll('.st'));
      if (over) { fx.burst(260, 0.3); setTimeout(() => fx.burst(180, 0.35), 700); }
      const nx = m.querySelector('#mNext');
      if (nx) nx.addEventListener('click', () => { clearUndo(); closeModal(); act('next'); });
      const rm = m.querySelector('#mRematch');
      if (rm) rm.addEventListener('click', () => { clearUndo(); closeModal(); if (mode === 'host') hostStart(); else startGame(s.players.map((p) => p.name), s.target); });
      const lv = m.querySelector('#mLeave');
      if (lv) lv.addEventListener('click', () => leaveRoom());
      const nw = m.querySelector('#mNew');
      if (nw) nw.addEventListener('click', () => { clearUndo(); closeModal(); store.del(SAVE); game = null; showSetup(); });
    }, s.players.length >= 4 ? 'results many' : 'results');
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

  const RULES_HTML = `<h2>How to play</h2><div class="rules">
    <p class="lead">Flip cards and try to collect as many different numbers as you can. Flip a number you already have and you bust. First to the target score wins.</p>
    <h3>Your turn</h3><ul>
      <li><b>Flip</b> to take the next card.</li>
      <li><b>Close</b> to lock in your points and sit out the rest of the round. Nobody can hit you with action cards after that. Tapped it by accident? You have 5 seconds to undo.</li>
      <li><b>Skip</b> to pass without flipping. You can do this once a round, and you stay in. You can't skip if you're the last one left.</li></ul>
    <h3>Busting</h3><ul>
      <li>If you flip a number you already have, you bust. You lose your numbers and your ×2 for the round, but you still keep your + cards.</li></ul>
    <h3>Clean Sweep</h3><ul>
      <li>Get 7 different numbers and the round ends right away. You get an extra <b>15 points</b>.</li></ul>
    <h3>Scoring</h3>
    <div class="minis">${cardHTML({ kind: 'num', value: 3 })}${cardHTML({ kind: 'num', value: 9 })}${cardHTML({ kind: 'x2' })}${cardHTML({ kind: 'mod', value: 4 })}</div>
    <ul><li>Add up your numbers, double them if you have a ×2, then add your + cards. The ×2 only doubles number cards, never your + cards.</li>
      <li>So the hand above is worth (3 + 9) × 2 + 4 = <b>28</b>.</li></ul>
    <h3>Action cards</h3>
    <div class="minis">${cardHTML({ kind: 'lock' })}${cardHTML({ kind: 'rush' })}${cardHTML({ kind: 'shield' })}</div>
    <ul><li><b>Chill</b>: pick anyone who's still in, including yourself. They keep their points but they're done for the round.</li>
      <li><b>Hat Trick</b>: pick anyone who's still in. They have to flip 3 cards in a row. If they flip an action card along the way, it waits until all 3 are done.</li>
      <li><b>Lifeline</b>: keep it. The next time you'd bust, it saves you, and that Lifeline and the repeat number go to the discard pile. Keep every Lifeline you draw. Each one saves you once.</li>
      <li>If you're the only one left in the round, you have to use Chill or Hat Trick on yourself.</li></ul>
    <h3>How a round works</h3><ul>
      <li>Everyone gets one card to start, then you take turns around the table. The round is over once everyone has closed, busted or been chilled, or as soon as someone gets a Clean Sweep.</li>
      <li>When someone hits the target score at the end of a round, the game is over and the highest score wins. If it's a tie, keep playing.</li></ul>
    <h3>Playing online</h3><ul>
      <li>If your phone drops out, open the app again and tap <b>Rejoin</b>. Your seat will be waiting.</li>
      <li>While you're gone, a bot plays your turns so nobody has to wait. You'll see a <b>BOT</b> tag on your seat.</li>
      <li>When you come back you're marked <b>Rejoining</b>, and you take over again on your next turn.</li>
      <li>If you're gone for more than 3 minutes, you sit out until you're back. Your score stays where it was, and you're dealt back in the next round.</li>
      <li>The host's phone runs the game, so if the host leaves, everyone waits for them to come back.</li></ul>
    <h3>The deck</h3><ul>
      <li>There are 94 cards. Number cards go from 0 to 12, and each number has as many copies as its value: one 1, two 2s, all the way up to twelve 12s, plus a single 0.</li>
      <li>There's one each of +2, +4, +6, +8, +10 and ×2, and three each of Chill, Hat Trick and Lifeline.</li>
      <li>When the deck runs out, the discard pile gets shuffled to make a new one.</li></ul>
  </div><div class="mbtns" style="margin-top:16px"><button class="btn primary" id="mOk">Got it</button></div>`;

  function showRules() {
    openModal(RULES_HTML, (m) => m.querySelector('#mOk').addEventListener('click', closeModal));
  }

  function showMenu() {
    heart.stop();
    if (mode !== 'local') { showRoomMenu(); return; }
    openModal(`<h2>Menu</h2><div class="menu-list">
      <button class="btn ghost" id="mRules">How to play</button>
      <button class="btn ghost" id="mHome">Main menu (game is saved)</button>
      <button class="btn ghost" id="mEnd" style="color:var(--bad)">End this game</button>
      <button class="btn primary" id="mBack">Back to the table</button></div>`, (m) => {
      m.querySelector('#mRules').onclick = showRules;
      m.querySelector('#mHome').onclick = () => { closeModal(); showSetup(); };
      m.querySelector('#mEnd').onclick = () => {
        openModal(`<h2>End this game?</h2><p>Scores will be lost.</p><div class="mbtns"><button class="btn pink" id="mYes">End game</button><button class="btn ghost" id="mNo">Keep playing</button></div>`, (mm) => {
          mm.querySelector('#mYes').onclick = () => { store.del(SAVE); game = null; closeModal(); showSetup(); };
          mm.querySelector('#mNo').onclick = () => { closeModal(); settle(); };
        });
      };
      m.querySelector('#mBack').onclick = () => { closeModal(); settle(); };
    });
  }

  // ---------------- screens ----------------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  }

  function showSetup() {
    showScreen('setup');
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
        <div class="rc-txt"><div class="rc-title"><b style="color:${pc(winner.i)}">${esc(winner.name)}</b> won last game!</div></div>
        ${hasSave ? '' : '<button class="rc-again" id="btnPlayAgain">Play again</button>'}</div>
      <div class="rc-rows">${ranked.map((p) => `<div class="rc-row" style="--pc:${pc(p.i)}"><span class="rc-name">${esc(p.name)}</span>
        <span class="rc-bar"><i data-w="${Math.round((p.total / top) * 100)}"></i></span><span class="rc-pts">${p.total}</span></div>`).join('')}</div>`;
    setTimeout(() => box.querySelectorAll('.rc-bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }), 60);
    const again = box.querySelector('#btnPlayAgain');
    if (again) again.onclick = () => startGame(last.players.map((p) => p.name), last.target);
  }

  function renderNames() {
    $('#pCount').textContent = prefs.count;
    $('#pPlus').disabled = prefs.count >= MAX_PLAYERS; // 4 players max
    $('#pMinus').disabled = prefs.count <= 2;
    const wrap = $('#names');
    wrap.classList.toggle('two-col', prefs.count > 2);
    wrap.innerHTML = Array.from({ length: prefs.count }, (_, i) =>
      `<div class="nameIn" style="color:${pc(i)}"><span class="sw"></span><input maxlength="14" autocomplete="off" autocapitalize="words" placeholder="Player ${i + 1}" value="${esc(prefs.names[i] || '')}" data-i="${i}"></div>`).join('');
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

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (mode !== 'local') Net.wake();
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
    if (!aw) return;
    if (a === 'undo') {
      if (!hostUndo || hostUndo.seat !== seat || aw.type !== 'decide') return; // a finished round can't be undone
      game = Game.load(JSON.parse(hostUndo.snap));
      hostUndo = null;
      closeModal();
      lastTurnP = game.s.awaiting.p;
      Net.broadcast({ t: 'sync', state: strip(game.s), seats: seatCids(), presence, undoBy: seat });
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
  // While someone's phone is disconnected, the host's phone plays their turns right away with a
  // simple bot (they're tagged BOT). When they reconnect they're tagged REJOINING, and they take
  // over again at the start of their next turn. Gone 3+ minutes: they sit out from the next round.
  const BOT_DELAY_MS = 1300;
  const SIT_OUT_MS = 3 * 60000;
  let botTimer = null;
  let botKey = null;
  let rejoining = []; // guests: seats whose player is back but waiting for their next turn

  // Is the bot in charge of this seat for the current decision?
  let botHoldUntil = 0;
  function botRuns(seat, a) {
    const m = members[seat];
    if (!m || m.cid === myCid || Date.now() < botHoldUntil) return false;
    if (!m.on) return true;
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

  // Shown on guests while the host's phone is unreachable.
  function showCountdown(p) {
    const el = $('#awayNote');
    if (p == null || !game) { el.classList.remove('show'); return; }
    el.innerHTML = 'Waiting for the host to come back…';
    el.classList.add('show');
  }
  // Host: every few seconds, sit out anyone who's been gone too long.
  setInterval(() => {
    if (mode !== 'host' || !game) return;
    let changed = false;
    members.forEach((m, i) => {
      const p = game.s.players[i];
      if (!m.on && m.awaySince && Date.now() - m.awaySince >= SIT_OUT_MS && p && !p.out) {
        p.out = true;
        changed = true;
        toast(`<b>${esc(m.name)}</b> has been gone 3 minutes and sits out until they're back`, 3200);
      }
    });
    if (changed) { saveHosted(); Net.broadcast({ t: 'sitout', out: game.s.players.map((p) => !!p.out) }); }
  }, 5000);

  function saveHosted() {
    if (mode !== 'host' || !game) return;
    store.set(HOSTED, { code: Net.code, members: members.map(({ cid, name }) => ({ cid, name })), target: game.s.target, state: game.s, when: Date.now() });
  }

  function presenceChanged() {
    presence = members.map((m) => m.cid === myCid || m.on);
    rejoining = members.map((m) => !!(m.on && m.rejoin));
    Net.broadcast({ t: 'presence', on: presence, rejoin: rejoining });
    if (game && !busy && $('#table').classList.contains('active')) render(game.s, focusP);
  }

  function lobbyChanged() {
    Net.broadcast({ t: 'lobby', members: members.map(({ cid, name }) => ({ cid, name })), target: lobbyTarget });
    if ($('#lobby').classList.contains('active')) renderLobby();
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
        m.peer = peerId; m.on = true; m.awaySince = null;
        if (wasOff && !m.fresh) m.rejoin = true; // takes over again at the start of their next turn
        const fresh = m.fresh;
        m.fresh = false;
        const seatP = game.s.players[members.indexOf(m)];
        const wasOut = seatP && seatP.out;
        if (seatP) seatP.out = false;
        Net.sendTo(peerId, { t: 'sync', state: strip(game.s), seats: seatCids(), presence: members.map((x) => x.cid === myCid || x.on), rejoin: members.map((x) => !!(x.on && x.rejoin)) });
        presenceChanged();
        if (wasOff && !fresh) toast(wasOut && seatP.status === 'sitout' ? `<b>${esc(m.name)}</b> is back and gets dealt in next round` : `<b>${esc(m.name)}</b> is back and takes over on their next turn`);
        hostWatch();
        return;
      }
      if (!m) {
        if (members.length >= MAX_PLAYERS) { Net.sendTo(peerId, { t: 'refuse', why: 'full' }); Net.kick(peerId); return; }
        m = { cid, name, peer: peerId, on: true };
        members.push(m);
      } else { m.peer = peerId; m.on = true; m.name = name; }
      lobbyChanged();
      return;
    }
    const m = members.find((x) => x.peer === peerId);
    if (!m || !game) return;
    if (d.t === 'act') hostApply(members.indexOf(m), String(d.a), Number(d.i));
  }

  function hostLeft(peerId) {
    const m = members.find((x) => x.peer === peerId);
    if (!m) return;
    m.peer = null;
    if (!game) { members = members.filter((x) => x !== m); lobbyChanged(); return; }
    m.on = false;
    m.awaySince = Date.now();
    presenceChanged();
    hostWatch();
    toast(`<b>${esc(m.name)}</b> dropped out. A bot is playing for them until they're back.`, 3200);
  }

  function hostStart() {
    if (members.length < 2) return;
    clearUndo();
    hostUndo = null;
    mySeat = members.findIndex((m) => m.cid === myCid);
    const names = members.map((m) => m.name);
    game = new Game(names, { target: lobbyTarget, dealer: names.length - 1 });
    game.s.x = { ach: {}, moments: [], maxDef: [] };
    presence = members.map((m) => m.cid === myCid || m.on);
    Net.broadcast({ t: 'start', state: strip(game.s), seats: seatCids(), presence });
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
      case 'lobby':
        lobbyData = d;
        if (!game) showLobby();
        break;
      case 'start':
        clearPending();
        clearUndo();
        mySeat = d.seats.indexOf(myCid);
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
        presence = d.presence || presence;
        game = Game.load(d.state);
        const a = game.s.awaiting;
        lastTurnP = a && a.p != null ? a.p : null;
        closeModal();
        if (!$('#table').classList.contains('active')) { showScreen('table'); keepAwake(); }
        if (d.rejoin) rejoining = d.rejoin;
        if (rejoining[mySeat]) toast("You're back! You'll take over on your next turn", 3000);
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
      case 'presence':
        presence = d.on || [];
        rejoining = d.rejoin || [];
        if (game && !busy && $('#table').classList.contains('active')) render(game.s, focusP);
        break;
      case 'refuse':
        toast(d.why === 'full' ? 'That room is full (4 players max)' : 'That game has already started', 3000);
        leaveRoom(true);
        break;
      case 'end':
        toast('The host ended the game', 3000);
        leaveRoom(true);
        break;
    }
  }

  // ---------- lobby ----------
  function showLobby() {
    showScreen('lobby');
    renderLobby();
  }
  function renderLobby() {
    const isHost = mode === 'host';
    const list = isHost ? members : lobbyData ? lobbyData.members : [];
    const target = isHost ? lobbyTarget : lobbyData ? lobbyData.target : 200;
    $('#lobby').classList.toggle('is-host', isHost);
    $('#lbCode').textContent = Net.code || '····';
    $('#lbCount').textContent = list.length ? `${list.length} of ${MAX_PLAYERS}` : '';
    $('#lbPlayers').innerHTML = list.map((m, i) => `<div class="lb-p" style="--pc:${pc(i)}"><span class="sw"></span><span class="lb-n">${esc(m.name)}</span>`
      + `${i === 0 ? '<span class="tag-s dealer">Host</span>' : ''}${m.cid === myCid ? '<span class="tag-s you">You</span>' : ''}</div>`).join('')
      + (list.length < MAX_PLAYERS ? `<div class="lb-p empty"><span class="sw"></span><span class="lb-n">${list.length ? 'Waiting for friends…' : 'Connecting…'}</span></div>` : '');
    paintTarget('#lbTarget', target);
    $('#lbNote').textContent = isHost
      ? (list.length < 2 ? 'Send friends the code or invite link. You need at least 2 players.' : `Ready when you are. First to ${target} wins.`)
      : `Waiting for ${list[0] ? list[0].name : 'the host'} to start. First to ${target} wins.`;
    $('#lbStart').disabled = list.length < 2;
  }

  const roomLink = () => `${location.origin}${location.pathname}?room=${Net.code}`;
  async function invite() {
    const url = roomLink();
    try {
      if (navigator.share) { await navigator.share({ title: 'Streak or Bust', text: `Join my Streak or Bust game. Room code: ${Net.code}`, url }); return; }
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
      await Net.host(reopen ? reopen.code : null);
    } catch (e) {
      if (epoch !== netEpoch) return;
      mode = 'local';
      setNetBusy(false);
      toast(reopen && e.type === 'unavailable-id' ? 'That room is still closing. Try again in a moment.' : netError(e), 3200);
      return;
    }
    if (epoch !== netEpoch) return;
    setNetBusy(false);
    if (reopen) {
      members = reopen.members.map((m) => ({ cid: m.cid, name: m.name, peer: null, on: m.cid === myCid, fresh: true }));
      botHoldUntil = Date.now() + 15000; // friends' phones reconnect on their own; don't play for them yet
      setTimeout(hostWatch, 15100);
      mySeat = members.findIndex((m) => m.cid === myCid);
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
    try {
      await Net.join(code);
    } catch (e) {
      if (epoch !== netEpoch) return;
      mode = 'local';
      setNetBusy(false);
      toast(netError(e) || `No room found with code <b>${esc(code)}</b>`, 3200);
      return;
    }
    if (epoch !== netEpoch) return;
    setNetBusy(false);
    store.set(ROOM, { code, when: Date.now() });
    if (!game && !$('#lobby').classList.contains('active')) showLobby();
  }

  // silent: the room ended on the other side, just tidy up.
  function leaveRoom(silent) {
    const was = mode;
    if (was === 'host') { Net.broadcast({ t: 'end' }); store.del(HOSTED); }
    if (was === 'guest') store.del(ROOM);
    const epoch = netEpoch;
    setTimeout(() => { if (epoch === netEpoch) Net.leave(); }, was === 'host' && !silent ? 400 : 0);
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
    showCountdown(null);
    closeModal();
    showSetup();
  }

  function showRoomMenu() {
    const a = game && game.s.awaiting;
    const cover = mode === 'host' && a && a.p != null && presence[a.p] === false && (a.type === 'decide' || a.type === 'target');
    const coverBtn = cover ? `<button class="btn ghost" id="mCover">Move for ${esc(game.s.players[a.p].name)} (away)</button>` : '';
    openModal(`<h2>Room ${esc(Net.code || '')}</h2><div class="menu-list">
      <button class="btn ghost" id="mInvite">Invite friends</button>
      ${coverBtn}
      <button class="btn ghost" id="mRules">How to play</button>
      <button class="btn ghost" id="mLeave" style="color:var(--bad)">${mode === 'host' ? 'End the game for everyone' : 'Leave the game'}</button>
      <button class="btn primary" id="mBack">Back to the table</button></div>`, (m) => {
      m.querySelector('#mInvite').onclick = invite;
      m.querySelector('#mRules').onclick = showRules;
      const cb = m.querySelector('#mCover');
      if (cb) cb.onclick = () => { closeModal(); hostCover(); };
      m.querySelector('#mLeave').onclick = () => {
        const host = mode === 'host';
        openModal(`<h2>${host ? 'End the game?' : 'Leave the game?'}</h2><p>${host ? 'Everyone in the room will be sent back to the menu.' : 'Your seat stays open, so you can rejoin with the code while the game is on.'}</p>
          <div class="mbtns"><button class="btn pink" id="mYes">${host ? 'End game' : 'Leave'}</button><button class="btn ghost" id="mNo">Keep playing</button></div>`, (mm) => {
          mm.querySelector('#mYes').onclick = () => leaveRoom();
          mm.querySelector('#mNo').onclick = () => { closeModal(); settle(); };
        });
      };
      m.querySelector('#mBack').onclick = () => { closeModal(); settle(); };
    });
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
    const hostOk = hosted && hosted.state && hosted.state.phase !== 'over' && hosted.members[0] && hosted.members[0].cid === myCid;
    const roomOk = room && Date.now() - room.when < 12 * 3600e3;
    if (hostOk && !(roomOk && room.when > hosted.when)) {
      const who = hosted.members.map((m, i) => `<b style="color:${pc(i)}">${esc(m.name)}</b>`).join(' · ');
      html = `<span class="rs-txt"><span class="rs-title">Reopen room ${esc(hosted.code)}</span><span class="rs-sub">Round ${hosted.state.round} · you're the host</span><span class="rs-who">${who}</span></span>`;
      btn.onclick = () => createRoom(hosted);
    } else if (roomOk) {
      html = `<span class="rs-txt"><span class="rs-title">Rejoin room ${esc(room.code)}</span><span class="rs-sub">Pick up where you left off</span></span>`;
      btn.onclick = () => joinRoom(room.code);
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
      $('#lbConn').textContent = '';
      showCountdown(null);
    });
    Net.on('lost', () => {
      if (mode !== 'guest') return;
      $('#lbConn').textContent = 'Reconnecting…';
      if (game) { showCountdown(-1); if (!busy) render(game.s, focusP); } else toast('Lost the connection. Reconnecting…', 3000);
    });
    Net.on('error', () => { if (mode === 'host') toast('Room connection hiccup. Reconnecting…', 2500); });

    document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setHomeMode(b.dataset.m)));
    $('#btnCreate').onclick = () => createRoom(null);
    $('#btnJoin').onclick = () => joinRoom($('#joinCode').value);
    $('#joinCode').addEventListener('input', (e) => { e.target.value = Net.cleanCode(e.target.value); });
    $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value); });
    $('#myName').addEventListener('input', (e) => { prefs.myName = e.target.value; store.set(PREFS, prefs); });
    $('#lbShare').onclick = invite;
    $('#lbStart').onclick = () => { if (mode === 'host') hostStart(); };
    $('#lbLeave').onclick = () => leaveRoom();
    bindTarget('#lbTarget', () => lobbyTarget, (v) => {
      if (mode !== 'host') return;
      lobbyTarget = v;
      prefs.target = v;
      store.set(PREFS, prefs);
      lobbyChanged();
    });
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
      const on = custom ? v !== 100 && v !== 200 : +b.dataset.v === v;
      b.classList.toggle('on', on);
      if (custom) b.textContent = on ? `${v} ✎` : 'Custom';
    });
  }
  function askTarget(current, done) {
    openModal(`<h2>Play to how many points?</h2><p>Pick any number from 25 to 1000.</p>
      <input id="mTarget" class="target-in" type="number" inputmode="numeric" min="25" max="1000" step="5" value="${current !== 100 && current !== 200 ? current : 150}">
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
    });
  }
  function bindTarget(sel, get, set) {
    document.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.v === 'custom') askTarget(get(), set); else set(+b.dataset.v);
    }));
  }
  bindTarget('#targetSeg', () => prefs.target, (v) => { prefs.target = v; store.set(PREFS, prefs); renderNames(); });
  $('#btnStart').onclick = () => {
    const names = Array.from({ length: prefs.count }, (_, i) => (prefs.names[i] || '').trim() || `Player ${i + 1}`);
    startGame(names, prefs.target);
  };
  $('#btnResume').onclick = () => {
    const saved = store.get(SAVE);
    if (!saved) return;
    mode = 'local';
    mySeat = null;
    game = Game.load(saved);
    lastTurnP = null;
    showScreen('table');
    keepAwake();
    settle();
  };
  $('#btnRules').onclick = showRules;
  $('#btnEndSaved').onclick = () => {
    openModal(`<h2>End this game and start a new one?</h2><p>The current scores will be lost.</p>
      <div class="mbtns"><button class="btn pink" id="mYes">End it and start new</button><button class="btn ghost" id="mNo">Keep playing this one</button></div>`, (m) => {
      m.querySelector('#mYes').onclick = () => { store.del(SAVE); game = null; closeModal(); showSetup(); };
      m.querySelector('#mNo').onclick = closeModal;
    });
  };
  $('#btnMenu').onclick = () => { showMenu(); };

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
  function showInstallBtn() { $('#btnInstall').classList.toggle('hidden', installed() || !(installEvt || isIOS)); }
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
    const safari = isIOS && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    openModal(`<h2>Install the app</h2><div class="steps">
      ${safari ? '' : '<p class="step-note">On iPhone, this works best in <b>Safari</b>. Open this page there first.</p>'}
      <div class="step"><span class="n">1</span><span>Tap the <b>Share</b> button ${shareIcon} at the bottom of the screen.</span></div>
      <div class="step"><span class="n">2</span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></div>
      <div class="step"><span class="n">3</span><span>Tap <b>Add</b>. The game shows up on your home screen like any other app.</span></div>
      </div><div class="mbtns"><button class="btn primary" id="mOk">Got it</button></div>`, (m) => { m.querySelector('#mOk').onclick = closeModal; });
  };
  showInstallBtn();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // Testing hook: open with ?debug to get window.__deal(names, cardsInDrawOrder).
  if (debug) {
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
