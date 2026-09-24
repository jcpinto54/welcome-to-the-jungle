# Jungle Wizard

A PS1-style 3D rhythm action-RPG for desktop browsers. You are a swamp-born tree wizard, and your spells are the drums of a 170 BPM lo-fi jungle groove. Play in time, carve your loops into the Loop Stones, and bring colour back to a silent jungle.

The design is in [DESIGN.md](DESIGN.md) and the code contract in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Play

Open `index.html` in Chrome, Firefox or Edge on a computer. There's nothing to install and no build step. Wear headphones.

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look (click the game to capture the mouse, Esc to release) |
| Space | Stomp: **kick** |
| Left mouse / J | Bolt: **snare** |
| Right mouse / K | Quake: **bass** |
| Shift | Dash |
| E | Talk, carve a Loop Stone, open doors |
| Tab | Spellbook (edit your loop) |
| M | Mute |

Cast on the beat for stronger spells. Everything you play goes into the loop at the bottom of the screen. Press E at a Loop Stone to carve it into the song.

To hear the real opening scream, drop a `welcome.mp3` into `assets/audio/` (see the note there about licensing).

## Develop

```
npm test                 # unit tests of the pure modules (Node 20+, no dependencies)
npm install              # once, for Playwright
npm run test:e2e         # headless browser tests: boot, intro, critical path, spellbook
npm run build:artifact   # single-file build in dist/ for sharing
```

Everything is plain JavaScript files in `src/` loaded in order by `index.html`, with Three.js r159 from a CDN (and a copy in `vendor/` for offline play). All art and sound are generated in code.
