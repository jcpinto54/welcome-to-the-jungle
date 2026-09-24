# Jungle Wizard: game design

## The pitch

It runs in the browser on a computer (keyboard and mouse, the main way to play) and on phones (iPhone and Android, touch controls, landscape). On a phone it installs to the home screen like an app. App Store and Play Store builds come later by wrapping the same code with Capacitor, which needs a Mac with Xcode.

You are the Jungle Wizard: a swamp creature made of bark, roots and moss, torn out of a giant tree at the start of the game. The jungle has gone grey and silent. Your spells are drums. Every stomp is a kick, every bolt is a snare, every quake is a sub-bass drop, and they all lock to a 170 BPM lo-fi jungle groove. The jungle loops back what you play. Carve those loops into the Loop Stones and colour floods back into the world. Finish the song and the Lost Pyramid opens.

It opens with a scream of "WELCOME TO THE JUNGLE", and after that there's nothing but lo-fi jungle and drum & bass.

## Pillars

1. **Your moves are the music.** Fighting and exploring is how you write the track. There is no separate "music mode".
2. **Lo-fi jungle all the way.** 170 BPM breaks, sub bass, dreamy pads, vinyl crackle and an 8-bit arp at the end. The only exception is the opening scream.
3. **PS1-era wizard-core.** Low-poly 3D rendered at 270 lines, dithered 15-bit colour and wobbly vertices. The world borrows from the jungle wizard channel: a grizzled wizard with a glowing staff, waterfalls, orange mushrooms, neon grids, a pyramid with an eye and VHS glitches.
4. **Chill, never punishing.** Dying means you crumble into moss and wake up at the last Loop Stone. The challenge is playing in time.

## The wizard

He is a tree spirit rather than a storybook wizard. He's tall, hunched and gnarled, with a bark body, root feet, a ragged moss cloak and a long Spanish-moss beard. His eyes glow in a hollow face under a crooked bark hat with mushrooms growing on it. His staff is a gnarled root cradling a glowing orb, which flashes the colour of the last drum you played. He idles and walks to the beat.

## Core loop

| You do | You hear | In the world |
|---|---|---|
| **Stomp** (big orange button · Space) | Kick | Shockwave around you; mushrooms bounce |
| **Bolt** (magenta button · left mouse) | Snare | Magenta bolt that auto-aims on touch; burns vine walls |
| **Quake** (violet button · right mouse) | Sub bass | Roots burst from the ground; breaks cracked stone |
| **Dash** (small button · Shift) | A whoosh | Not recorded |

On a phone, your left thumb steers with a floating joystick and your right thumb plays the spell buttons. Dragging on the right half turns the camera. An action button appears when there's something to carve, talk to or open.

- **In the pocket.** Cast on the beat (within ±75 ms) and the spell hits harder.
- **The draft loop.** Every spell is written into a two-bar loop (32 steps) shown at the bottom of the screen. The jungle plays your draft back as quiet ghost hits, so you hear your groove forming.
- **Loop Stones.** Tap the action button (E on a keyboard) at a stone to carve the draft into the song. Carved hits play at full volume from then on, and the world gets its colour back.
- **Spellbook** (the book button · Tab). A step sequencer where you can tweak the carved song cell by cell.

## The world

One jungle, split into three zones by terrain:

1. **The Summoning Swamp and the Panther Ruins.** You wake at the Summoning Tree and carve Loop Stone I. The Panther Spirit gives you the snare.
2. **Moth Hollow and the Falls.** You burn through the vine wall and fight the Hush Moths, creatures of silence that muffle the music as they close in. Loop Stone II sits by the waterfall, and the Sub Toad gives you the bass.
3. **The Plateau.** You break the cracked-stone gate, pass the Hush Warden and reach Loop Stone III and the Lost Pyramid. The pyramid only opens for a full groove: kick, snare and bass all carved.

RPG layer: vibe (health), fireflies (XP) that level you up, a quest tracker with a compass, spirit dialogue and ability unlocks.

## The opening scream

The ask is Axl Rose screaming "Welcome to the jungle". That recording belongs to Guns N' Roses and their label, so shipping it publicly needs a licence. The game plays `assets/audio/welcome.mp3` if you put a file there. Without one it uses a text-to-speech stand-in with the same timing. A sound-alike recorded by someone on the team, or a licensed clip, drops straight in.

## What's next

- More zones, each a sub-genre: ragga jungle swamp, breakcore "lost pyramid sessions", liquid DnB waterfalls.
- More instruments as spirits: amen chops, reese bass, vocal chops, pads.
- Boss fights as call-and-response rhythm battles.
- Export your track as audio, share groove codes, gamepad support.
