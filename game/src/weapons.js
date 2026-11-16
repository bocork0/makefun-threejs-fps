// The armoury. Every weapon is one row: damage, headshot multiplier, magazine,
// fire rate, reload time, the spread standing still and on the move, and the
// price in the buy menu. Stopping to aim pays: spread on the move is ten times
// the spread standing still. The view model is built from boxes, one silhouette
// per weapon, and lives on the camera.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'P9 Sidearm', kind: 'sidearm', price: 0,
    damage: 26, headMult: 3, mag: 12, reserve: 36, fireGap: 0.17, auto: false,
    reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.02, recoil: 0.011, range: 60,
  },
  smg: {
    id: 'smg', name: 'Rook-9 SMG', kind: 'smg', price: 950,
    damage: 22, headMult: 3, mag: 28, reserve: 84, fireGap: 0.085, auto: true,
    reloadTime: 1.7, spreadStill: 0.006, spreadMove: 0.026, recoil: 0.008, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', kind: 'rifle', price: 2700,
    damage: 34, headMult: 3, mag: 30, reserve: 90, fireGap: 0.105, auto: true,
    reloadTime: 1.9, spreadStill: 0.0025, spreadMove: 0.03, recoil: 0.013, range: 80,
  },
  dmr: {
    id: 'dmr', name: 'Longshot DMR', kind: 'dmr', price: 3100,
    damage: 68, headMult: 2.5, mag: 8, reserve: 24, fireGap: 0.55, auto: false,
    reloadTime: 2.4, spreadStill: 0.001, spreadMove: 0.012, recoil: 0.03, range: 100,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, damage: 110, radius: 6.5, fuse: 1.6 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200, radius: 22, fuse: 1.2 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5;

// A weapon's live state: magazine, reserve, cooldown, reload, muzzle flash and
// the view-model kick. One per actor; the definition above never changes.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };
}

export function weaponStep(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.flash = Math.max(0, state.flash - dt);
  state.kick += (0 - state.kick) * Math.min(1, dt * 14);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

export function weaponSpread(state, speed, moveReference = 5.2) {
  return state.def.spreadStill + Math.min(1, speed / moveReference) * state.def.spreadMove;
}

// The first-person view model: a receiver, a barrel and a stock, sized and
// coloured per weapon, plus a muzzle flash plane and a point light. It is
// rebuilt when the player buys a different weapon.
export function createViewModel(camera, def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  const dims = {
    sidearm: { receiver: [0.07, 0.09, 0.26], barrel: [0.04, 0.04, 0.2], stock: [0.06, 0.07, 0.1], y: -0.22, z: -0.4 },
    smg: { receiver: [0.08, 0.09, 0.34], barrel: [0.045, 0.045, 0.3], stock: [0.07, 0.08, 0.16], y: -0.21, z: -0.42 },
    rifle: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], y: -0.2, z: -0.42 },
    dmr: { receiver: [0.09, 0.11, 0.5], barrel: [0.04, 0.04, 0.55], stock: [0.075, 0.08, 0.26], y: -0.2, z: -0.46 },
  }[def.id];
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(...dims.receiver), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...dims.barrel), grip);
  barrel.position.set(0, 0.025, -dims.receiver[2] / 2 - dims.barrel[2] / 2 + 0.05);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(...dims.stock), grip);
  stock.position.set(0, -0.02, dims.receiver[2] / 2 + dims.stock[2] / 2 - 0.04);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), accent);
  sight.position.set(0, 0.07, -0.05);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, dims.y - 0.02, dims.z - 0.05);
  model.scale.setScalar(0.85);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, dims.y + 0.02, dims.z - 0.55);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, dims.y + 0.04, dims.z - 0.2);
  camera.add(flashLight);

  return {
    model,
    flash,
    flashLight,
    dispose() {
      camera.remove(model, flash, flashLight);
    },
    // Called every frame with the weapon state: kick, reload tilt, flash.
    update(state, dt) {
      model.position.z = dims.z - 0.05 + state.kick;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      }
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
    },
  };
}
