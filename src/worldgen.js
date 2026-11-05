// ---------------------------------------------------------------------------
// WorldGen — the "hand-shaped" terrain of Cube Hollow.
//
// Design notes (why it feels handmade):
//  - strong domain warping → organic, un-machine-like flow of the land
//  - terracing with IRREGULAR step heights → ledges like a gardener shaped them
//  - crisp edges: plateaus are flat, transitions steep (smoothstep-sharpened)
//  - a meandering carved river with soft banks, plus winding dirt trails
//  - moisture noise drives patchy grass color; sediment strata band the cliffs
// ---------------------------------------------------------------------------
import { Noise, clamp, lerp, smoothstep, hash2 } from './noise.js';

export const WATER_LEVEL = 0.0;
export const CHUNK_SIZE = 16;
export const VIEW_CHUNKS = 6; // radius in chunks

export class WorldGen {
  constructor(seed = 20261105) {
    this.nBase    = new Noise(seed);
    this.nWarpA   = new Noise(seed + 101);
    this.nWarpB   = new Noise(seed + 202);
    this.nRiver   = new Noise(seed + 303);
    this.nDetail  = new Noise(seed + 404);
    this.nMoist   = new Noise(seed + 505);
    this.nPath    = new Noise(seed + 606);
    this.nCliff   = new Noise(seed + 707);
    this.nForest  = new Noise(seed + 808);
    this.nFlower  = new Noise(seed + 909);
  }

  // warped coordinates
  warp(x, z) {
    const wx = x + 55 * this.nWarpA.fbm(x * 0.006, z * 0.006, 3);
    const wz = z + 55 * this.nWarpB.fbm(x * 0.006, z * 0.006, 3);
    return [wx, wz];
  }

  // river distance field: 0 = center of river, 1 = far away
  riverField(x, z) {
    const [wx, wz] = this.warp(x, z);
    const r = this.nRiver.fbm(wx * 0.0045, wz * 0.0045, 3);
    return Math.abs(r);
  }

  riverMask(x, z) {
    // 1 inside river, fading out at the banks
    return 1 - smoothstep(0.028, 0.09, this.riverField(x, z));
  }

  pathMask(x, z) {
    const [wx, wz] = this.warp(x, z);
    const p = this.nPath.fbm(wx * 0.006 + 7.7, wz * 0.006 + 3.3, 2);
    return 1 - smoothstep(0.02, 0.07, Math.abs(p));
  }

  moisture(x, z) {
    return this.nMoist.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
  }

  forestDensity(x, z) {
    return this.nForest.fbm(x * 0.01, z * 0.01, 3) * 0.5 + 0.5;
  }

  // main height function (world y). Consistent for terrain, player, props.
  height(x, z) {
    const [wx, wz] = this.warp(x, z);

    // base continent shape: gentle valleys and rises
    let e = this.nBase.fbm(wx * 0.008, wz * 0.008, 4);          // [-1,1]
    e = clamp(e * 0.5 + 0.5, 0, 1);                              // [0,1]
    e = Math.pow(e, 1.25);                                       // favor valleys

    let h = lerp(0.6, 12.5, e);

    // ---- terracing with irregular steps ----
    const stepNoise = this.nDetail.noise2(wx * 0.01, wz * 0.01);  // [-1,1]
    const step = 1.7 + 0.9 * stepNoise;                          // irregular ledges
    const k = h / step;
    const f = Math.floor(k);
    const frac = k - f;
    // flat plateau, then a quick (but not instant) rise → crisp hand-cut ledges
    const sharp = smoothstep(0.62, 0.94, frac);
    h = (f + sharp) * step;

    // ---- rocky cliff outcrops ----
    const cliffN = this.nCliff.ridged(wx * 0.012, wz * 0.012, 3); // [0,1]
    const cliffMask = smoothstep(0.68, 0.88, cliffN);
    h += cliffMask * 2.2 * (0.7 + 0.3 * this.nDetail.noise2(x * 0.05, z * 0.05));

    // ---- small hand-placed feeling bumps ----
    h += this.nDetail.fbm(x * 0.045, z * 0.045, 2) * 0.35;

    // ---- river carving ----
    const river = this.riverMask(x, z);
    const carve = smoothstep(0.18, 0.9, river);
    h = lerp(h, -1.7, carve);

    // ---- trail flattening (slightly) ----
    const path = this.pathMask(x, z);
    h = lerp(h, h * 0.97 + 0.05, path * 0.6);

    return h;
  }

  // bilinear sample on the same 1 m grid the mesh uses — keeps props glued to the visible ground
  heightMesh(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const h00 = this.height(x0, z0), h10 = this.height(x0 + 1, z0);
    const h01 = this.height(x0, z0 + 1), h11 = this.height(x0 + 1, z0 + 1);
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  // surface type at a point: 'grass' | 'dirt' | 'rock' | 'sand'
  surface(x, z, h, slope) {
    const path = this.pathMask(x, z);
    const river = this.riverMask(x, z);
    if (h < WATER_LEVEL + 0.45) return 'sand';
    if (slope > 0.75) return 'rock';
    if (path > 0.45 || river > 0.55) return 'dirt';
    return 'grass';
  }
}

// deterministic scattered prop placement for a chunk
export function chunkProps(world, cx, cz) {
  const props = [];
  const cell = 2.0; // try one prop per 2x2 m cell
  const n = Math.floor(CHUNK_SIZE / cell);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rx = cx * CHUNK_SIZE + (i + hash2(cx * 131 + i, cz * 197 + j)) * cell;
      const rz = cz * CHUNK_SIZE + (j + hash2(cz * 89 + j, cx * 211 + i)) * cell;
      const r = hash2(Math.floor(rx * 7), Math.floor(rz * 13));
      const h = world.height(rx, rz);
      if (h < WATER_LEVEL + 0.5) continue;
      // slope check via finite difference
      const e = 0.5;
      const sx = (world.height(rx + e, rz) - world.height(rx - e, rz)) / (2 * e);
      const sz = (world.height(rx, rz + e) - world.height(rx, rz - e)) / (2 * e);
      const slope = Math.hypot(sx, sz);
      if (slope > 0.8) continue;
      const surface = world.surface(rx, rz, h, slope);
      const forest = world.forestDensity(rx, rz);
      if (surface === 'grass') {
        if (r < forest * 0.22 && slope < 0.5) {
          props.push({ type: r < forest * 0.11 ? 'pine' : 'tree', x: rx, z: rz, y: h, r: hash2(i + 99, j + 55) });
        } else if (r < forest * 0.22 + 0.10) {
          props.push({ type: 'bush', x: rx, z: rz, y: h, r: hash2(i + 3, j + 8) });
        } else if (r < forest * 0.22 + 0.13) {
          props.push({ type: 'rock', x: rx, z: rz, y: h, r: hash2(i + 4, j + 2) });
        } else if (r < forest * 0.22 + 0.15) {
          props.push({ type: 'stump', x: rx, z: rz, y: h, r: hash2(i + 6, j + 1) });
        } else if (r < forest * 0.22 + 0.175) {
          props.push({ type: 'log', x: rx, z: rz, y: h, r: hash2(i + 21, j + 34) });
        } else if (r < forest * 0.22 + 0.19) {
          props.push({ type: 'flowers', x: rx, z: rz, y: h, r: hash2(i + 77, j + 12) });
        } else if (r < forest * 0.22 + 0.20) {
          props.push({ type: 'mushroom', x: rx, z: rz, y: h, r: hash2(i + 43, j + 91) });
        }
      }
    }
  }
  return props;
}
