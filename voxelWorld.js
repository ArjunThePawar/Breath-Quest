// voxelWorld.js  (NEW FILE — replaces the previous version)
//
// A small circular island surrounded by animated water. Only the inner
// area (ACCESS_RADIUS) is marked as "accessible" via a glowing energy
// fence — the outer ring of the island is visible but off-limits. This
// boundary is a plain constant so it can be reused later to clamp real
// player movement once that system exists.
//
// Visual style: original blocky-voxel geometry pushed toward a
// cinematic "shader pack" look — bloom, fresnel water, soft god-ray
// glow, ambient-occlusion-ish base darkening — built from scratch
// rather than using Minecraft's own copyrighted textures/shader code.
//
// Public API is unchanged from before:
//   const world = initVoxelWorld(canvas);
//   world.setMood(zone, stabilityValue);
//   world.setBrightness(0-100);
//   world.setOrbiting(true/false);
//   world.dispose();

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ISLAND_RADIUS = 15;   // total visible island radius, in blocks
export const ACCESS_RADIUS = 8; // the "limited accessible area" boundary radius
const GRID_SIZE = ISLAND_RADIUS * 2 + 2;
export const CENTER = GRID_SIZE / 2;
const WATER_LEVEL = 0;

// ---- terrain shaping ----
function rawHeight(x, z) {
  return (
    Math.sin(x * 0.35) * 1.4 +
    Math.cos(z * 0.3) * 1.4 +
    Math.sin((x + z) * 0.15) * 2.2
  );
}

// Circular falloff so the island slopes down into the sea at its edges
// instead of ending in a hard cliff at the grid boundary.
function heightAt(x, z) {
  const dx = x - CENTER, dz = z - CENTER;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const falloffStart = ISLAND_RADIUS * 0.55;
  const falloff = 1 - smoothstep(falloffStart, ISLAND_RADIUS, dist);
  const h = (rawHeight(x, z) + 3) * falloff;
  return h;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blockColor(height, distFromCenter) {
  if (height > 6.5) return new THREE.Color(0x7c7f86);        // rocky peak
  if (distFromCenter > ISLAND_RADIUS * 0.82) return new THREE.Color(0xd8c58a); // sandy coast
  if (height > 4) return new THREE.Color(0x4f7a41);          // deep grass
  return new THREE.Color(0x5b8a4a);                          // grass
}

// ---- procedural radial-gradient texture for the sun-glow sprite ----
function makeGlowTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// ---- water shader: animated waves + fresnel edge brightening ----
const waterVertex = `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 pos = position;
    float wave =
      sin(pos.x * 0.4 + uTime * 1.1) * 0.06 +
      cos(pos.z * 0.35 + uTime * 0.9) * 0.06;
    pos.y += wave;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
const waterFragment = `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uCameraPos;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);
    vec3 color = mix(uDeepColor, uShallowColor, fresnel);
    gl_FragColor = vec4(color, 0.75 + fresnel * 0.2);
  }
`;

export function initVoxelWorld(canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0e1a12, 0.028);

  const camera = new THREE.PerspectiveCamera(
    55,
    canvas.clientWidth / canvas.clientHeight || 1,
    0.1,
    300
  );
  camera.position.set(CENTER + ACCESS_RADIUS * 0.9, 11, CENTER + ACCESS_RADIUS * 0.9);
  camera.lookAt(CENTER, 2, CENTER);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setSize(w, h);
  }

  // ---- lighting ----
  const ambient = new THREE.HemisphereLight(0xbfe3ff, 0x24321f, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1c9, 1.5);
  sun.position.set(30, 34, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);

  // fake god-ray glow behind the sun (additive sprite)
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xfff1c9,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sunGlow = new THREE.Sprite(glowMat);
  sunGlow.scale.set(60, 60, 1);
  sunGlow.position.copy(sun.position).multiplyScalar(2.2);
  scene.add(sunGlow);

  // ---- water ----
  const waterUniforms = {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color(0x0a3a4a) },
    uShallowColor: { value: new THREE.Color(0x6fd8d8) },
    uCameraPos: { value: camera.position.clone() },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SIZE * 3, GRID_SIZE * 3, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      transparent: true,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  scene.add(water);

  // ---- voxel island terrain (instanced) ----
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const blockMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });

  const positions = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const dx = x - CENTER, dz = z - CENTER;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ISLAND_RADIUS) continue; // outside the island entirely
      const h = Math.round(heightAt(x, z));
      if (h < 1) continue; // underwater, no blocks (water mesh covers it)
      for (let y = 0; y <= h; y++) {
        positions.push({ x, y, z, h, dist });
      }
    }
  }

  const instanced = new THREE.InstancedMesh(blockGeo, blockMat, positions.length);
  instanced.castShadow = true;
  instanced.receiveShadow = true;
  const dummy = new THREE.Object3D();
  positions.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.updateMatrix();
    instanced.setMatrixAt(i, dummy.matrix);
    const col = blockColor(p.h, p.dist);
    // subtle fake ambient occlusion: darken blocks closer to the ground
    const aoFactor = 0.75 + 0.25 * Math.min(1, p.y / 4);
    col.multiplyScalar(aoFactor);
    instanced.setColorAt(i, col);
  });
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  scene.add(instanced);

  // ---- accessible-area boundary (glowing energy fence) ----
  const boundaryGroup = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x7fe0a0,
    emissive: 0x4fe08a,
    emissiveIntensity: 1.8,
    roughness: 0.4,
  });
  const POST_COUNT = 28;
  for (let i = 0; i < POST_COUNT; i++) {
    const angle = (i / POST_COUNT) * Math.PI * 2;
    const px = CENTER + Math.cos(angle) * ACCESS_RADIUS;
    const pz = CENTER + Math.sin(angle) * ACCESS_RADIUS;
    const groundH = Math.max(1, Math.round(heightAt(px, pz)));
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, groundH + 1.2, pz);
    post.castShadow = true;
    boundaryGroup.add(post);
  }
  // translucent energy wall between the posts
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ACCESS_RADIUS, ACCESS_RADIUS, 5, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7fe0a0,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  wall.position.set(CENTER, 2.5, CENTER);
  boundaryGroup.add(wall);
  scene.add(boundaryGroup);

  // ---- post-processing (bloom) ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
    1.1,   // strength
    0.55,  // radius
    0.12   // threshold — low, so emissive posts & sun bloom noticeably
  );
  composer.addPass(bloomPass);

  // ---- orbit (menu background) ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enabled = false;
  let orbiting = true;
  let orbitAngle = 0;

  // ---- mood state ----
  const mood = {
    current: { sunColor: new THREE.Color(0xfff1c9), sunIntensity: 1.5, fogColor: new THREE.Color(0x0e1a12), fogDensity: 0.028, bloom: 1.1 },
    target:  { sunColor: new THREE.Color(0xfff1c9), sunIntensity: 1.5, fogColor: new THREE.Color(0x0e1a12), fogDensity: 0.028, bloom: 1.1 },
    flicker: false,
  };

  function setMood(zone, stabilityValue = 60) {
    if (zone === "stable") {
      mood.target.sunColor.set(0xfff1c9);
      mood.target.sunIntensity = 1.6;
      mood.target.fogColor.set(0x1a2a1c);
      mood.target.fogDensity = 0.02;
      mood.target.bloom = 1.2;
      mood.flicker = false;
    } else if (zone === "unstable") {
      mood.target.sunColor.set(0xd8c9a8);
      mood.target.sunIntensity = 1.05;
      mood.target.fogColor.set(0x141a14);
      mood.target.fogDensity = 0.035;
      mood.target.bloom = 0.85;
      mood.flicker = false;
    } else {
      mood.target.sunColor.set(0xff6a4a);
      mood.target.sunIntensity = 0.7;
      mood.target.fogColor.set(0x1a0b0b);
      mood.target.fogDensity = 0.055;
      mood.target.bloom = 1.4;
      mood.flicker = true;
    }
  }

  function setBrightness(value0to100) {
    renderer.toneMappingExposure = Math.max(0.15, (value0to100 / 50) * 1.0);
  }

  function setOrbiting(value) {
    orbiting = value;
  }

  let disposed = false;
  const clock = new THREE.Clock();

  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();

    const lerpAmt = Math.min(1, dt * 1.5);
    mood.current.sunColor.lerp(mood.target.sunColor, lerpAmt);
    mood.current.fogColor.lerp(mood.target.fogColor, lerpAmt);
    mood.current.sunIntensity += (mood.target.sunIntensity - mood.current.sunIntensity) * lerpAmt;
    mood.current.fogDensity += (mood.target.fogDensity - mood.current.fogDensity) * lerpAmt;
    mood.current.bloom += (mood.target.bloom - mood.current.bloom) * lerpAmt;

    let intensity = mood.current.sunIntensity;
    if (mood.flicker) intensity *= 0.75 + Math.random() * 0.5;
    sun.color.copy(mood.current.sunColor);
    sun.intensity = intensity;
    glowMat.color.copy(mood.current.sunColor);
    scene.fog.color.copy(mood.current.fogColor);
    scene.fog.density = mood.current.fogDensity;
    bloomPass.strength = mood.current.bloom;

    // boundary fence pulses gently, and turns warning-red when chaotic
    const fenceColor = mood.flicker ? 0xff6a4a : 0x7fe0a0;
    postMat.emissive.setHex(fenceColor);
    postMat.emissiveIntensity = 1.4 + Math.sin(t * 2) * 0.4;
    wall.material.color.setHex(fenceColor);

    waterUniforms.uTime.value = t;
    waterUniforms.uCameraPos.value.copy(camera.position);
    waterUniforms.uShallowColor.value.set(mood.flicker ? 0x8a3a3a : 0x6fd8d8);

    if (orbiting) {
      orbitAngle += dt * 0.07;
      const radius = ACCESS_RADIUS * 1.6;
      camera.position.x = CENTER + Math.cos(orbitAngle) * radius;
      camera.position.z = CENTER + Math.sin(orbitAngle) * radius;
      camera.position.y = 10 + Math.sin(orbitAngle * 0.5) * 2;
      camera.lookAt(CENTER, 2.5, CENTER);
    }

    composer.render();
  }

  window.addEventListener("resize", resize);
  resize();
  animate();

  function getGroundHeight(x, z) {
    return Math.max(WATER_LEVEL, heightAt(x, z));
  }

  return {
    camera,
    getGroundHeight,
    CENTER,
    setMood,
    setBrightness,
    setOrbiting,
    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      blockGeo.dispose();
      blockMat.dispose();
      renderer.dispose();
    },
  };
}