// ---------------------------------------------------------------------------
// Build — the cozy building system. Place blocks on a 1 m grid, stack them,
// raise terrain platforms, make little homes. Progress is saved locally.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const BLOCK_TYPES = [
  { id: 'grass',   name: 'Grass',    top: '#6da34d', side: '#8a6a41' },
  { id: 'dirt',    name: 'Dirt',     top: '#9b7a4b', side: '#8a6a41' },
  { id: 'stone',   name: 'Stone',    top: '#8d867a', side: '#7a7468' },
  { id: 'wood',    name: 'Wood',    top: '#9c7a4e', side: '#8a6844' },
  { id: 'plank',   name: 'Planks',  top: '#b08d5c', side: '#9c7a4e' },
  { id: 'roof',    name: 'Roof',    top: '#b5674a', side: '#a05840', wedge: true },
  { id: 'window',  name: 'Window',  top: '#cfe6e8', side: '#bfe0e4', emissive: 0x9fd8dd },
  { id: 'door',    name: 'Door',    top: '#7c5c3a', side: '#6d4f30' },
  { id: 'fence',   name: 'Fence',    top: '#9c7a4e', side: '#8a6844', thin: true },
  { id: 'lantern', name: 'Lantern', top: '#ffd98a', side: '#e8b45c', emissive: 0xffc35c, glow: true },
  { id: 'path',    name: 'Path',    top: '#b5a98f', side: '#a3987f', thin: true },
  { id: 'flower',  name: 'Flowers', top: '#e2603f', side: '#5d7a3d' },
];

const geoCache = {};
function geometryFor(type) {
  if (geoCache[type.id]) return geoCache[type.id];
  let g;
  if (type.wedge) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,   // bottom
      0, 1, 1,  1, 1, 1,                        // top edge at the back
    ], 3));
    g.setIndex([
      0, 1, 5,  0, 5, 4,   // slope face
      4, 5, 2,  4, 2, 3,   // back face
      0, 4, 3,             // left
      1, 2, 5,             // right
      0, 3, 2,  0, 2, 1,   // bottom
    ]);
    g.computeVertexNormals();
  } else if (type.thin) {
    g = new THREE.BoxGeometry(1, 0.4, 1);
  } else {
    g = new THREE.BoxGeometry(0.98, 1, 0.98);
  }
  geoCache[type.id] = g;
  return g;
}

export class BuildSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.blocks = new Map(); // "x,y,z" -> { type, mesh }
    this.selected = 0;

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xdff5c9, transparent: true, opacity: 0.45 })
    );
    this.ghost.visible = false;
    scene.add(this.ghost);

    this._mats = new Map();
  }

  materialFor(type) {
    if (this._mats.has(type.id)) return this._mats.get(type.id);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(type.side),
      emissive: type.emissive ? new THREE.Color(type.emissive) : undefined,
      emissiveIntensity: type.emissive ? 0.35 : 0,
      flatShading: true,
    });
    this._mats.set(type.id, mat);
    return mat;
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  targetCell(player) {
    // the cell in front of the player
    const tx = player.pos.x + player.facing.x * 1.5;
    const tz = player.pos.z + player.facing.y * 1.5;
    const cx = Math.round(tx), cz = Math.round(tz);
    // stack height: on top of existing blocks, or terrain
    let y = Math.round(this.world.heightMesh(cx, cz));
    for (let k = y; k < y + 40; k++) {
      if (!this.blocks.has(this.key(cx, k, cz))) { y = k; break; }
      y = k + 1;
    }
    return { cx, cz, y };
  }

  place(player) {
    const { cx, cz, y } = this.targetCell(player);
    const k = this.key(cx, y, cz);
    if (this.blocks.has(k)) return false;
    if (y < -2) return false;
    const type = BLOCK_TYPES[this.selected];
    const mesh = new THREE.Mesh(geometryFor(type), this.materialFor(type));
    mesh.position.set(cx, y + 0.5, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.blockType = type.id;
    this.scene.add(mesh);
    this.blocks.set(k, { type, mesh });
    this.save();
    return true;
  }

  remove(player) {
    // find the nearest block to the target point
    const { cx, cz, y } = this.targetCell(player);
    let best = null, bestD = 4;
    for (let [k, b] of this.blocks) {
      const [x, yy, z] = k.split(',').map(Number);
      const d = Math.hypot(x - cx, z - cz) + Math.abs(yy - y) * 0.8;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best) {
      const b = this.blocks.get(best);
      this.scene.remove(b.mesh);
      this.blocks.delete(best);
      this.save();
      return true;
    }
    return false;
  }

  update(player) {
    const { cx, cz, y } = this.targetCell(player);
    this.ghost.position.set(cx, y + 0.5, cz);
    this.ghost.visible = true;
  }

  cycle(dir = 1) {
    this.selected = (this.selected + dir + BLOCK_TYPES.length) % BLOCK_TYPES.length;
    return this.selected;
  }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const data = {};
      for (let [k, b] of this.blocks) data[k] = b.type.id;
      try { localStorage.setItem('cube-hollow-world', JSON.stringify(data)); } catch (e) {}
    }, 400);
  }

  load() {
    try {
      const raw = localStorage.getItem('cube-hollow-world');
      if (!raw) return;
      const data = JSON.parse(raw);
      for (let [k, id] of Object.entries(data)) {
        const type = BLOCK_TYPES.find(t => t.id === id);
        if (!type) continue;
        const [x, y, z] = k.split(',').map(Number);
        const mesh = new THREE.Mesh(geometryFor(type), this.materialFor(type));
        mesh.position.set(x, y + 0.5, z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.blocks.set(k, { type, mesh });
      }
    } catch (e) {}
  }
}
