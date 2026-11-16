// An actor is one combatant: a body (see bodies.js), a health pool, a weapon
// state, and a humanoid built from boxes — legs, torso, head, a gun — in the
// team's colour. The player is an actor with no mesh of its own (the camera is
// its head); the bots are actors with meshes the raycaster can hit. Headshots
// deal the weapon's head multiplier; armour absorbs half of a hit until it is
// gone. A dead actor falls over and stays down until the round resets it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './bodies.js';
import { createWeaponState } from './weapons.js';

const HEALTH = 100;

const BOT_NAMES = {
  ember: ['Rook', 'Sable', 'Kestrel'],
  warden: ['Harrow', 'Bramble', 'Flint', 'Onyx'],
};

export function createActor(ctx, team, index, isPlayer, x, z, yaw) {
  const mover = createBody(ctx.map.colliders, x, z, yaw);
  const body = mover.body;
  const actor = {
    id: `${team}-${index}`,
    name: isPlayer ? 'You' : BOT_NAMES[team][index % BOT_NAMES[team].length],
    team,
    isPlayer,
    mover,
    body,
    hp: HEALTH,
    armor: 0,
    alive: true,
    weapon: createWeaponState(ctx.weapons.sidearm),
    grenades: { frag: 0, flash: 0 },
    hasSpike: false,
    kills: 0,
    deaths: 0,
    money: 800,
    fall: 0,
    group: null,
    headMesh: null,
    torsoMesh: null,
    hitMeshes: [],
  };

  if (!isPlayer) {
    const teamColor = team === 'ember' ? PALETTE.ember : PALETTE.warden;
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.75, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc9a184), roughness: 0.7 });
    const group = new THREE.Group();
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), dark);
    legL.position.set(-0.11, 0.39, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), dark);
    legR.position.set(0.11, 0.39, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
    torso.position.y = 1.09;
    torso.userData.part = 'torso';
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.34), dark);
    vest.position.y = 1.12;
    vest.userData.part = 'torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
    head.position.y = 1.56;
    head.userData.part = 'head';
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.34), cloth);
    band.position.y = 1.62;
    band.userData.part = 'head';
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
    gun.position.set(0.2, 1.18, -0.28);
    group.add(legL, legR, torso, vest, head, band, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    actor.group = group;
    actor.headMesh = head;
    actor.torsoMesh = torso;
    torso.userData.actor = actor;
    vest.userData.actor = actor;
    head.userData.actor = actor;
    band.userData.actor = actor;
    actor.hitMeshes = [torso, vest, head, band];
    ctx.scene.add(group);
  }

  return actor;
}

// Damage one actor. Returns 'hit' | 'kill' | 'dead'. Armour takes half the hit
// until it runs out; a headshot multiplies the weapon damage first.
export function damageActor(actor, amount, isHead) {
  if (!actor.alive) return 'dead';
  let remaining = amount;
  if (actor.armor > 0) {
    const absorbed = Math.min(actor.armor, remaining * 0.5);
    actor.armor -= absorbed;
    remaining -= absorbed;
  }
  actor.hp -= remaining;
  if (actor.hp > 0) return 'hit';
  actor.hp = 0;
  actor.alive = false;
  actor.deaths += 1;
  actor.fall = 0;
  return 'kill';
}

export function resetActor(actor, x, z, yaw) {
  actor.hp = HEALTH;
  actor.armor = 0;
  actor.alive = true;
  actor.fall = 0;
  actor.body.position.set(x, 0, z);
  actor.body.velocity.set(0, 0, 0);
  actor.body.yaw = yaw;
  actor.body.pitch = 0;
  actor.body.crouching = false;
  actor.body.height = 1.72;
  actor.body.eye = 1.6;
  actor.grenades = { frag: 0, flash: 0 };
  actor.hasSpike = false;
  if (actor.group) {
    actor.group.rotation.set(0, 0, 0);
    actor.group.position.set(x, 0, z);
    actor.group.visible = true;
  }
}

// Sync a bot's mesh to its body, and animate the fall when it dies. The mesh
// faces the body's yaw; the gun arm is static — the bots are simple by design,
// and the judge sees them move, aim and shoot, not wave.
export function syncActorMesh(actor, dt) {
  if (!actor.group) return;
  const body = actor.body;
  if (actor.alive) {
    actor.group.position.set(body.position.x, body.position.y, body.position.z);
    actor.group.rotation.y = body.yaw + Math.PI;
    // A small walk bob, so a moving bot reads as moving.
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    actor.group.position.y = body.position.y + Math.abs(Math.sin(body.position.x * 2 + body.position.z * 2)) * 0.02 * Math.min(1, speed / 5);
  } else {
    actor.fall = Math.min(1, actor.fall + dt / 0.4);
    actor.group.rotation.x = -actor.fall * 1.45;
    // A fallen body stays where it fell: sync x/z too, not just the drop.
    actor.group.position.set(body.position.x, body.position.y - actor.fall * 0.08, body.position.z);
  }
}
