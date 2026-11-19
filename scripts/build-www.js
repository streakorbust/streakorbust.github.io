// Copies the game into www/ for the App Store app, plus a local copy of PeerJS so the app
// never loads code from the internet. The website itself is served straight from the repo root.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const files = ['index.html', 'styles.css', 'engine.js', 'net.js', 'app.js', 'manifest.webmanifest', 'privacy.html'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'icons'))) fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));
fs.copyFileSync(path.join(root, 'node_modules', 'peerjs', 'dist', 'peerjs.min.js'), path.join(out, 'peerjs.min.js'));
console.log('www/ ready:', fs.readdirSync(out).join(', '));
