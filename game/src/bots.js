// The bots. Each one runs a small state machine — route, hold, engage, plant,
// defuse, pick up the spike, investigate a noise — over the map's waypoint
// graph, with breadth-first search for routes. Perception is throttled and
// staggered (one line-of-sight raycast per bot every ~0.12 s), hearing is a
// radius around gunshots and beeps, and shooting is bursts with an aim error
// that shrinks the longer a bot holds its aim: bots stop to aim, just like the
// player should. A channel (plant, defuse) is a hold-still timer that damage
// or movement resets; the same helper serves the player's E key.
import * as THREE from 'three';
import { pick, range, shuffle } from './rng.js';
import { WEAPONS, GRENADES, createWeaponState, weaponStep, weaponReady, weaponSpread } from './weapons.js';
import { damageActor } from './actors.js';

// A hold-still timer: tick(dt, still) returns true the moment it completes.
// Moving, or taking damage, resets it.
export function createChannel(duration) {
  let progress = 0;
  return {
    get progress() {
      return progress / duration;
    },
    get active() {
      return progress > 0;
    },
    tick(dt, still) {
      if (!still) {
        progress = 0;
        return false;
      }
      progress += dt;
      if (progress >= duration) {
        progress = 0;
        return true;
      }
      return false;
    },
    reset() {
      progress = 0;
    },
  };
}

export function nearestNode(map, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < map.waypoints.length; i += 1) {
    const node = map.waypoints[i];
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first search over the waypoint graph. Returns node indices from the
// start (exclusive) to the goal (inclusive), or [] when unreachable.
export function findRoute(map, from, to) {
  if (from === to) return [];
  const prev = new Array(map.waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const next of map.adjacency[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const route = [to];
        let at = to;
        while (at !== from) {
          at = prev[at];
          route.unshift(at);
        }
        return route.slice(1);
      }
      queue.push(next);
    }
  }
  return [];
}

const HOLD_SPOTS = {
  warden: { A: [4, 21, 6], B: [14, 22, 16] },
};

// Buy like a player: a rifle when affordable, otherwise an SMG, sometimes
// armour or a grenade. Bots keep their own money, on the same economy.
export function botBuy(bot, random) {
  const money = bot.money;
  let def = WEAPONS.sidearm;
  const roll = random();
  if (money >= WEAPONS.rifle.price && roll < 0.55) def = WEAPONS.rifle;
  else if (money >= WEAPONS.dmr.price && roll < 0.7) def = WEAPONS.dmr;
  else if (money >= WEAPONS.smg.price) def = WEAPONS.smg;
  if (def.price > 0 && money >= def.price) {
    bot.money -= def.price;
    bot.weapon = createWeaponState(def);
  }
  if (bot.money >= 650 && random() < 0.45) {
    bot.money -= 650;
    bot.armor = 50;
  }
  if (bot.money >= GRENADES.frag.price && random() < 0.4) {
    bot.money -= GRENADES.frag.price;
    bot.grenades.frag += 1;
  } else if (bot.money >= GRENADES.flash.price && random() < 0.3) {
    bot.money -= GRENADES.flash.price;
    bot.grenades.flash += 1;
  }
}

export function createBotBrain(ctx, actor, index) {
  return {
    actor,
    index,
    state: 'route',
    route: [],
    routeIndex: 0,
    targetSite: null,
    holdNode: -1,
    holdUntil: 0,
    lastSeen: null,
    lastSeenAt: -10,
    visibleEnemy: null,
    aimError: 0.05,
    reactAt: 0,
    burstLeft: 0,
    burstTimer: 0,
    pauseTimer: 0,
    losTimer: index * 0.03,
    plantChannel: createChannel(3),
    defuseChannel: createChannel(5),
    investigateAt: null,
    grenadeThrown: false,
    _tmp: new THREE.Vector3(),
  };
}

function enemiesOf(ctx, actor) {
  return ctx.actors.filter((other) => other.team !== actor.team && other.alive);
}

// One line-of-sight test: is there a clear ray from the bot's eye to the
// enemy's torso, and is the enemy inside the bot's forward cone?
function canSee(ctx, bot, enemy) {
  const from = bot._tmp.set(bot.actor.body.position.x, bot.actor.body.position.y + bot.actor.body.eye, bot.actor.body.position.z);
  const to = new THREE.Vector3(enemy.body.position.x, enemy.body.position.y + 1.1, enemy.body.position.z);
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist > 48) return false;
  dir.normalize();
  const forward = new THREE.Vector3(-Math.sin(bot.actor.body.yaw), 0, -Math.cos(bot.actor.body.yaw));
  if (forward.dot(dir) < 0.25 && dist > 4) return false;
  ctx.raycaster.set(from, dir);
  ctx.raycaster.far = dist;
  const hits = ctx.raycaster.intersectObjects(ctx.shootables, false);
  if (hits.length > 0) return false;
  return true;
}

function steerTo(bot, x, z, dt, crouch = false) {
  const body = bot.actor.body;
  const dx = x - body.position.x;
  const dz = z - body.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const targetYaw = Math.atan2(-dx, -dz);
  let diff = targetYaw - body.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  body.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  const aligned = Math.abs(diff) < 0.6;
  const wishX = aligned ? dx / dist : 0;
  const wishZ = aligned ? dz / dist : 0;
  bot.actor.mover.step(dt, wishX, wishZ, false, crouch);
  return dist < 0.7;
}

function setRoute(brain, map, fromNode, toNode) {
  brain.route = findRoute(map, fromNode, toNode);
  brain.routeIndex = 0;
}

function followRoute(ctx, brain, dt) {
  const bot = brain.actor;
  if (brain.routeIndex >= brain.route.length) return true;
  const node = ctx.map.waypoints[brain.route[brain.routeIndex]];
  if (steerTo(brain, node.x, node.z, dt)) brain.routeIndex += 1;
  return brain.routeIndex >= brain.route.length;
}

function pickSite(ctx, brain, random) {
  const spike = ctx.spike;
  if (spike.state === 'planted') return spike.site;
  const site = random() < 0.5 ? 'A' : 'B';
  return site;
}

function assignEmberPlan(ctx, brain, random) {
  const bot = brain.actor;
  // The carrier keeps the site it already chose; the rest roll a new one.
  const site = bot.hasSpike && brain.targetSite ? brain.targetSite : pickSite(ctx, brain, random);
  brain.targetSite = site;
  const from = nearestNode(ctx.map, bot.body.position.x, bot.body.position.z);
  setRoute(brain, ctx.map, from, ctx.map.siteNodes[site]);
  brain.state = 'route';
}

function assignWardenPlan(ctx, brain, random) {
  const bot = brain.actor;
  const sites = ['A', 'A', 'B', 'B'];
  const site = sites[brain.index % sites.length];
  brain.targetSite = site;
  const spots = HOLD_SPOTS.warden[site];
  brain.holdNode = pick(random, spots);
  const from = nearestNode(ctx.map, bot.body.position.x, bot.body.position.z);
  setRoute(brain, ctx.map, from, brain.holdNode);
  brain.state = 'route';
}

export function planRound(ctx, brain, random) {
  if (brain.actor.team === 'ember') assignEmberPlan(ctx, brain, random);
  else assignWardenPlan(ctx, brain, random);
  brain.visibleEnemy = null;
  brain.lastSeen = null;
  brain.grenadeThrown = false;
  brain.plantChannel.reset();
  brain.defuseChannel.reset();
}

export function updateBot(ctx, brain, dt, time, random) {
  const bot = brain.actor;
  if (!bot.alive) return;
  weaponStep(bot.weapon, dt);
  const body = bot.body;

  // --- Perception, throttled and staggered so six bots do not raycast at once.
  brain.losTimer -= dt;
  if (brain.losTimer <= 0) {
    brain.losTimer = 0.12 + brain.index * 0.02;
    let seen = null;
    for (const enemy of enemiesOf(ctx, bot)) {
      if (canSee(ctx, brain, enemy)) {
        seen = enemy;
        break;
      }
    }
    if (seen) {
      if (brain.visibleEnemy !== seen) brain.reactAt = time + range(random, 0.35, 0.6);
      brain.visibleEnemy = seen;
      brain.lastSeen = new THREE.Vector3(seen.body.position.x, seen.body.position.y, seen.body.position.z);
      brain.lastSeenAt = time;
    } else if (brain.visibleEnemy && time - brain.lastSeenAt > 0.9) {
      brain.visibleEnemy = null;
    }
  }

  // --- Hearing: a recent noise inside 28 m pulls the bot toward it.
  if (brain.state === 'route' || brain.state === 'hold') {
    for (let i = ctx.noise.length - 1; i >= 0; i -= 1) {
      const event = ctx.noise[i];
      if (time - event.time > 2) continue;
      const d = Math.hypot(event.x - body.position.x, event.z - body.position.z);
      if (d < 28 && d > 4) {
        const node = nearestNode(ctx.map, event.x, event.z);
        const from = nearestNode(ctx.map, body.position.x, body.position.z);
        if (node !== from) {
          setRoute(brain, ctx.map, from, node);
          brain.state = 'route';
          brain.investigateAt = time + 6;
        }
        break;
      }
    }
  }

  const spike = ctx.spike;
  const enemy = brain.visibleEnemy;

  // --- The spike carrier plants when it reaches its site with nobody in sight.
  if (bot.team === 'ember' && bot.hasSpike && spike.state === 'carried') {
    const site = ctx.map.sites.find((s) => s.id === brain.targetSite) || ctx.map.sites[0];
    const inSite = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z) < site.radius;
    if (inSite && !enemy) {
      brain.state = 'plant';
    } else if (brain.state === 'plant' && !inSite) {
      brain.state = 'route';
    }
  }

  // --- A dropped spike is picked up by the nearest Ember bot on its way.
  if (bot.team === 'ember' && spike.state === 'dropped') {
    const d = Math.hypot(spike.x - body.position.x, spike.z - body.position.z);
    if (d < 1.2) {
      spike.state = 'carried';
      spike.carrier = bot;
      bot.hasSpike = true;
      ctx.events.push({ type: 'spikePickup', actor: bot, time });
    } else if (brain.state !== 'engage' && brain.state !== 'plant') {
      const node = nearestNode(ctx.map, spike.x, spike.z);
      const from = nearestNode(ctx.map, body.position.x, body.position.z);
      if (brain.route.length === 0 || brain.state === 'route') setRoute(brain, ctx.map, from, node);
      brain.state = 'route';
    }
  }

  // --- After the plant, every Warden routes to the site; the first there defuses.
  if (bot.team === 'warden' && spike.state === 'planted') {
    const site = ctx.map.sites.find((s) => s.id === spike.site);
    const inSite = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z) < site.radius;
    if (inSite && !enemy) brain.state = 'defuse';
    else if (brain.state !== 'engage') {
      const from = nearestNode(ctx.map, body.position.x, body.position.z);
      setRoute(brain, ctx.map, from, ctx.map.siteNodes[spike.site]);
      brain.state = 'route';
    }
  }

  // --- Combat: stop, aim, fire in bursts. The aim error shrinks while the bot
  // holds its aim, so a bot that just rounded a corner shoots wide.
  if (enemy && time >= brain.reactAt) {
    const ex = enemy.body.position.x;
    const ez = enemy.body.position.z;
    const ey = enemy.body.position.y + 1.25;
    const dx = ex - body.position.x;
    const dy = ey - (body.position.y + body.eye);
    const dz = ez - body.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    let dyaw = targetYaw - body.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    body.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, dyaw));
    body.pitch += Math.max(-3 * dt, Math.min(3 * dt, targetPitch - body.pitch));
    brain.aimError += (0.006 - brain.aimError) * Math.min(1, dt * 2.2);
    brain.state = 'engage';

    // A grenade, once, at a mid-range enemy the bot cannot rush.
    if (!brain.grenadeThrown && bot.grenades.frag > 0 && dist > 9 && dist < 26 && random() < 0.01) {
      brain.grenadeThrown = true;
      bot.grenades.frag -= 1;
      ctx.throwGrenade(bot, 'frag', new THREE.Vector3(ex, ey, ez));
    }

    if (brain.burstLeft <= 0) {
      brain.pauseTimer -= dt;
      if (brain.pauseTimer <= 0 && weaponReady(bot.weapon)) {
        brain.burstLeft = 3 + Math.floor(random() * 3);
        brain.pauseTimer = range(random, 0.5, 0.95);
      }
    } else if (weaponReady(bot.weapon)) {
      brain.burstLeft -= 1;
      ctx.fireShot(bot, weaponSpread(bot.weapon, bot.mover.groundSpeed()) + brain.aimError);
    }
    // Stand still while firing; step in place so gravity and friction still run.
    bot.mover.step(dt, 0, 0, false, false);
    return;
  }

  brain.aimError = 0.05;
  brain.burstLeft = 0;

  // The fight is over: go back to the plan instead of standing in place.
  if (brain.state === 'engage') {
    if (bot.team === 'ember') assignEmberPlan(ctx, brain, random);
    else assignWardenPlan(ctx, brain, random);
  }

  // --- Planting and defusing channels.
  if (brain.state === 'plant') {
    bot.mover.step(dt, 0, 0, false, false);
    if (brain.plantChannel.tick(dt, true)) {
      spike.state = 'planted';
      spike.site = brain.targetSite;
      spike.fuse = 35;
      spike.x = body.position.x;
      spike.z = body.position.z;
      bot.hasSpike = false;
      ctx.events.push({ type: 'spikePlanted', actor: bot, site: spike.site, time });
      ctx.audio.plantBeep(true);
      brain.state = 'route';
    }
    return;
  }
  if (brain.state === 'defuse') {
    bot.mover.step(dt, 0, 0, false, false);
    if (brain.defuseChannel.tick(dt, true)) {
      spike.state = 'defused';
      ctx.events.push({ type: 'spikeDefused', actor: bot, time });
      brain.state = 'route';
    }
    return;
  }

  // --- Route following and holding.
  if (brain.state === 'route') {
    if (followRoute(ctx, brain, dt)) {
      brain.state = 'hold';
      brain.holdUntil = time + range(random, 2.5, 6);
    }
  } else if (brain.state === 'hold') {
    // Hold the angle: slow scan, crouch behind low cover half the time.
    body.yaw += Math.sin(time * 0.5 + brain.index) * dt * 0.35;
    bot.mover.step(dt, 0, 0, false, brain.index % 2 === 0);
    if (time >= brain.holdUntil) {
      if (bot.team === 'ember') assignEmberPlan(ctx, brain, random);
      else {
        // Wardens rotate between their site's hold spots.
        const spots = HOLD_SPOTS.warden[brain.targetSite || 'A'];
        brain.holdNode = pick(random, spots);
        const from = nearestNode(ctx.map, body.position.x, body.position.z);
        setRoute(brain, ctx.map, from, brain.holdNode);
        brain.state = 'route';
      }
    }
  } else {
    bot.mover.step(dt, 0, 0, false, false);
  }
}
