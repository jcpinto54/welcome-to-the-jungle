// Builds dist/jungle-wizard.html: one self-contained page (for sharing as a claude.ai
// Artifact). Local CSS and JS are inlined; three.js and fonts stay on their CDNs.
// Artifact pages are wrapped in their own <html>/<head>/<body>, so those tags go.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

html = html.replace(/<link rel="stylesheet" href="(src\/[^"]+\.css)">/g, (_, p) => `<style>\n${read(p)}\n</style>`);
html = html.replace(/<script>window\.THREE \|\| document\.write[^\n]*<\/script>\n/, '');
// No service worker in a framed single page.
html = html.replace(/<script src="src\/pwa\.js"><\/script>\n?/, '');
// The artifact publishes no welcome.mp3, so don't probe for one (a 404 is a console error).
const inline = (p) => {
  let src = read(p);
  if (p === 'src/sound.js') src = src.replace("const SCREAM_URL = 'assets/audio/welcome.mp3';", 'const SCREAM_URL = null;');
  return src.replace(/<\/script/gi, '<\\/script');
};
html = html.replace(/<script src="(src\/[^"]+\.js)"><\/script>/g, (_, p) => `<script>\n${inline(p)}\n</script>`);
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

// The artifact is one page in a frame: no manifest, icons or service worker to install.
html = html
  .replace(/<link rel="manifest"[^>]*>\s*/i, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/i, '')
  .replace(/<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>\s*/gi, '');

const title = html.match(/<title>[^<]*<\/title>/);
if (!title || html.indexOf(title[0]) > 8000) throw new Error('<title> must be in the first 8KB');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'jungle-wizard.html');
fs.writeFileSync(out, html);
// The same page wrapped the way the artifact host wraps it, for local testing and sharing.
const standalone = path.join(ROOT, 'dist', 'jungle-wizard.standalone.html');
fs.writeFileSync(standalone, `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${html}\n</body>\n</html>\n`);
console.log(`wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB) and ${path.relative(ROOT, standalone)}`);
