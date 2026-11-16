# makefun-threejs-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/bocork0/makefun-threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/bocork0/makefun-threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Emberline — a round-based tactical first-person shooter in the style Counter-Strike made
famous — two teams, short rounds, money and a buy menu, gunfire where accuracy
counts more than speed — built on three.js 0.187.0 from static files, with no
build step and no network request. Single-player against bots, offline in a
desktop browser.

## The game

You are **Ember**, the attacking team. Push into the Foundry Yard, plant the
**Spark** at Site A (the Silo) or Site B (the Crane), and defend it for 35
seconds — or eliminate every **Warden** defender first. Wardens win by
clearing Ember, defusing a planted Spark, or running the clock out with no
plant. First to 5 rounds takes the match (at most 9 rounds).

- **Gunplay:** four weapons (P9 sidearm, Rook-9 SMG, VK-47 rifle, Longshot
  DMR) plus frag and flash grenades. Hitscan with headshot multipliers,
  recoil, and spread that grows tenfold on the move — stopping to aim pays.
  Movement has acceleration, friction, crouching, jumping, and AABB collision
  with the map.
- **Tactics:** money earned per round ($3,250 win / $1,900 loss / $300 kill)
  and spent in a buy menu (B, or keys 1–7) during the 12 s buy phase; bots
  follow routes over a waypoint graph, hold angles, rotate on noise, and
  react to what they see and hear; the Spark carrier plants, Wardens defuse.
- **Map:** an original 40 × 28 m dusk foundry yard — three lanes (west lane,
  the foundry hall, east lane), shipping containers and crates for cover, a
  rusted silo and a crane as the two sites. Floor and hazard markings are
  painted procedurally on canvas at load; the game ships no image or audio
  files. All sounds are synthesised with WebAudio.
- **HUD:** health and armour, ammo and reserve, money, round timer, score,
  alive counts, kill feed, plant/defuse progress, and a dynamic crosshair.

## Play it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open http://localhost:8080 in desktop Chrome, click **Click to play**.
WASD move, mouse look, click fire, R reload, Ctrl crouch, Space jump,
E plant the Spark, B buy menu, G frag grenade, F flash grenade.

## Screenshots

The game supports deterministic capture states for screenshots:

| file | URL | shows |
| --- | --- | --- |
| `1-cover.jpg` | `?shot=start&seed=1` | title screen over the yard |
| `2-combat.jpg` | `?shot=play&seed=1` | mid-round combat, tracer and hitmarker |
| `3-buy.jpg` | `?shot=buy&seed=1` | buy menu during the buy phase |
| `4-round-end.jpg` | `?shot=end&seed=1` | round won, banner and a downed Warden |

Open the URL at 1280×720, wait for `window.__shotReady`, and screenshot the
viewport. Screenshots are real renders of the game's own code.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with the vendored
`vendor/makefun-threejs.ts` library.

## Layout

```
main.ts                  the hand-in program
serve.ts                 local static server for game/
game/
  index.html             HUD DOM + CSS + the one import map for three.js
  vendor/three/          three.js 0.187.0, byte for byte (three.module.min.js,
                         three.core.min.js) + its LICENSE
  src/
    main.js              boot, the fixed 60 Hz loop, ?shot= captures
    map.js               Foundry Yard: geometry, colliders, waypoint graph
    bodies.js            movement + collision, shared by player and bots
    actors.js            combatants: health, armour, humanoid meshes
    bots.js              bot AI: routes, sight, hearing, bursts, plant/defuse
    combat.js            hitscan shooting, tracers, grenades
    rounds.js            round phases, money, the Spark, win conditions
    weapons.js           the armoury + first-person view models
    hud.js               the DOM HUD and buy menu
    input.js             keyboard, mouse, pointer lock
    audio.js             procedural WebAudio sounds
    palette.js           the look plan (colours, team hues)
    rng.js               seeded randomness
screenshots/             3–4 real renders of the game
```

## License

MIT — see `LICENSE`. three.js is under its own MIT license in
`game/vendor/three/LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7wt04jdt&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
