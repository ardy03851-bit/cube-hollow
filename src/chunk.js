// ---------------------------------------------------------------------------
// Chunk — builds one 16×16 m tile of the world: terrain mesh, merged props
// (trees, bushes, rocks...), and instanced wind-swaying grass.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import * as BufferGeometryUtils from './BufferGeometryUtils.js';
import { WorldGen, CHUNK_SIZE, WATER_LEVEL } from './worldgen.js';
import { applyWind } from './wind.js';
import { hash2 } from './noise.js';

const RES = 1; // 1 vertex per meter

// palette
const C = {
  grassLush: new THREE.Color('#4e9c3e'),
  grassDry: new THREE.Color('#a9ad55'),
  dirt: new THREE.Color('#a5814f'),
  dirtDark: new THREE.Color('#8a6a41'),
  rock: new THREE.Color('#8a7d6b'),
  sand: new THREE.Color('#d9c48d'),
  pine: new THREE.Color('#3d6b4a'),
  pineDark: new THREE.Color('#335740'),
  canopy: new THREE.Color('#5d8f4e'),
  canopyLight: new THREE.Color('#79a856'),
  trunk: new THREE.Color('#8a6844'),
  trunkDark: new THREE.Color('#75563a'),
  bush: new THREE.Color('#7fa050'),
  rockProp: new THREE.Color('#8d867a'),
  stem: new THREE.Color('#5d7a3d'),
  flowerRed: new THREE.Color('#e2603f'),
  flowerYellow: new THREE.Color('#e8c94f'),
  flowerWhite: new THREE.Color('#f5efe0'),
  mushroom: new THREE.Color('#c94f43'),
  cream: new THREE.Color('#efe3c8'),
};

// shared materials
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
if (new URLSearchParams(location.search).has('shadowdebug')) {
  // paint the directional shadow coordinate (xy) as color to debug shadow receive
  terrainMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_SHADOWMAP
        vec4 sc4 = vDirectionalShadowCoord[0]; sc4.xyz /= sc4.w;
        float md = unpackRGBAToDepth(texture2D(directionalShadowMap[0], sc4.xy));
        gl_FragColor = vec4(md, sc4.z, 0.0, 1.0);
      #else
        gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      #endif`
    );
  };
}
const propMat = applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { mode: 'blob' });
const grassMat = applyWind(
  new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  { mode: 'shear', strength: 1.0 }
);

// grass blade geometry: 3 blades, y in [0,1]
function makeTuftGeometry() {
  const g = new THREE.BufferGeometry();
  const pos = [], col = [], idx = [];
  const blades = 3;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + 0.5;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.055, h = 0.75 + b * 0.12;
    const base = pos.length / 3;
    pos.push(-dz * w, 0, dx * w);
    pos.push(dz * w, 0, -dx * w);
    pos.push(dx * 0.02, h, dz * 0.02);
    // tip slightly brighter
    const c0 = [0.16, 0.42, 0.14], c1 = [0.38, 0.72, 0.24];
    col.push(...c0.map(v => v * 0.9), ...c0, ...c1);
    idx.push(base, base + 1, base + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const tuftGeo = makeTuftGeometry();

// small helper to push a transformed geometry with wind attrs into a list
function pushGeo(list, geo, mat4, color, phase, sway) {
  let g = geo.clone();
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(mat4);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(phase), 1));
  g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n).fill(sway), 1));
  list.push(g);
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
function mat(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  Q.setFromEuler(new THREE.Euler(rx, ry, rz));
  return M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)).clone();
}

// cached primitive geometries
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  cone: new THREE.ConeGeometry(1, 1, 7),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
};

function addPine(list, p, world, x, z, yBase) {
  const h = world.heightMesh(x, z);
  const s = 0.8 + p * 0.6;
  const ry = p * Math.PI * 2;
  pushGeo(list, G.cyl, mat(x, h + 0.5 * s, z, ry, 0.16, 1.0, 0.16), C.trunkDark, 0, 0);
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const r = (1.5 - i * 0.34) * s;
    const ly = h + (1.0 + i * 0.85) * s;
    const col = i === layers - 1 ? C.pine : C.pineDark;
    pushGeo(list, G.cone, mat(x, ly, z, ry, r, 1.15 * s, r), col, hash2(x * 3 + i, z * 7) , 0.04 + i * 0.05);
  }
}

function addTree(list, p, world, x, z) {
  const h = world.heightMesh(x, z);
  const s = 0.85 + p * 0.5;
  const ry = p * Math.PI * 2;
  pushGeo(list, G.cyl, mat(x, h + 0.8 * s, z, ry, 0.2, 1.6 * s, 0.2), C.trunk, 0, 0);
  const blobs = 5 + Math.floor(p * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + p * 3;
    const rr = 0.55 * s * (0.4 + hash2(i, x + z) * 0.6);
    const bx = x + Math.cos(a) * 0.5 * s;
    const bz = z + Math.sin(a) * 0.5 * s;
    const by = h + (1.7 + Math.sin(i * 2.1) * 0.35 + hash2(i * 7, z) * 0.5) * s;
    const br = (0.55 + hash2(i + 40, x) * 0.4) * s;
    const light = i / blobs;
    const col = C.canopy.clone().lerp(C.canopyLight, light * 0.8 + hash2(i, i) * 0.2);
    pushGeo(list, G.ico, mat(bx, by, bz, 0, br, br * 0.92, br), col, hash2(bx * 5, bz * 9), 0.12);
  }
}

function addBush(list, p, x, z, y) {
  const s = 0.8 + p * 0.6;
  const blobs = 4 + Math.floor(p * 3);
  for (let i = 0; i < blobs; i++) {
    const a = hash2(i * 31, x * 17 + z) * Math.PI * 2;
    const bx = x + Math.cos(a) * (0.18 + hash2(i, z) * 0.22);
    const bz = z + Math.sin(a) * (0.18 + hash2(i + 9, x) * 0.22);
    const by = y + 0.22 * s + hash2(i * 3, x * z) * 0.18;
    const br = (0.3 + hash2(i + 77, x + z) * 0.25) * s;
    const col = C.bush.clone().lerp(C.canopyLight, hash2(i * 5, z) * 0.35);
    pushGeo(list, G.ico, mat(bx, by, bz, 0, br, br * 0.85, br), col, hash2(bx * 11, bz * 13), 0.3);
  }
}

function addRock(list, p, x, z, y) {
  const s = 0.35 + p * 0.75;
  const col = C.rockProp.clone().lerp(new THREE.Color('#6e675c'), p * 0.5);
  pushGeo(list, G.ico, mat(x, y + s * 0.3, z, p * 7, s, s * 0.7, s * 0.9), col, 0, 0);
}

function addStump(list, p, x, z, y) {
  const s = 0.5 + p * 0.3;
  pushGeo(list, G.cyl, mat(x, y + s * 0.4, z, 0, s, s * 0.8, s), C.trunk, 0, 0);
  pushGeo(list, G.cyl, mat(x, y + s * 0.82, z, 0, s * 0.85, 0.08, s * 0.85), C.cream, 0, 0);
}

function addLog(list, p, x, z, y) {
  const ry = hash2(x, z) * Math.PI;
  const s = 0.8 + p * 0.6;
  pushGeo(list, G.cyl, mat(x, y + 0.22, z, ry, 0.2, s, 0.2, Math.PI / 2), C.trunk, 0, 0);
  pushGeo(list, G.cyl, mat(x + Math.cos(ry) * s * 0.5, y + 0.22, z - Math.sin(ry) * s * 0.5, ry, 0.18, 0.06, 0.18, Math.PI / 2), C.cream, 0, 0);
}

function addFlowers(list, p, x, z, y) {
  const n = 3 + Math.floor(p * 3);
  const cols = [C.flowerRed, C.flowerYellow, C.flowerWhite];
  for (let i = 0; i < n; i++) {
    const fx = x + (hash2(i * 13, x) - 0.5) * 1.4;
    const fz = z + (hash2(i * 17, z) - 0.5) * 1.4;
    const fh = 0.22 + hash2(i, x * z) * 0.12;
    pushGeo(list, G.box, mat(fx, y + fh * 0.5, fz, 0, 0.03, fh, 0.03), C.stem, hash2(fx, fz), 0.25);
    const col = cols[Math.floor(hash2(i * 7, fx * 3) * 3)];
    pushGeo(list, G.ico, mat(fx, y + fh, fz, 0, 0.08, 0.08, 0.08), col, hash2(fx, fz), 0.3);
  }
}

function addMushroom(list, p, x, z, y) {
  const s = 0.5 + p * 0.4;
  pushGeo(list, G.cyl, mat(x, y + 0.14 * s, z, 0, 0.07 * s, 0.28 * s, 0.07 * s), C.cream, 0, 0);
  pushGeo(list, G.ico, mat(x, y + 0.3 * s, z, 0, 0.2 * s, 0.13 * s, 0.2 * s), C.mushroom, 0, 0);
}

// ---------------- waterfalls ----------------
// translucent falling-water ribbons on river banks, with foam at the base
const wfTextures = [];
function makeWaterfallMaterial() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(190,220,238,0.55)');
  grad.addColorStop(0.5, 'rgba(235,248,255,0.92)');
  grad.addColorStop(1, 'rgba(190,220,238,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 64;
    const w = 1 + Math.random() * 2.5;
    const y = Math.random() * 256;
    const len = 20 + Math.random() * 90;
    g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    g.fillRect(x, y, w, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  wfTextures.push(tex);
  return new THREE.MeshLambertMaterial({
    map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    emissive: new THREE.Color('#9db8cc'), emissiveIntensity: 0.18,
  });
}
const waterfallMat = makeWaterfallMaterial();
const waterfallFoamMat = new THREE.MeshLambertMaterial({
  color: '#f2f8fa', transparent: true, opacity: 0.7,
});
export function tickWaterfalls(dt) {
  for (const t of wfTextures) t.offset.y -= dt * 0.85;
}

export class Chunk {
  constructor(scene, world, cx, cz, distFromCenter) {
    this.cx = cx; this.cz = cz;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildTerrain(world);
    this.buildProps(world);
    this.buildWaterfalls(world);
    if (distFromCenter <= 3) this.buildGrass(world);
  }

  buildWaterfalls(world) {
    const x0 = this.cx * CHUNK_SIZE, z0 = this.cz * CHUNK_SIZE;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const placed = new Set();
    for (let i = 0; i <= CHUNK_SIZE; i++) {
      for (let j = 0; j <= CHUNK_SIZE; j++) {
        const x = x0 + i, z = z0 + j;
        const h = world.heightMesh(x, z);
        if (h < WATER_LEVEL + 1.6) continue;          // bank must rise above the water
        if (h > WATER_LEVEL + 2.8) continue;           // gentle cascades only, no walls
        if (world.riverMask(x, z) > 0.5) continue;     // we are on the bank, not in the river
        for (const [dx, dz] of dirs) {
          const nx = x + dx, nz = z + dz;
          if (world.riverMask(nx, nz) < 0.9) continue; // neighbor must be deep river
          const kk = `${nx},${nz}`;
          if (placed.has(kk)) continue;
          placed.add(kk);
          // drape a water strip over the real terrain profile, bank crest -> river
          const steps = 14;
          const w = 0.7 + hash2(Math.round(x * 3), Math.round(z * 3)) * 0.5;
          const pos = [], uv = [], index = [];
          let vDist = 0, prevY = null, foamAt = null;
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;                       // 0 = bank centre, 1 = river centre
            const sx = x + dx * t, sz = z + dz * t;
            let y = world.heightMesh(sx, sz) + 0.06;
            if (y < WATER_LEVEL + 0.1) y = WATER_LEVEL + 0.1;  // meet the water surface
            if (prevY !== null) vDist += Math.hypot(1 / steps, y - prevY);
            prevY = y;
            if (foamAt === null && y <= WATER_LEVEL + 0.15) foamAt = [sx, sz];
            const ox = -dz * w / 2, oz = dx * w / 2;
            pos.push(sx + ox, y, sz + oz, sx - ox, y, sz - oz);
            uv.push(0, vDist / 2, 1, vDist / 2);
            if (s > 0) {
              const a = (s - 1) * 2, b = s * 2;
              index.push(a, b, a + 1, a + 1, b, b + 1);
            }
          }
          if (vDist < 1.2) continue;                    // not enough fall to read as a cascade
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          geo.setIndex(index);
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo, waterfallMat);
          this.group.add(mesh);
          // foam disc where the water lands
          const fx = foamAt ? foamAt[0] : x + dx * 0.8;
          const fz = foamAt ? foamAt[1] : z + dz * 0.8;
          const foam = new THREE.Mesh(new THREE.CircleGeometry(w * 0.9, 14), waterfallFoamMat);
          foam.rotation.x = -Math.PI / 2;
          foam.position.set(fx, WATER_LEVEL + 0.08, fz);
          this.group.add(foam);
          break;
        }
      }
    }
  }

  buildTerrain(world) {
    const n = CHUNK_SIZE / RES + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const x0 = this.cx * CHUNK_SIZE, z0 = this.cz * CHUNK_SIZE;
    const heights = new Float32Array(n * n);
    const tmp = new THREE.Color();

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = x0 + i * RES, z = z0 + j * RES;
        const h = world.heightMesh(x, z);
        const k = i * n + j;
        heights[k] = h;
        pos[k * 3] = x - x0; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z - z0;

        // slope
        const e = 0.6;
        const sx = (world.height(x + e, z) - world.height(x - e, z)) / (2 * e);
        const sz = (world.height(x, z + e) - world.height(x, z - e)) / (2 * e);
        const slope = Math.hypot(sx, sz);

        const moist = world.moisture(x, z);
        const path = world.pathMask(x, z);

        let c;
        if (h < WATER_LEVEL + 0.5) {
          c = tmp.copy(C.sand);
        } else if (slope > 0.85) {
          c = tmp.copy(C.rock);
          // painted sediment strata
          const band = 0.8 + 0.2 * Math.sin(h * 2.7);
          c.multiplyScalar(band);
        } else {
          c = tmp.copy(C.grassLush).lerp(C.grassDry, 1 - moist);
          if (slope > 0.55) c.lerp(C.dirt, smoothstep01((slope - 0.55) / 0.3));
          c.lerp(C.dirt, Math.min(1, path * 1.4));
        }
        // hand-painted jitter
        const jit = 0.95 + hash2(Math.floor(x * 3), Math.floor(z * 3)) * 0.1;
        col[k * 3] = c.r * jit; col[k * 3 + 1] = c.g * jit; col[k * 3 + 2] = c.b * jit;
      }
    }

    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();

    const mesh = new THREE.Mesh(g, terrainMat);
    mesh.position.set(x0, 0, z0);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrainMesh = mesh;
  }

  buildProps(world) {
    const x0 = this.cx * CHUNK_SIZE, z0 = this.cz * CHUNK_SIZE;
    const list = [];
    const n = 8; // one prop candidate per 2m cell
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const rx = x0 + (i + hash2(this.cx * 131 + i, this.cz * 197 + j)) * 2;
        const rz = z0 + (j + hash2(this.cz * 89 + j, this.cx * 211 + i)) * 2;
        const r = hash2(Math.floor(rx * 7) + 13, Math.floor(rz * 13) + 7);
        const h = world.heightMesh(rx, rz);
        if (h < WATER_LEVEL + 0.4) continue;
        const e = 0.5;
        const slope = Math.hypot(
          (world.height(rx + e, rz) - world.height(rx - e, rz)) / (2 * e),
          (world.height(rx, rz + e) - world.height(rx, rz - e)) / (2 * e)
        );
        if (slope > 0.7) continue;
        const surface = world.surface(rx, rz, h, slope);
        const forest = world.forestDensity(rx, rz);
        if (surface !== 'grass') continue;
        if (r < forest * 0.16 && slope < 0.45) {
          if (r < forest * 0.07) addPine(list, hash2(i, j), world, rx, rz, h);
          else addTree(list, hash2(i + 5, j + 9), world, rx, rz);
        } else if (r < forest * 0.16 + 0.08) {
          addBush(list, hash2(i + 3, j + 8), rx, rz, h);
        } else if (r < forest * 0.16 + 0.10) {
          addRock(list, hash2(i + 4, j + 2), rx, rz, h);
        } else if (r < forest * 0.16 + 0.115) {
          addStump(list, hash2(i + 6, j + 1), rx, rz, h);
        } else if (r < forest * 0.16 + 0.13) {
          addLog(list, hash2(i + 21, j + 34), rx, rz, h);
        } else if (r < forest * 0.16 + 0.16) {
          addFlowers(list, hash2(i + 77, j + 12), rx, rz, h);
        } else if (r < forest * 0.16 + 0.17) {
          addMushroom(list, hash2(i + 43, j + 91), rx, rz, h);
        }
      }
    }
    if (list.length === 0) return;
    const merged = BufferGeometryUtils.mergeGeometries(list, false);
    list.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, propMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.propMesh = mesh;
  }

  buildGrass(world) {
    const x0 = this.cx * CHUNK_SIZE, z0 = this.cz * CHUNK_SIZE;
    const positions = [];
    const N = 10; // candidates per axis (1.6m grid)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const rx = x0 + (i + hash2(this.cx * 77 + i, this.cz * 33 + j)) * (CHUNK_SIZE / N);
        const rz = z0 + (j + hash2(this.cz * 55 + j, this.cx * 44 + i)) * (CHUNK_SIZE / N);
        const h = world.heightMesh(rx, rz);
        if (h < WATER_LEVEL + 0.35) continue;
        const e = 0.5;
        const slope = Math.hypot(
          (world.height(rx + e, rz) - world.height(rx - e, rz)) / (2 * e),
          (world.height(rx, rz + e) - world.height(rx, rz - e)) / (2 * e)
        );
        if (slope > 0.45) continue;
        if (world.pathMask(rx, rz) > 0.3) continue;
        const moist = world.moisture(rx, rz);
        if (hash2(Math.floor(rx * 11), Math.floor(rz * 17)) > 0.45 + moist * 0.5) continue;
        positions.push(rx, h, rz);
      }
    }
    if (positions.length === 0) return;
    const count = positions.length / 3;
    const mesh = new THREE.InstancedMesh(tuftGeo, grassMat, count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const s = 0.35 + hash2(k, this.cx + this.cz * 31) * 0.45;
      const ry = hash2(k * 7, this.cz * k) * Math.PI * 2;
      m.compose(V.set(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]),
        Q.setFromEuler(new THREE.Euler(0, ry, 0)), S.set(1, s, 1));
      mesh.setMatrixAt(k, m);
      const v = 0.8 + hash2(k * 3, this.cx * 5) * 0.4;
      c.setRGB(v, v * 1.05, v * 0.8);
      mesh.setColorAt(k, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.grassMesh = mesh;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry && o.geometry !== tuftGeo) o.geometry.dispose();
    });
  }
}

function smoothstep01(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
