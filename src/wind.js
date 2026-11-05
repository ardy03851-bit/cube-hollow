// ---------------------------------------------------------------------------
// Wind — a gentle breeze that breathes through the whole valley.
// Patches standard Three.js materials via onBeforeCompile:
//   mode 'shear'  : grass blades — tips bend, roots stay (uses local y)
//   mode 'blob'   : bush/tree blobs — each part sways on its own phase
//   mode 'inst'   : instanced meshes — phase from instance position
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const shaders = new Set();

export function applyWind(material, opts = {}) {
  const mode = opts.mode || 'blob';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindDir = { value: new THREE.Vector2(0.85, 0.45) };
    shader.uniforms.uWindStrength = { value: opts.strength ?? 1.0 };
    shader.vertexShader = 'uniform float uTime;\nuniform vec2 uWindDir;\nuniform float uWindStrength;\n' + shader.vertexShader;

    if (mode === 'shear') {
      // attribute aStiff per-vertex (1 at tip) optional; fallback local y
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec2 wp = vec2(0.0);
          #ifdef USE_INSTANCING
            wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          #endif
          float ph = fract(sin(dot(floor(wp*4.0), vec2(127.1, 311.7))) * 43758.5453);
          float t = uTime;
          // layered gusts
          float g = sin(wp.x*0.32 + wp.y*0.19 + t*1.7) * 0.5 + 0.5;
          float g2 = sin(wp.x*0.09 - wp.y*0.07 + t*0.53 + 2.1) * 0.5 + 0.5;
          float flutter = sin(t*5.2 + ph*6.2831) * 0.5 + 0.5;
          vec2 W = uWindDir * (0.25 + 0.75*g*g2) * (0.7 + 0.3*flutter);
          float stiff = position.y; // blade geometry: y in [0..1]
          stiff = pow(max(stiff, 0.0), 1.4);
          transformed.xz += W * stiff * 0.9 * uWindStrength;
          transformed.y -= dot(W,W) * stiff * 0.18 * uWindStrength;
        }`
      );
    } else if (mode === 'blob') {
      // uses attributes aPhase (per blob) — every part of a bush moves on its own
      shader.vertexShader = 'attribute float aPhase;\nattribute float aSway;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec2 wp = vec2(position.x, position.z); // local, good enough for phase
          float t = uTime;
          float g = sin(position.x*0.5 + position.z*0.3 + t*1.6) * 0.5 + 0.5;
          float g2 = sin(position.x*0.13 - t*0.6 + 1.7) * 0.5 + 0.5;
          float sway = sin(t*2.1 + aPhase*6.2831) * 0.5 + 0.5;
          float amp = (0.35 + 0.65*g*g2) * (0.4 + 0.6*sway);
          vec2 W = uWindDir * amp * aSway * uWindStrength;
          transformed.xz += W;
          transformed.y += sin(t*2.3 + aPhase*6.2831) * 0.05 * aSway * uWindStrength;
        }`
      );
    }

    shader.uniforms.uTime.value = 0;
    material.userData.shader = shader;
    shaders.add(shader);
  };
  material.customProgramCacheKey = () => 'wind-' + mode;
  return material;
}

export function updateWind(t) {
  for (const s of shaders) {
    if (s.uniforms.uTime) s.uniforms.uTime.value = t;
  }
}

export function setWindDirection(x, z) {
  const len = Math.hypot(x, z) || 1;
  for (const s of shaders) {
    if (s.uniforms.uWindDir) s.uniforms.uWindDir.value.set(x / len, z / len);
  }
}
