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
html = html.replace(/<script src="(src\/[^"]+\.js)"><\/script>/g, (_, p) => `<script>\n${read(p).replace(/<\/script/gi, '<\\/script')}\n</script>`);
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

const title = html.match(/<title>[^<]*<\/title>/);
if (!title || html.indexOf(title[0]) > 8000) throw new Error('<title> must be in the first 8KB');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'jungle-wizard.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB)`);
