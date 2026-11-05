// ---------------------------------------------------------------------------
// Player — a small, quiet cube. No eyes, just vibes.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, lerp } from './noise.js';

export class Player {
  constructor(scene) {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector2(0, 1); // xz
    this.speed = 4.6;
    this.hopT = 0;

    const geo = new THREE.BoxGeometry(0.68, 0.68, 0.68);
    const mat = new THREE.MeshLambertMaterial({ color: '#f6ecd2', flatShading: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // soft dark outline for readability
    const outlineGeo = new THREE.BoxGeometry(0.68, 0.68, 0.68);
    this.outline = new THREE.Mesh(outlineGeo, new THREE.MeshBasicMaterial({
      color: 0x3a352c, side: THREE.BackSide,
    }));
    this.outline.scale.set(1.13, 1.13, 1.13);
    this.mesh.add(this.outline);

    // soft blob shadow
    const shGeo = new THREE.CircleGeometry(0.46, 20);
    shGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({
      color: 0x24301f, transparent: true, opacity: 0.3, depthWrite: false,
    }));
    scene.add(this.shadow);
  }

  update(dt, input, world, buildables) {
    // --- movement in camera space (isometric) ---
    let mx = 0, mz = 0;
    if (input.up) mz -= 1;
    if (input.down) mz += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    mx += input.joyX; mz += input.joyY;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    // camera-relative iso directions: screen-up is world(-1,-1)/√2 etc.
    const wx = (mx + mz) * 0.7071;
    const wz = (mz - mx) * 0.7071;
    const moving = Math.hypot(wx, wz) > 0.01;

    if (moving) {
      this.facing.set(wx, wz).normalize();
      this.vel.x = wx * this.speed;
      this.vel.z = wz * this.speed;
      this.hopT += dt * 9.5;
    } else {
      this.vel.x *= 0.001 ** dt;
      this.vel.z *= 0.001 ** dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // --- terrain collision ---
    const h = world.heightMesh(this.pos.x, this.pos.z);
    const grounded = h > 0.05;
    this.pos.y = lerp(this.pos.y, h + 0.31, clamp(dt * 14, 0, 1));

    // --- hop animation ---
    const hop = moving ? Math.abs(Math.sin(this.hopT)) * 0.14 : 0;
    const squash = moving ? 1 + Math.sin(this.hopT * 2) * 0.04 : 1;
    this.mesh.position.set(this.pos.x, this.pos.y + hop, this.pos.z);
    this.mesh.scale.set(2 - squash, squash, 2 - squash);
    // lean into motion
    const lean = 0.12;
    this.mesh.rotation.z = lerp(this.mesh.rotation.z, -wx * lean * (moving ? 1 : 0), 0.2);
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, wz * lean * (moving ? 1 : 0), 0.2);

    this.shadow.position.set(this.pos.x, h + 0.045, this.pos.z);
    // tilt shadow to follow the slope
    const e2 = 0.6;
    const nsx = (world.heightMesh(this.pos.x + e2, this.pos.z) - world.heightMesh(this.pos.x - e2, this.pos.z)) / (2 * e2);
    const nsz = (world.heightMesh(this.pos.x, this.pos.z + e2) - world.heightMesh(this.pos.x, this.pos.z - e2)) / (2 * e2);
    this.shadow.rotation.set(0, 0, 0);
    this.shadow.rotateX(Math.atan(nsx));
    this.shadow.rotateZ(-Math.atan(nsz));
    const shS = clamp(1 - hop * 2, 0.7, 1);
    this.shadow.scale.set(shS, 1, shS);
    this.shadow.material.opacity = 0.3 * shS;

    this.grounded = grounded;
  }
}
