// Combat: one hitscan shot, one thrown grenade. Shooting is a ray from the
// shooter's eye along its aim plus spread; the first thing it meets decides:
// a head mesh deals the weapon's head multiplier, a torso mesh deals body
// damage, a wall stops the bullet. Tracers come from a fixed pool of meshes,
// so firing never allocates. Grenades fly with gravity, bounce once off the
// floor, and detonate on their fuse: a frag hurts in a radius, a flash blinds
// anyone looking at it.
import * as THREE from 'three';
import { damageActor } from './actors.js';
import { GRENADES } from './weapons.js';

const TRACER_POOL = 16;
const TRACER_LIFE = 0.09;

export function createCombat(ctx) {
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc65e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    ctx.scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6, metalness: 0.4 });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const blasts = [];
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  function spawnTracer(start, end) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const length = start.distanceTo(end);
    tracer.mesh.position.copy(start).lerp(end, 0.5);
    tracer.mesh.scale.set(1, 1, Math.max(0.1, length));
    tracer.mesh.lookAt(end);
    tracer.mesh.visible = true;
    tracer.mesh.material.opacity = 0.85;
    tracer.life = TRACER_LIFE;
  }

  function spawnBlast(position, radius) {
    const mesh = new THREE.Mesh(flashGeo, flashMat.clone());
    mesh.position.copy(position);
    mesh.scale.setScalar(0.3);
    ctx.scene.add(mesh);
    blasts.push({ mesh, life: 0.35, radius });
  }

  function eyeOf(actor) {
    return from.set(actor.body.position.x, actor.body.position.y + actor.body.eye, actor.body.position.z);
  }

  function aimOf(actor) {
    const cp = Math.cos(actor.body.pitch);
    return dir.set(-Math.sin(actor.body.yaw) * cp, Math.sin(actor.body.pitch), -Math.cos(actor.body.yaw) * cp);
  }

  // One shot. Returns { hit, kill, victim, head } for the HUD and the kill feed.
  function fireShot(shooter, spread, random) {
    const weapon = shooter.weapon;
    if (weapon.mag <= 0) {
      if (shooter.isPlayer) ctx.audio.dryFire();
      return { hit: false, kill: false };
    }
    weapon.mag -= 1;
    weapon.cooldown = weapon.def.fireGap;
    weapon.flash = 0.06;
    weapon.kick = 0.055;
    if (shooter.isPlayer) shooter.mover.recoil(weapon.def.recoil, (random() * 2 - 1) * weapon.def.recoil * 0.3);

    const eye = eyeOf(shooter).clone();
    const aim = aimOf(shooter).clone();
    aim.x += (random() * 2 - 1) * spread;
    aim.y += (random() * 2 - 1) * spread;
    aim.z += (random() * 2 - 1) * spread;
    aim.normalize();

    ctx.raycaster.set(eye, aim);
    ctx.raycaster.far = weapon.def.range;
    const targets = [];
    for (const actor of ctx.actors) {
      if (actor === shooter || !actor.alive) continue;
      for (const mesh of actor.hitMeshes) targets.push(mesh);
    }
    const hits = ctx.raycaster.intersectObjects(ctx.map.shootables.concat(targets), false);
    const hit = hits[0];
    const end = hit ? hit.point.clone() : eye.clone().addScaledVector(aim, weapon.def.range);
    spawnTracer(eye.clone().addScaledVector(aim, 0.6), end);

    // Far shots are quieter for the player; the shooter's own shots are full volume.
    ctx.audio.shot(weapon.def.kind, shooter.isPlayer ? 0 : eye.distanceTo(ctx.player.body.position));
    ctx.noise.push({ x: shooter.body.position.x, z: shooter.body.position.z, time: ctx.time });
    if (ctx.noise.length > 24) ctx.noise.shift();

    if (!hit || !hit.object.userData.actor) return { hit: false, kill: false };
    const victim = hit.object.userData.actor;
    const isHead = hit.object.userData.part === 'head';
    const amount = weapon.def.damage * (isHead ? weapon.def.headMult : 1);
    const result = damageActor(victim, amount, isHead);
    if (shooter.isPlayer) {
      ctx.audio.hit();
      ctx.events.push({ type: 'hit', shooter, victim, head: isHead, kill: result === 'kill', time: ctx.time });
      if (result === 'kill') {
        ctx.audio.kill();
        shooter.kills += 1;
        shooter.money += 300;
      }
    } else if (victim.isPlayer) {
      ctx.audio.hurt();
      ctx.events.push({ type: 'hurt', shooter, victim, time: ctx.time });
    }
    return { hit: true, kill: result === 'kill', victim, head: isHead };
  }

  function throwGrenade(actor, kind, target) {
    const def = GRENADES[kind];
    const start = eyeOf(actor).clone();
    const flat = Math.hypot(target.x - start.x, target.z - start.z);
    const flight = Math.max(0.45, flat / 14);
    const vel = new THREE.Vector3(
      (target.x - start.x) / flight,
      (target.y - start.y) / flight + 0.5 * 9.8 * flight,
      (target.z - start.z) / flight,
    );
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(start);
    ctx.scene.add(mesh);
    grenades.push({ kind, def, pos: start, vel, fuse: def.fuse, mesh, beeped: false });
    ctx.audio.shot('sidearm', 0);
  }

  function detonate(grenade) {
    const pos = grenade.pos;
    spawnBlast(pos, grenade.def.radius);
    if (grenade.kind === 'frag') {
      ctx.audio.explosion();
      for (const actor of ctx.actors) {
        if (!actor.alive) continue;
        const d = Math.hypot(actor.body.position.x - pos.x, actor.body.position.z - pos.z);
        const dy = Math.abs(actor.body.position.y + 1 - pos.y);
        const dist = Math.hypot(d, dy);
        if (dist > grenade.def.radius) continue;
        const amount = grenade.def.damage * (1 - dist / (grenade.def.radius * 1.4));
        const result = damageActor(actor, amount, false);
        if (result === 'kill') {
          ctx.events.push({ type: 'kill', shooter: null, victim: actor, head: false, time: ctx.time });
        }
      }
      ctx.noise.push({ x: pos.x, z: pos.z, time: ctx.time });
    } else {
      ctx.audio.flashRing();
      // Whoever can see the flash, and is facing it, is blinded.
      for (const actor of ctx.actors) {
        if (!actor.alive) continue;
        const d = Math.hypot(actor.body.position.x - pos.x, actor.body.position.z - pos.z);
        if (d > grenade.def.radius) continue;
        const toFlash = new THREE.Vector3(pos.x - actor.body.position.x, pos.y - (actor.body.position.y + actor.body.eye), pos.z - actor.body.position.z).normalize();
        const forward = new THREE.Vector3(-Math.sin(actor.body.yaw), 0, -Math.cos(actor.body.yaw));
        if (forward.dot(toFlash) > -0.1) {
          if (actor.isPlayer) ctx.flashPlayer(Math.max(0.3, 1 - d / grenade.def.radius));
          else if (actor.brain) {
            actor.brain.visibleEnemy = null;
            actor.brain.losTimer = 2.5;
          }
        }
      }
    }
    ctx.scene.remove(grenade.mesh);
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.mesh.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.85;
      if (tracer.life <= 0) tracer.mesh.visible = false;
    }
    for (let i = blasts.length - 1; i >= 0; i -= 1) {
      const blast = blasts[i];
      blast.life -= dt;
      blast.mesh.scale.setScalar(blast.radius * (1 - blast.life / 0.35) + 0.3);
      blast.mesh.material.opacity = Math.max(0, blast.life / 0.35) * 0.8;
      if (blast.life <= 0) {
        ctx.scene.remove(blast.mesh);
        blast.mesh.material.dispose();
        blasts.splice(i, 1);
      }
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 9.8 * dt;
      g.pos.addScaledVector(g.vel, dt);
      if (g.pos.y < 0.1) {
        g.pos.y = 0.1;
        g.vel.y *= -0.4;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0.45 && !g.beeped) {
        g.beeped = true;
        ctx.audio.plantBeep();
      }
      if (g.fuse <= 0) {
        detonate(g);
        grenades.splice(i, 1);
      }
    }
  }

  return { fireShot, throwGrenade, step };
}
