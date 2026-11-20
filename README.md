# Streak or Bust

**Play:** https://streakorbust.com/

A push-your-luck card game for 2 to 4 players. Play live online with friends (each on their own phone), or pass one phone around. It installs as an app from the browser, with no App Store needed.

## Play online

1. One person taps **Create a room** and shares the 4-letter code or the invite link.
2. Everyone else types the code and taps **Join**.
3. The host taps **Start game**. Each player flips and closes on their own phone.

The host's phone runs the game. If someone drops out, everyone sees a 15-second countdown, then a bot plays for them; after a minute away the bot finishes the round and they sit out. They can tap **Rejoin** any time. If the host drops, the next player's phone takes over the game (it reshuffles only the cards nobody has seen, so nobody peeks).

Online rooms use [PeerJS](https://peerjs.com/) (WebRTC). Phones meet through our own small connection server, then talk directly (or through the Cloudflare relay on strict networks). There are no accounts and no game data on a server.

## Install on a phone

- **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap **⋮**, then **Add to Home screen** (or **Install app**).

One-phone games work offline once installed.

## Hosting

- Hosted on **Cloudflare Pages** (project `streakorbust`) at streakorbust.com (also streakorbust.pages.dev), deployed automatically from the `main` branch. No build step.
- The old address, streakorbust.github.io, is served from the `gh-pages` branch: a tiny page that forwards to streakorbust.com (keeping `?room=` invites) and clears old offline copies.
- To ship an update: run `python scripts/bump-version.py` (bumps sw.js VERSION and the ?v= tags on CSS/JS), commit, push to `main`.
- `_headers` makes browsers re-check the game files on every visit, so an update never shows new HTML with old styles.
- **Connection server:** `signal/` is a Cloudflare Worker (`streakorbust-signal`) with one Durable Object per room, at signal.streakorbust.com. Cloudflare Workers Builds deploys it from the same repo (root directory `/signal`) on every push to `main`.
- **Pages Functions:** `functions/turn.js` hands out relay passes (needs `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`); `functions/push/` sends "a friend wants to join" lock-screen alerts (needs the `PUSH` KV binding).

## Files

- `engine.js`: the rules (deck, turns, action cards, scoring). No UI.
- `app.js`: screens, animations, saving, and online rooms.
- `net.js`: the connection layer for online rooms.
- `styles.css`: all visuals, including the card designs.
- `sw.js`: offline cache. Bump `VERSION` on every release.
- `tests.html`: open it in a browser to run the rules tests.

Local testing: `python -m http.server 8138`, then open http://localhost:8138. Adding `?debug` gives each tab its own player id, so two tabs can test a room. It also exposes `window.__deal(names, cards)` for stacking the deck in one-phone games.
