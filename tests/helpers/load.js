'use strict';
// Loads classic browser scripts from src/ into one shared vm context, the way a page
// would, and returns the globals you ask for. Pure modules must load without THREE/DOM.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function load(files, names) {
  const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval });
  ctx.window = ctx;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const out = {};
  for (const n of names) out[n] = vm.runInContext(n, ctx);
  return out;
}

module.exports = { load, ROOT };
