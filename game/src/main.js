// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate, with the state kept in one place (ctx) and the rendering
// kept apart from it. ?shot=start|play|buy|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createActor, resetActor, syncActorMesh } from './actors.js';
import { createBotBrain, updateBot } from './bots.js';
import { createCombat } from './combat.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { WEAPONS, GRENADES, createWeaponState, createViewModel, weaponStep, weaponReady, weaponSpread } from './weapons.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232833);
scene.fog = new THREE.Fog(new THREE.Color(0x232833), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 100;

// The one state object: every system reads and writes through it.
const ctx = {
  scene,
  map,
  actors: [],
  brains: [],
  player: null,
  random,
  raycaster,
  shootables: map.shootables,
  noise: [],
  events: [],
  time: 0,
  spike: null,
  weapons: WEAPONS,
  audio,
  hud,
  fireShot: null,
  throwGrenade: null,
  flashPlayer(strength) {
    hud.flash(strength);
  },
};

const player = createActor(ctx, 'ember', 0, true, 0, 11.5, 0);
ctx.player = player;
ctx.actors.push(player);
for (let i = 0; i < 3; i += 1) {
  const bot = createActor(ctx, 'ember', i + 1, false, -4 + i * 2.5, 11.5, 0);
  ctx.actors.push(bot);
  ctx.brains.push(createBotBrain(ctx, bot, i));
}
for (let i = 0; i < 4; i += 1) {
  const bot = createActor(ctx, 'warden', i, false, -4 + i * 2.5, -11.5, Math.PI);
  ctx.actors.push(bot);
  ctx.brains.push(createBotBrain(ctx, bot, 3 + i));
}

const combat = createCombat(ctx);
ctx.fireShot = (shooter, spread) => combat.fireShot(shooter, spread, random);
ctx.throwGrenade = (actor, kind, target) => combat.throwGrenade(actor, kind, target);
const rounds = createRounds(ctx);

// The Spark: a small amber device with a blinking light, shown planted or
// dropped, hidden while carried.
const spikeGroup = new THREE.Group();
const spikeBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.22),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.7 }),
);
spikeGroup.add(spikeBox);
const spikeLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
spikeLight.position.y = 0.4;
spikeGroup.add(spikeLight);
spikeGroup.visible = false;
scene.add(spikeGroup);

let viewModel = createViewModel(camera, player.weapon.def);
function equipViewModel() {
  viewModel.dispose();
  viewModel = createViewModel(camera, player.weapon.def);
}

let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;

hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (rounds.rounds.phase === 'match') {
    rounds.rounds.scores = { ember: 0, warden: 0 };
    rounds.rounds.round = 1;
    rounds.rounds.matchWinner = null;
    for (const actor of ctx.actors) {
      actor.money = 800;
      actor.kills = 0;
      actor.deaths = 0;
      actor.weapon = createWeaponState(WEAPONS.sidearm);
    }
    equipViewModel();
    rounds.startRound();
  }
  started = true;
  hud.hideOverlay();
  hud.hideBuy();
  input.requestLock();
});

hud.onBuy((row) => {
  if (rounds.rounds.phase !== 'buy') return;
  if (row.armor) rounds.buyArmor(player);
  else if (row.grenade) rounds.buyGrenade(player, row.id);
  else if (rounds.buyWeapon(player, row.id)) equipViewModel();
  hud.renderBuy(player);
});

function onLockChange(locked) {
  if (shot || !started) return;
  if (locked) {
    hud.hideOverlay();
    if (rounds.rounds.phase === 'buy') hud.hideBuy();
  } else if (rounds.rounds.phase !== 'match') {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  const body = player.body;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const body = player.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function throwPlayerGrenade(kind) {
  if (player.grenades[kind] <= 0 || !player.alive) return;
  player.grenades[kind] -= 1;
  const eye = new THREE.Vector3(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const target = eye.clone().addScaledVector(dir, 15);
  target.y = Math.max(0.4, target.y);
  ctx.throwGrenade(player, kind, target);
}

function drainEvents() {
  for (const event of ctx.events) {
    if (event.type === 'hit') hud.hitMarker(event.kill, event.kill ? 4000 : 90);
    else if (event.type === 'kill') hud.addKill(`${event.shooter ? event.shooter.name : 'Blast'} ▸ ${event.victim.name}`, event.shooter === player);
    else if (event.type === 'hurt') hud.damageFlash();
    else if (event.type === 'spikePlanted') {
      hud.showBanner('SPARK PLANTED', `Site ${event.site} — defend it for 35 seconds`, 3600);
      hud.addKill(`${event.actor.name} planted the Spark`, event.actor.team === 'ember');
    } else if (event.type === 'spikePickup') hud.addKill(`${event.actor.name} picked up the Spark`, event.actor.team === 'ember');
    else if (event.type === 'roundStart') hud.showBanner(`ROUND ${event.round}`, 'Ember pushes — Warden holds', 2200);
    else if (event.type === 'live') hud.showBanner('GO', '', 1200);
  }
  ctx.events.length = 0;
}

function step(dt) {
  elapsed += dt;
  ctx.time = elapsed;
  // World matrices must be current before any raycast (bots' sight, shots):
  // the renderer only refreshes them when it draws, and the shot captures
  // fire before the first draw.
  scene.updateMatrixWorld(true);

  if (started && player.alive) {
    const keys = input.state.keys;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(player.body.yaw);
      const cos = Math.cos(player.body.yaw);
      const len = Math.hypot(forward, strafe);
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const frozenInBuy = rounds.rounds.phase === 'buy';
    player.mover.step(dt, frozenInBuy ? 0 : wishX, frozenInBuy ? 0 : wishZ, keys.has('Space') && !frozenInBuy, crouch);

    const look = input.takeLook();
    player.mover.look(look.x, look.y);
    weaponStep(player.weapon, dt);

    // Fire: automatics while held, semi-automatics on the press.
    const firing = input.state.firing && !frozenInBuy;
    const pressedFire = firing && !wasFiring;
    if ((player.weapon.def.auto && firing) || (!player.weapon.def.auto && pressedFire)) {
      if (weaponReady(player.weapon)) {
        ctx.fireShot(player, weaponSpread(player.weapon, player.mover.groundSpeed()));
      }
    }
    wasFiring = firing;
    if (keys.has('KeyR')) {
      if (player.weapon.reloadLeft === 0 && player.weapon.mag < player.weapon.def.mag && player.weapon.reserve > 0) {
        player.weapon.reloadLeft = player.weapon.def.reloadTime;
        audio.reload();
      }
    }
  } else {
    weaponStep(player.weapon, dt);
  }

  for (const brain of ctx.brains) {
    if (rounds.rounds.phase === 'live') updateBot(ctx, brain, dt, elapsed, random);
    else if (rounds.rounds.phase === 'buy') weaponStep(brain.actor.weapon, dt);
    syncActorMesh(brain.actor, dt);
  }
  combat.step(dt);
  rounds.update(dt);

  // The Spark's mesh follows its state.
  const spike = ctx.spike;
  if (spike.state === 'planted' || spike.state === 'dropped') {
    spikeGroup.visible = true;
    spikeGroup.position.set(spike.x, 0.12, spike.z);
    spikeLight.intensity = spike.state === 'planted' ? 6 + Math.sin(elapsed * 6) * 5 : 2;
  } else {
    spikeGroup.visible = false;
  }

  // Planting: hold E inside a site while carrying the Spark.
  if (started && player.alive && rounds.rounds.phase === 'live') {
    const holdingE = input.state.keys.has('KeyE');
    const carrying = spike.state === 'carried' && spike.carrier === player;
    if (carrying) {
      const site = map.sites.find((s) => Math.hypot(s.center.x - player.body.position.x, s.center.z - player.body.position.z) < s.radius);
      if (site) {
        hud.setPrompt(holdingE ? 'Planting the Spark…' : 'Hold E to plant the Spark');
        rounds.playerPlantTick(dt, holdingE);
        hud.setProgress(rounds.rounds.plantChannel.progress || null, 'PLANTING');
      } else {
        hud.setPrompt('Carry the Spark to Site A (Silo) or Site B (Crane)');
        hud.setProgress(null);
      }
    } else if (spike.state === 'planted') {
      hud.setPrompt('Defend the planted Spark — 35 seconds to detonation');
      hud.setProgress(null);
    } else {
      hud.setPrompt(null);
      hud.setProgress(null);
    }
  }

  drainEvents();
  pushHud();
}

function pushHud() {
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  hud.setScore(rounds.rounds.scores, rounds.rounds.round);
  hud.setAlive(rounds.aliveCount('ember'), rounds.aliveCount('warden'));
  hud.setCrosshairSpread(6 + weaponSpread(player.weapon, player.mover.groundSpeed()) * 700);
  if (rounds.rounds.phase === 'buy') {
    hud.setTimer(rounds.rounds.phaseTime, 'buy');
    hud.updateBuyTimer(rounds.rounds.phaseTime);
    hud.renderBuy(player);
  } else if (rounds.rounds.phase === 'live') {
    hud.setTimer(rounds.rounds.roundTime, 'live');
  } else {
    hud.setTimer(0, 'live');
  }
  const spike = ctx.spike;
  if (spike.state === 'planted') hud.setSpike('planted', spike.site, spike.fuse);
  else if (spike.state === 'carried' && spike.carrier === player) hud.setSpike('carried');
  else hud.setSpike('none');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    // One-frame key presses: buy keys, grenades, buy menu toggle.
    for (const code of input.drainPressed()) {
      if (!started || !player.alive) continue;
      if (code === 'KeyB' && rounds.rounds.phase === 'buy') {
        if (input.state.locked) {
          input.releaseLock();
          hud.showBuyPhase(rounds.rounds.round, rounds.rounds.phaseTime);
        } else {
          input.requestLock();
          hud.hideBuy();
        }
      }
      if (rounds.rounds.phase === 'buy') {
        const row = { Digit1: 'sidearm', Digit2: 'smg', Digit3: 'rifle', Digit4: 'dmr' }[code];
        if (row && rounds.buyWeapon(player, row)) equipViewModel();
        if (code === 'Digit5') rounds.buyGrenade(player, 'frag');
        if (code === 'Digit6') rounds.buyGrenade(player, 'flash');
        if (code === 'Digit7') rounds.buyArmor(player);
        hud.renderBuy(player);
      }
      if (code === 'KeyG') throwPlayerGrenade('frag');
      if (code === 'KeyF') throwPlayerGrenade('flash');
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    viewModel.update(player.weapon, dt);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  started = true;
  hud.hideOverlay();
  hud.hideBuy();
  rounds.startRound();
  if (name === 'start') {
    player.body.position.set(0, 0, 11.5);
    player.body.yaw = Math.PI;
    player.body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -6));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    player.money = 3250;
    player.body.position.set(-2, 0, 11.5);
    player.body.yaw = Math.PI;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -6));
    hud.renderBuy(player);
  } else if (name === 'play' || name === 'end') {
    // Skip the buy phase and let the bots walk their routes for 1.5 s.
    rounds.rounds.phase = 'live';
    rounds.rounds.roundTime = 95;
    hud.hideBuy();
    settle(90);
    if (name === 'play') {
      // Stage one Warden in the mid lane, in the open, and fire one real shot.
      const warden = ctx.actors.find((a) => a.team === 'warden' && a.alive);
      warden.body.position.set(1.5, 0, -1);
      warden.body.yaw = 0;
      warden.body.velocity.set(0, 0, 0);
      syncActorMesh(warden, 0);
      player.body.position.set(0, 0, 8);
      settle(2);
      aimAt(new THREE.Vector3(1.5, 1.25, -1));
      ctx.fireShot(player, 0);
      settle(1);
    } else {
      // A round already won: one Warden down in view, the banner up.
      const warden = ctx.actors.find((a) => a.team === 'warden' && a.alive);
      warden.body.position.set(2.5, 0, 2);
      warden.body.yaw = 0.6;
      warden.alive = false;
      warden.hp = 0;
      warden.fall = 1;
      syncActorMesh(warden, 0);
      player.body.position.set(0, 0, 8);
      settle(2);
      aimAt(new THREE.Vector3(2.5, 0.8, 2));
      rounds.rounds.scores = { ember: 2, warden: 1 };
      rounds.rounds.round = 4;
      // A long hold: under software rendering a frame can take seconds, and
      // the banner must still be up when the capture lands.
      hud.showRoundEnd('ember', 'Warden team eliminated', rounds.rounds.scores, 4, 60000);
    }
  }
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  hud.setScore(rounds.rounds.scores, rounds.rounds.round);
  hud.setAlive(rounds.aliveCount('ember'), rounds.aliveCount('warden'));
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
pushHud();
if (shot) runShot(shot);
else {
  rounds.startRound();
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
