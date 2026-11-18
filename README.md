# Streak or Bust

A push-your-luck card game for 2 to 4 players. Play live online with friends (each on their own phone), or pass one phone around. It installs as an app from the browser, with no App Store needed.

## Play online

1. One person taps **Create a room** and shares the 4-letter code or the invite link.
2. Everyone else types the code and taps **Join**.
3. The host taps **Start game**. Each player flips and closes on their own phone.

The host's phone runs the game, so the host should keep the app open. If someone drops out, they can reopen the app and tap **Rejoin**. Their seat is waiting for them. If they're gone for good, the host can move for them from the ⋯ menu.

Online rooms use [PeerJS](https://peerjs.com/) (WebRTC) and its free public connection server. There are no accounts and no game server.

## Install on a phone

- **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in Chrome, tap **⋮**, then **Add to Home screen** (or **Install app**).

One-phone games work offline once installed.

## Files

- `engine.js`: the rules (deck, turns, action cards, scoring). No UI.
- `app.js`: screens, animations, saving, and online rooms.
- `net.js`: the connection layer for online rooms.
- `styles.css`: all visuals, including the card designs.
- `sw.js`: offline cache. Bump `VERSION` on every release.
- `tests.html`: open it in a browser to run the rules tests.

Local testing: `python -m http.server 8138`, then open http://localhost:8138. Adding `?debug` gives each tab its own player id, so two tabs can test a room. It also exposes `window.__deal(names, cards)` for stacking the deck in one-phone games.
