// ---------------------------------------------------------------------------
// Cube Hollow — main. A cozy 2.5D valley where you build your little home.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { WorldGen, CHUNK_SIZE, VIEW_CHUNKS, WATER_LEVEL } from './worldgen.js';
import { Chunk } from './chunk.js';
import { Player } from './player.js';
import { Input } from './controls.js';
import { BuildSystem, BLOCK_TYPES } from './build.js';
import { updateWind, setWindDirection } from './wind.js';
import { clamp, lerp, hash2 } from './noise.js';

// ---------------- renderer ----------------
const canvas = document.getElementById('game');
const params = new URLSearchParams(location.search);
document.title = 'Cube Hollow dev9';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: params.has('pdb') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !params.has('noshadow');
const FOG = !params.has('nofog');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a8cfd4');
scene.fog = new THREE.Fog('#a8cfd4', 70, 145);
if (!FOG) scene.fog = null;

// ---------------- fixed isometric camera ----------------
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
const CAM_YAW = Math.PI / 4;      // 45°
const CAM_PITCH = THREE.MathUtils.degToRad(38);
const VIEW = 10.5;               // half height in world units
function resizeCamera() {
  const a = innerWidth / innerHeight;
  camera.left = -VIEW * a; camera.right = VIEW * a;
  camera.top = VIEW; camera.bottom = -VIEW;
  camera.updateProjectionMatrix();
}
resizeCamera();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  resizeCamera();
});

const camOffset = new THREE.Vector3(
  Math.sin(CAM_YAW) * Math.cos(CAM_PITCH),
  Math.sin(CAM_PITCH),
  Math.cos(CAM_YAW) * Math.cos(CAM_PITCH)
).multiplyScalar(60);
const camTarget = new THREE.Vector3();

// ---------------- world ----------------
const world = new WorldGen(20261105);
const chunks = new Map();
const chunkQueue = [];

function chunkKey(cx, cz) { return cx + ',' + cz; }

function ensureChunks(px, pz) {
  const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
  for (let r = 0; r <= VIEW_CHUNKS; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = pcx + dx, cz = pcz + dz;
        if (chunks.has(chunkKey(cx, cz))) continue;
        chunks.set(chunkKey(cx, cz), 'queued');
        chunkQueue.push({ cx, cz, dist: Math.hypot(dx, dz) });
      }
    }
  }
  // build a couple per frame
  let budget = 2;
  chunkQueue.sort((a, b) => a.dist - b.dist);
  while (budget-- > 0 && chunkQueue.length) {
    const { cx, cz, dist } = chunkQueue.shift();
    chunks.set(chunkKey(cx, cz), new Chunk(scene, world, cx, cz, Math.round(dist)));
  }
  // unload far chunks
  for (let [k, c] of chunks) {
    if (c === 'queued') continue;
    const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
    if (d > VIEW_CHUNKS + 1) { c.dispose(scene); chunks.delete(k); }
  }
}

// ---------------- lights ----------------
const hemi = new THREE.HemisphereLight('#cfe8e4', '#8a9a6a', 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3d6', 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.06;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// ---------------- water ----------------
const waterGeo = new THREE.PlaneGeometry(420, 420);
waterGeo.rotateX(-Math.PI / 2);
const waterMat = new THREE.MeshLambertMaterial({
  color: '#6fb3c4', transparent: true, opacity: 0.82,
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.position.y = WATER_LEVEL - 0.12;
scene.add(water);
if (params.has('nowater')) water.visible = false;
const foamCanvas = document.createElement('canvas');
foamCanvas.width = foamCanvas.height = 256;
const fx = foamCanvas.getContext('2d');
for (let i = 0; i < 900; i++) {
  fx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.09})`;
  const r = 2 + Math.random() * 14;
  fx.beginPath();
  fx.arc(Math.random() * 256, Math.random() * 256, r, 0, 7);
  fx.fill();
}
const foamTex = new THREE.CanvasTexture(foamCanvas);
foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
foamTex.repeat.set(6, 6);
const foamMat = new THREE.MeshBasicMaterial({
  map: foamTex, transparent: true, opacity: 0.5, depthWrite: false,
});
const foam = new THREE.Mesh(waterGeo, foamMat);
foam.position.y = WATER_LEVEL - 0.1;
scene.add(foam);
if (params.has('nowater')) foam.visible = false;

// ---------------- player ----------------
const player = new Player(scene);
(function findSpawn() {
  let best = null;
  const flat = (x, z) => {
    // require gentle surroundings so the cube stays visible from the iso camera
    const h0 = world.height(x, z);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(world.height(x + dx, z + dz) - h0) > 1.4) return false;
    }
    return true;
  };
  outer:
  for (let r = 0; r < 120; r += 3) {
    for (let a = 0; a < 24; a++) {
      const x = Math.cos(a / 24 * Math.PI * 2) * r;
      const z = Math.sin(a / 24 * Math.PI * 2) * r;
      const h = world.height(x, z);
      if (h > 1.5 && h < 6 && world.riverMask(x, z) < 0.1 && world.pathMask(x, z) < 0.2 && flat(x, z)) {
        best = [x, z]; break outer;
      }
    }
  }
  const [sx, sz] = best || [0, 0];
  player.pos.set(sx, world.heightMesh(sx, sz) + 0.31, sz);
  player.pos.y = world.heightMesh(sx, sz) + 0.31;
  player.mesh.position.copy(player.pos);
})();

// ---------------- input & build ----------------
const input = new Input();
const build = new BuildSystem(scene, world);
build.load();

// hotbar
const hotbar = document.getElementById('hotbar');
BLOCK_TYPES.forEach((t, i) => {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.i = i;
  const img = document.createElement('img');
  img.src = `art/icons/${t.id}.png`;
  img.alt = t.name;
  img.draggable = false;
  el.appendChild(img);
  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = (i + 1) % 10;
  el.appendChild(key);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); selectSlot(i); });
  hotbar.appendChild(el);
});
function selectSlot(i) {
  build.selected = i;
  document.querySelectorAll('.slot').forEach((el, j) => el.classList.toggle('selected', j === i));
}
selectSlot(0);
addEventListener('keydown', (e) => {
  const n = parseInt(e.key);
  if (!isNaN(n)) selectSlot((n + 9) % BLOCK_TYPES.length);
});

// ---------------- particles: drifting pollen ----------------
const moteCount = 40;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(moteCount * 3);
const moteSeed = new Float32Array(moteCount);
for (let i = 0; i < moteCount; i++) {
  motePos[i * 3] = (hash2(i, 1) - 0.5) * 50;
  motePos[i * 3 + 1] = 1 + hash2(i, 2) * 6;
  motePos[i * 3 + 2] = (hash2(i, 3) - 0.5) * 50;
  moteSeed[i] = hash2(i, 4) * 100;
}
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
  color: '#fff6d8', size: 0.14, transparent: true, opacity: 0.7,
}));
scene.add(motes);

// ---------------- debug channel (DOM-based, works from devtools/automation) ----------------
const debugCmd = document.createElement('div');
debugCmd.id = 'debug-cmd';
debugCmd.style.display = 'none';
document.body.appendChild(debugCmd);
let lastCmd = '';
function runDebug() {
  const cmd = debugCmd.textContent.trim();
  if (cmd === lastCmd) return;
  lastCmd = cmd;
  const [verb, arg] = cmd.split(':');
  const setLayer = (name, v) => {
    for (const c of chunks.values()) {
      if (c === 'queued') continue;
      if (name === 'grass' && c.grassMesh) c.grassMesh.visible = v;
      if (name === 'props' && c.propMesh) c.propMesh.visible = v;
      if (name === 'terrain' && c.terrainMesh) c.terrainMesh.visible = v;
    }
  };
  if (verb === 'hide') setLayer(arg, false);
  if (verb === 'show') setLayer(arg, true);
  if (verb === 'say') document.title = arg;
  if (verb === 'stats') document.title = `chunks=${chunks.size} queue=${chunkQueue.length} pos=${player.pos.x.toFixed(0)},${player.pos.z.toFixed(0)}`;
  if (verb === 'pm') document.title = `mesh ${player.mesh.position.x.toFixed(1)},${player.mesh.position.y.toFixed(1)},${player.mesh.position.z.toFixed(1)} vis=${player.mesh.visible} parent=${!!player.mesh.parent}`;
  if (verb === 'big') {
    player.mesh.material.color.set('#ff2222');
    player.mesh.scale.set(3, 3, 3);
    document.title = 'big red player set';
  }
  if (verb === 'sh') {
    sun.castShadow = arg === 'on';
    renderer.shadowMap.enabled = arg === 'on';
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    document.title = 'shadows ' + arg;
  }
  if (verb === 'time') {
    timeOfDay = parseFloat(arg);
    document.title = 'time set ' + arg;
  }
  if (verb === 'si') {
    document.title = `sm=${renderer.shadowMap.enabled} cast=${sun.castShadow} map=${!!sun.shadow.map} terr=${[...chunks.values()].find(c => c !== 'queued' && c.terrainMesh)?.terrainMesh.receiveShadow} props=${[...chunks.values()].find(c => c !== 'queued' && c.propMesh)?.propMesh.castShadow}`;
  } else if (verb === 'scam') {
    const c = sun.shadow.camera;
    const m = sun.shadow.matrix.elements.map(v => v.toFixed(3)).join(',');
    document.title = `near=${c.near} far=${c.far} L=${c.left} R=${c.right} T=${c.top} B=${c.bottom} sunpos=${sun.position.toArray().map(v => v.toFixed(1))} tgt=${sun.target.position.toArray().map(v => v.toFixed(1))} pmat=${c.projectionMatrix.elements.map(v => v.toFixed(2)).join(',')} smat=${m}`;
  }
  if (verb === 'mapdump') {
    const src = (window.__s2 || sun).shadow.map;
    if (!src) { document.title = 'no shadow map'; return; }
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        depthTest: false,
        uniforms: { t: { value: src.texture } },
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D t; void main(){ float d = texture2D(t, vec2(gl_FragCoord.x/2048.0, gl_FragCoord.y/2048.0)).r; gl_FragColor = vec4(vec3(d), 1.0); }`,
      })
    );
    quad.frustumCulled = false;
    quad.renderOrder = 9999;
    scene.add(quad);
    document.title = 'map dumped';
  }
  if (verb === 'newsun') {
    scene.remove(sun);
    const s2 = new THREE.DirectionalLight('#fff3d6', 1.35);
    s2.castShadow = true;
    s2.shadow.mapSize.set(2048, 2048);
    s2.shadow.camera.left = -30; s2.shadow.camera.right = 30;
    s2.shadow.camera.top = 30; s2.shadow.camera.bottom = -30;
    s2.shadow.camera.far = 200;
    s2.shadow.bias = -0.0002;
    s2.shadow.normalBias = 0.06;
    s2.shadow.camera.updateProjectionMatrix();
    s2.position.set(player.pos.x + 27, 35, player.pos.z + 22);
    scene.add(s2);
    scene.add(s2.target);
    s2.target.position.copy(player.pos);
    window.__s2 = s2;
    document.title = 'new sun set';
  }
}


// fireflies
const ffCount = 24;
const ffGeo = new THREE.BufferGeometry();
const ffPos = new Float32Array(ffCount * 3);
for (let i = 0; i < ffCount; i++) {
  ffPos[i * 3] = (hash2(i, 9) - 0.5) * 60;
  ffPos[i * 3 + 1] = 1.5 + hash2(i, 10) * 4;
  ffPos[i * 3 + 2] = (hash2(i, 11) - 0.5) * 60;
}
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({
  color: '#ffe98a', size: 0.22, transparent: true, opacity: 0,
}));
scene.add(fireflies);

// ---------------- day cycle ----------------
const DAY_LENGTH = 300; // seconds
let timeOfDay = 0.35;   // start mid-morning
const skyPalettes = {
  night:   { sky: '#232c3e', fog: '#2a3448', sun: 0.12, hemi: 0.18, sunCol: '#8aa8ff' },
  dawn:    { sky: '#e8b98a', fog: '#e3b58f', sun: 1.1,  hemi: 0.5,  sunCol: '#ffd9a0' },
  day:     { sky: '#a8cfd4', fog: '#a8cfd4', sun: 1.35, hemi: 0.5, sunCol: '#fff3d6' },
  dusk:    { sky: '#e89a6a', fog: '#dd9873', sun: 0.9,  hemi: 0.4,  sunCol: '#ffb37a' },
};
function updateDay(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const t = timeOfDay;
  let a, b, f;
  if (t < 0.23) { a = skyPalettes.night; b = skyPalettes.dawn; f = smooth01(t / 0.23); }
  else if (t < 0.33) { a = skyPalettes.dawn; b = skyPalettes.day; f = smooth01((t - 0.23) / 0.1); }
  else if (t < 0.68) { a = skyPalettes.day; b = skyPalettes.day; f = 0; }
  else if (t < 0.78) { a = skyPalettes.day; b = skyPalettes.dusk; f = smooth01((t - 0.68) / 0.1); }
  else if (t < 0.85) { a = skyPalettes.dusk; b = skyPalettes.night; f = smooth01((t - 0.78) / 0.07); }
  else { a = skyPalettes.night; b = skyPalettes.night; f = 0; }

  scene.background.set(a.sky).lerp(new THREE.Color(b.sky), f);
  scene.fog.color.copy(scene.background);
  sun.intensity = lerp(a.sun, b.sun, f);
  hemi.intensity = lerp(a.hemi, b.hemi, f);
  sun.color.set(a.sunCol).lerp(new THREE.Color(b.sunCol), f);

  // sun path: arcs across the sky
  const ang = (t - 0.25) * Math.PI * 2;
  const elevation = Math.max(0, Math.sin(ang));
  sun.position.set(player.pos.x + Math.cos(ang) * 34, 6 + elevation * 50, player.pos.z - 22);

  // fireflies at night
  const nightness = 1 - smooth01(elevation / 0.25);
  fireflies.material.opacity = nightness * 0.95;
  fireflies.visible = nightness > 0.01;

  // clock
  const hours = Math.floor(t * 24), mins = Math.floor((t * 24 % 1) * 60);
  document.getElementById('clock').textContent =
    `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

// ---------------- UI ----------------
const titleScreen = document.getElementById('title-screen');
const startBtn = document.getElementById('start-btn');
const hud = document.getElementById('hud');
const touchUI = document.getElementById('touch-ui');
const hint = document.getElementById('hint');
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

startBtn.addEventListener('click', () => {
  titleScreen.classList.add('fade-out');
  setTimeout(() => titleScreen.remove(), 900);
  hud.classList.remove('hidden');
  if (isTouch) touchUI.classList.remove('hidden');
  hint.textContent = isTouch
    ? 'drag the joystick to wander — place blocks with the buttons'
    : 'WASD to wander — 1-9 pick a block, SPACE places, X removes';
  setTimeout(() => hint.style.opacity = '0', 9000);
  hint.style.transition = 'opacity 1.5s';
});

// ---------------- loop ----------------
setWindDirection(0.8, 0.5);
let last = performance.now();
let started = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!started) {
    started = true;
    // pre-generate chunks around spawn before revealing
    ensureChunks(player.pos.x, player.pos.z);
  }

  player.update(dt, input, world);
  build.update(player);
  runDebug();
  const actions = input.consume();
  if (actions.place) build.place(player);
  if (actions.remove) build.remove(player);
  if (actions.cycle) { selectSlot(build.cycle(1)); }

  ensureChunks(player.pos.x, player.pos.z);
  updateDay(dt);
  updateWind(now / 1000);

  // camera follows (fixed pov — never rotates or zooms)
  camTarget.lerp(player.pos, 1 - Math.pow(0.001, dt));
  camera.position.copy(camTarget).add(camOffset);
  camera.lookAt(camTarget);

  // sun target follows player
  sun.target.position.copy(player.pos);

  // water follows player (world-space texture so no swimming)
  water.position.x = Math.round(player.pos.x / 8) * 8;
  water.position.z = Math.round(player.pos.z / 8) * 8;
  foam.position.copy(water.position);
  foamTex.offset.x = now / 60000;
  foamTex.offset.y = now / 90000;

  // motes drift
  const mp = moteGeo.attributes.position;
  for (let i = 0; i < moteCount; i++) {
    mp.array[i * 3] += Math.sin(now / 2400 + moteSeed[i]) * 0.004;
    mp.array[i * 3 + 1] += Math.sin(now / 3100 + moteSeed[i] * 2) * 0.003;
    mp.array[i * 3 + 2] += Math.cos(now / 2700 + moteSeed[i]) * 0.004;
  }
  mp.needsUpdate = true;
  motes.position.set(0, 0, 0);

  // fireflies bob
  const fp = ffGeo.attributes.position;
  for (let i = 0; i < ffCount; i++) {
    fp.array[i * 3 + 1] += Math.sin(now / 800 + i * 2.4) * 0.006;
  }
  fp.needsUpdate = true;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
