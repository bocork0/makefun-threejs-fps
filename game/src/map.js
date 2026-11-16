// The map: Foundry Yard, a dusk industrial yard the Ember attackers push into
// and the Warden defenders hold. Two plant sites — Silo (west) and Crane (east) —
// three lanes between them (west lane, the foundry hall in the middle, east lane),
// crates and containers for cover, and a waypoint graph the bots route over.
// Everything is boxes, cylinders and planes with standard materials; the floor
// and the hazard markings are painted once on a canvas at load, so the game
// ships no image files at all.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: nodes are [x, z]; edges are pairs of node indices. Bots run
// breadth-first search over it, so a route is always a real walk through the yard.
const NODES = [
  [-3, 11], [3, 11],       // 0,1 ember spawn
  [-12, 8], [-15, 0], [-15, -5], // 2,3,4 west lane
  [-14, -8], [-10, -8],    // 5,6 site A (Silo) and its approach
  [0, 7], [0, 3], [0, -1], [0, -5], [0, -8], // 7..11 mid
  [12, 8], [15, 0], [15, -5], // 12,13,14 east lane
  [14, -8], [10, -8],      // 15,16 site B (Crane) and its approach
  [-3, -11], [3, -11],     // 17,18 warden spawn
  [-5, -8], [5, -8],       // 19,20 warden mid
  [-8, -8], [8, -8],       // 21,22 site connectors
  [-4, -1], [4, -1],       // 23,24 hall sides
];
const EDGES = [
  [0, 2], [1, 12], [0, 7], [1, 7], [2, 3], [3, 4], [4, 5], [4, 21],
  [5, 6], [6, 21], [7, 8], [8, 23], [8, 24], [23, 9], [24, 9], [9, 10],
  [10, 11], [11, 19], [11, 20], [10, 21], [10, 22], [12, 13], [13, 14],
  [14, 15], [14, 22], [15, 16], [16, 22], [17, 19], [18, 20], [19, 21],
  [20, 22], [19, 10], [20, 10], [17, 18], [0, 1], [7, 2], [7, 12],
];

function floorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#262b33';
  g.fillRect(0, 0, 512, 512);
  // Concrete speckle.
  for (let i = 0; i < 5200; i += 1) {
    const v = 28 + Math.random() * 26;
    g.fillStyle = `rgb(${v | 0},${(v + 4) | 0},${(v + 10) | 0})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Expansion joints and a faded centre line down the mid lane.
  g.strokeStyle = 'rgba(10,12,15,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  g.strokeStyle = 'rgba(245,165,36,0.5)';
  g.lineWidth = 5;
  g.setLineDash([26, 18]);
  g.beginPath(); g.moveTo(256, 512); g.lineTo(256, 0); g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 3.5);
  texture.anisotropy = 4;
  return texture;
}

function hazardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1c1f24';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f5a524';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 128); g.lineTo(i + 64, 0); g.lineTo(i + 80, 0); g.lineTo(i + 16, 128);
    g.closePath(); g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0.02 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.85, metalness: 0.05 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8, metalness: 0.25 });
  const emberMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.25 });
  const wardenMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.warden), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(PALETTE.warden), emissiveIntensity: 0.25 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A box collider slightly inside the drum, so bullets and bodies treat it as solid.
    const half = radius * 0.78;
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - half, y - height / 2, z - half),
      new THREE.Vector3(x + half, y + height / 2, z + half),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // Floor, 40 x 28 m, and the four outer walls, 5 m high, open to the dusk sky.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 28), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  box(40.4, 0.4, 28.4, 0, -0.2, 0, materials.canvas);
  box(0.4, 5, 28.4, -20.2, 2.5, 0, materials.surface);
  box(0.4, 5, 28.4, 20.2, 2.5, 0, materials.surface);
  box(40.4, 5, 0.4, 0, 2.5, -14.2, materials.surface);
  box(40.4, 5, 0.4, 0, 2.5, 14.2, materials.surface);

  // The foundry hall in the middle: walls with a door on each side, two pillars.
  box(0.5, 4.2, 3.4, -7, 2.1, -3.3, materials.surface);
  box(0.5, 4.2, 3.4, -7, 2.1, 3.3, materials.surface);
  box(0.5, 4.2, 3.4, 7, 2.1, -3.3, materials.surface);
  box(0.5, 4.2, 3.4, 7, 2.1, 3.3, materials.surface);
  box(5.2, 4.2, 0.5, -4.4, 2.1, 5, materials.surface);
  box(5.2, 4.2, 0.5, 4.4, 2.1, 5, materials.surface);
  box(5.2, 4.2, 0.5, -4.4, 2.1, -5, materials.surface);
  box(5.2, 4.2, 0.5, 4.4, 2.1, -5, materials.surface);
  box(14.5, 0.4, 10.5, 0, 4.4, 0, materials.hairline); // hall roof slab
  box(1.1, 4.2, 1.1, -3, 2.1, -1, materials.hairline);
  box(1.1, 4.2, 1.1, 3, 2.1, -1, materials.hairline);
  // Furnace glow inside the hall: a hot slab and a point light.
  box(2.2, 1.0, 0.8, 0, 0.5, -4.4, emberMat);
  const furnace = new THREE.PointLight(new THREE.Color(PALETTE.ember), 26, 16, 1.8);
  furnace.position.set(0, 1.6, -3.6);
  scene.add(furnace);

  // Site A — Silo: a rusted drum, hazard ring on the floor, low cover walls.
  cylinder(2.3, 5.6, -15, 2.8, -9, rustMat);
  box(2.6, 0.35, 2.6, -15, 5.95, -9, materials.hairline);
  const ringA = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 40), hazardMat);
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(-15, 0.02, -9);
  ringA.receiveShadow = true;
  group.add(ringA);
  box(3.2, 1.15, 0.8, -11.2, 0.58, -11.6, materials.hairline);
  box(0.8, 1.15, 3.0, -18.4, 0.58, -6.4, materials.hairline);

  // Site B — Crane: two legs, a beam, a hanging hook, a raised loading slab.
  box(0.9, 6.4, 0.9, 13.2, 3.2, -11.4, materials.hairline);
  box(0.9, 6.4, 0.9, 16.8, 3.2, -11.4, materials.hairline);
  box(5.4, 0.9, 0.9, 15, 6.6, -11.4, rustMat);
  box(0.5, 1.6, 0.5, 15, 5.2, -11.4, materials.ink);
  const ringB = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 40), hazardMat);
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(15, 0.02, -9);
  ringB.receiveShadow = true;
  group.add(ringB);
  box(4.4, 0.55, 3.4, 15, 0.28, -6.6, materials.surface); // loading slab
  box(3.2, 1.15, 0.8, 11.2, 0.58, -11.6, materials.hairline);

  // Shipping containers and crates: the cover that makes the lanes play.
  box(4.4, 2.5, 2.4, -12, 1.25, 4.5, rustMat);
  box(4.4, 2.5, 2.4, 12, 1.25, 4.5, materials.hairline);
  box(4.4, 2.5, 2.4, -12, 1.25, -3.2, materials.hairline);
  box(4.4, 2.5, 2.4, 12, 1.25, -3.2, rustMat);
  box(1.15, 1.15, 1.15, -6.4, 0.58, 8.6, materials.hairline);
  box(1.15, 1.15, 1.15, -5.2, 0.58, 8.6, materials.hairline);
  box(1.15, 1.15, 1.15, -5.8, 1.73, 8.6, materials.hairline);
  box(1.15, 1.15, 1.15, 6.4, 0.58, 8.6, materials.hairline);
  box(1.15, 1.15, 1.15, -17.6, 0.58, 3.4, materials.hairline);
  box(1.15, 1.15, 1.15, 17.6, 0.58, 3.4, materials.hairline);
  box(1.15, 1.15, 1.15, -8.6, 0.58, -9.6, materials.hairline);
  box(1.15, 1.15, 1.15, 8.6, 0.58, -9.6, materials.hairline);
  box(2.2, 1.1, 1.1, -1.5, 0.55, 10.6, materials.hairline);
  box(2.2, 1.1, 1.1, 1.5, 0.55, 10.6, materials.hairline);

  // Spawn markers: a coloured floor plate so each side reads at a glance.
  const emberPlate = new THREE.Mesh(new THREE.CircleGeometry(2.2, 28), emberMat);
  emberPlate.rotation.x = -Math.PI / 2;
  emberPlate.position.set(0, 0.02, 11.5);
  group.add(emberPlate);
  const wardenPlate = new THREE.Mesh(new THREE.CircleGeometry(2.2, 28), wardenMat);
  wardenPlate.rotation.x = -Math.PI / 2;
  wardenPlate.position.set(0, 0.02, -11.5);
  group.add(wardenPlate);

  // Light: low amber sun from the west, cool fill, and a dusk sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a7a68), new THREE.Color(0x1a1d24), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb45e), 2.4);
  sun.position.set(-16, 13, 6);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x7d94b8), 0.7);
  fill.position.set(12, 10, 12);
  scene.add(fill);

  const waypoints = NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    sites: [
      { id: 'A', name: 'Silo', center: new THREE.Vector3(-15, 0, -9), radius: 4.2 },
      { id: 'B', name: 'Crane', center: new THREE.Vector3(15, 0, -9), radius: 4.2 },
    ],
    spawns: {
      ember: [new THREE.Vector3(-4, 0, 11.5), new THREE.Vector3(-1.5, 0, 12), new THREE.Vector3(1.5, 0, 12), new THREE.Vector3(4, 0, 11.5)],
      warden: [new THREE.Vector3(-4, 0, -11.5), new THREE.Vector3(-1.5, 0, -12), new THREE.Vector3(1.5, 0, -12), new THREE.Vector3(4, 0, -11.5)],
    },
    waypoints,
    adjacency,
    siteNodes: { A: 5, B: 15 },
    emberNodes: [0, 1],
    wardenNodes: [17, 18],
  };
}
