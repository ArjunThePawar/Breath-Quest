// voxelWorld.js
//
// A small circular island surrounded by animated water, with a gradient
// skybox that shifts color with world mood, plus added surface detail
// (trees, rocks, grass tufts, drifting clouds) so the island reads as
// a real place rather than bare colored terrain.
//
// Public API is unchanged:
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

const ISLAND_RADIUS = 26;
// Pushed out to nearly the island's true edge (ISLAND_RADIUS = 15) —
// this is as large as it can go while still leaving a small margin so
// the border-warning zone means "you've left the island", not "you've
// left an arbitrary inner circle". Almost the entire island, including
// the whole beach, is now freely explorable before any warning.
export const ACCESS_RADIUS = ISLAND_RADIUS - 1;
const GRID_SIZE = ISLAND_RADIUS * 2 + 2;
export const CENTER = GRID_SIZE / 2;
const WATER_LEVEL = 0;

function rawHeight(x, z) {
  return (
    Math.sin(x * 0.35) * 1.4 +
    Math.cos(z * 0.3) * 1.4 +
    Math.sin((x + z) * 0.15) * 2.2
  );
}

function heightAt(x, z) {
  const dx = x - CENTER, dz = z - CENTER;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const falloffStart = ISLAND_RADIUS * 0.55;
  const falloff = 1 - smoothstep(falloffStart, ISLAND_RADIUS, dist);
  const h = (rawHeight(x, z) + 3) * falloff;
  return h;
}

// Returns how deep underwater a given (x,z) point is, in world units.
// 0 = dry land. heightAt() collapses to exactly 0 outside ISLAND_RADIUS
// (that's how the land falloff works), so it can't be used alone to
// detect real ocean depth — it would report the entire sea as "0 depth,
// dry land". Instead: inside the island, use heightAt() directly (this
// still catches any interior low spots/ponds). Beyond the island's
// edge, model an actual seafloor that gets deeper the further out you
// go, so stepping off the beach immediately registers as real water.
function waterDepthAt(x, z) {
  const dx = x - CENTER, dz = z - CENTER;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist <= ISLAND_RADIUS) {
    const rawH = heightAt(x, z);
    return rawH < WATER_LEVEL ? WATER_LEVEL - rawH : 0;
  }

  // Past the coastline: depth increases with distance from shore,
  // starting immediately (0.3 minimum) so there's no "dead zone" right
  // at the water's edge, capped at 6 so the tint/physics don't need to
  // handle unbounded depth.
  const distPastShore = dist - ISLAND_RADIUS;
  return Math.min(6, 0.3 + distPastShore * 0.4);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blockColor(height, distFromCenter) {
  if (height > 6.5) return new THREE.Color(0x7c7f86);

  // Beach band widened significantly (was 0.82, now starts at 0.6) so
  // sand reads as a real coastline feature instead of a thin fringe.
  // Two-tone sand: lighter "wet sand" right at the waterline, deeper
  // dry sand further inland, for a more natural beach gradient.
  const beachStart = ISLAND_RADIUS * 0.6;
  if (distFromCenter > beachStart) {
    const wetness = smoothstep(beachStart, ISLAND_RADIUS, distFromCenter);
    const drySand = new THREE.Color(0xe0c98a);
    const wetSand = new THREE.Color(0xf0e2b8);
    return drySand.clone().lerp(wetSand, wetness);
  }

  if (height > 4) return new THREE.Color(0x4f7a41);          // deep grass
  return new THREE.Color(0x5b8a4a);                          // grass
}

// Simple deterministic hash so decoration placement is stable across
// reloads instead of jumping around every time the page refreshes.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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

const skyVertex = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;
const skyFragment = `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = max(dir.y, 0.0);
    vec3 sky = mix(horizonColor, topColor, pow(h, exponent));
    sky = mix(bottomColor, sky, smoothstep(-0.05, 0.05, dir.y));

    float sunAmount = max(dot(dir, normalize(sunDirection)), 0.0);
    vec3 sunDisc = sunColor * pow(sunAmount, 800.0) * 3.0;
    vec3 sunHaze = sunColor * pow(sunAmount, 12.0) * 0.4;

    gl_FragColor = vec4(sky + sunDisc + sunHaze, 1.0);
  }
`;

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
  // Fog density and camera far-plane together define how far the player
  // can see. Both were tuned tightly around the old ~54-unit visibility
  // radius; halving the densities (and pushing the far plane out to
  // match) roughly doubles the view distance while keeping the same
  // soft-fade-into-fog look rather than a hard pop-in edge.
  scene.fog = new THREE.FogExp2(0x0e1a12, 0.014);

  const camera = new THREE.PerspectiveCamera(
    55,
    canvas.clientWidth / canvas.clientHeight || 1,
    0.1,
    900
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

  const mood = {
    current: {
      sunColor: new THREE.Color(0xfff1c9), sunIntensity: 1.5,
      fogColor: new THREE.Color(0x0e1a12), fogDensity: 0.014, bloom: 1.1,
      skyTop: new THREE.Color(0x2f6fb0), skyHorizon: new THREE.Color(0xdfeeff), skyBottom: new THREE.Color(0x3a4a3a),
    },
    target: {
      sunColor: new THREE.Color(0xfff1c9), sunIntensity: 1.5,
      fogColor: new THREE.Color(0x0e1a12), fogDensity: 0.014, bloom: 1.1,
      skyTop: new THREE.Color(0x2f6fb0), skyHorizon: new THREE.Color(0xdfeeff), skyBottom: new THREE.Color(0x3a4a3a),
    },
    flicker: false,
  };

  // ---- skybox ----
  const skyGeo = new THREE.SphereGeometry(400, 32, 15);
  const sunDirection = sun.position.clone().normalize();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: mood.current.skyTop },
      horizonColor: { value: mood.current.skyHorizon },
      bottomColor: { value: mood.current.skyBottom },
      sunDirection: { value: sunDirection },
      sunColor: { value: mood.current.sunColor },
      exponent: { value: 0.8 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  // ---- drifting clouds (billboards) ----
  const cloudGroup = new THREE.Group();
  const cloudTex = makeGlowTexture();
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, depthWrite: false, opacity: 0.75, fog: false,
    }));
    const s = 14 + hash2(i, 3) * 18;
    cloud.scale.set(s, s * 0.45, 1);
    cloud.position.set(
      CENTER + (hash2(i, 1) - 0.5) * 160,
      28 + hash2(i, 2) * 22,
      CENTER + (hash2(i, 4) - 0.5) * 160
    );
    cloud.userData.speed = 0.4 + hash2(i, 5) * 0.8;
    cloudGroup.add(cloud);
  }
  scene.add(cloudGroup);

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

  // ---- splash particles ----
  // A small pool of reusable droplet sprites. Whenever the player steps
  // from dry land into water (see spawnSplash, called from
  // playerMovement.js), a burst of these pop up from the surface and
  // arc outward/upward under simple gravity before fading out. Pooled
  // instead of created-on-demand so repeated splashes never allocate
  // new geometry/materials mid-game.
  const SPLASH_POOL_SIZE = 120;
  const splashTex = makeGlowTexture();
  const splashPool = [];
  const activeSplashes = [];

  for (let i = 0; i < SPLASH_POOL_SIZE; i++) {
    const mat = new THREE.SpriteMaterial({
      map: splashTex,
      color: 0xdff6ff,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.scale.setScalar(0.01);
    sprite.userData.velocity = new THREE.Vector3();
    sprite.userData.life = 0;
    sprite.userData.maxLife = 1;
    scene.add(sprite);
    splashPool.push(sprite);
  }

  // Spawns a burst of droplets at world-space (x, z), right at the
  // water surface. Safe to call repeatedly - if the pool runs dry
  // (many rapid splashes at once) it simply spawns fewer droplets
  // rather than allocating more.
  function spawnSplash(x, z) {
    const count = 14 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const sprite = splashPool.pop();
      if (!sprite) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.2;
      sprite.userData.velocity.set(
        Math.cos(angle) * speed,
        2.4 + Math.random() * 2.6,
        Math.sin(angle) * speed
      );
      sprite.userData.life = 0;
      sprite.userData.maxLife = 0.45 + Math.random() * 0.35;

      sprite.position.set(
        x + (Math.random() - 0.5) * 0.5,
        WATER_LEVEL + 0.05,
        z + (Math.random() - 0.5) * 0.5
      );
      sprite.scale.setScalar(0.15 + Math.random() * 0.2);
      sprite.material.opacity = 0.9;
      sprite.visible = true;
      activeSplashes.push(sprite);
    }
  }

  // Advances every currently-animating splash droplet by dt: simple
  // gravity arc, fade-out over its lifetime, then returns it to the
  // pool once it expires.
  function updateSplashes(dt) {
    for (let i = activeSplashes.length - 1; i >= 0; i--) {
      const sprite = activeSplashes[i];
      sprite.userData.life += dt;
      const t = sprite.userData.life / sprite.userData.maxLife;

      if (t >= 1) {
        sprite.visible = false;
        sprite.material.opacity = 0;
        activeSplashes.splice(i, 1);
        splashPool.push(sprite);
        continue;
      }

      sprite.userData.velocity.y -= 9 * dt; // gravity pulls droplets back down
      sprite.position.addScaledVector(sprite.userData.velocity, dt);
      if (sprite.position.y < WATER_LEVEL) sprite.position.y = WATER_LEVEL; // don't sink below the surface

      sprite.material.opacity = 0.9 * (1 - t);
      sprite.scale.setScalar(0.15 + 0.2 * (1 - t));
    }
  }

  // ---- voxel island terrain (instanced) ----
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const blockMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });

  const positions = [];
  const heightMap = new Map(); // (x,z) -> topmost solid height, reused below for decoration placement
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const dx = x - CENTER, dz = z - CENTER;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ISLAND_RADIUS) continue;
      const h = Math.round(heightAt(x, z));
      if (h < 1) continue;
      for (let y = 0; y <= h; y++) {
        positions.push({ x, y, z, h, dist });
      }
      heightMap.set(`${x},${z}`, { h, dist });
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
    const aoFactor = 0.75 + 0.25 * Math.min(1, p.y / 4);
    col.multiplyScalar(aoFactor);
    instanced.setColorAt(i, col);
  });
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  scene.add(instanced);

  // ---- decoration pass: trees, rocks, grass tufts ----
  const decorationGroup = new THREE.Group();

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4433, roughness: 1 });
  const canopyGeo = new THREE.IcosahedronGeometry(0.85, 1);
  const canopyMats = [0x3f7a3f, 0x4a8a45, 0x356f38, 0x548f4f, 0x3d7550].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, flatShading: true })
  );

  const rockGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.95, flatShading: true });

  const tuftGeo = new THREE.PlaneGeometry(0.6, 0.5);
  const tuftMat = new THREE.MeshStandardMaterial({
    color: 0x6bb552, roughness: 1, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4,
  });

  heightMap.forEach((info, keyStr) => {
    const [x, z] = keyStr.split(",").map(Number);
    const { h, dist } = info;

      // Matches the new wider beach band above — trees/rocks/grass tufts
    // now stay clear of the whole sandy coastline, not just its old
    // thin edge.
    const isGrass = h <= 4 && h >= 1 && dist < ISLAND_RADIUS * 0.6;
    if (!isGrass) return;

    const r = hash2(x, z);
    const distFromCenter = Math.sqrt((x - CENTER) ** 2 + (z - CENTER) ** 2);
    const nearFence = Math.abs(distFromCenter - ACCESS_RADIUS) < 1.2;

    if (r < 0.045 && !nearFence) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = h + 0.6;
      trunk.castShadow = true;
      tree.add(trunk);

      const mat = canopyMats[Math.floor(hash2(x + 2, z + 2) * canopyMats.length) % canopyMats.length];
      const clusterCount = 3;
      for (let i = 0; i < clusterCount; i++) {
        const blob = new THREE.Mesh(canopyGeo, mat);
        const jx = (hash2(x + i, z - i) - 0.5) * 0.8;
        const jz = (hash2(x - i, z + i) - 0.5) * 0.8;
        const jy = h + 1.25 + hash2(x + i * 3, z) * 0.7;
        blob.position.set(jx, jy, jz);
        blob.scale.setScalar(0.6 + hash2(i, x + z) * 0.5);
        blob.rotation.y = hash2(x * (i + 1), z) * Math.PI;
        blob.castShadow = true;
        tree.add(blob);
      }

      const scale = 0.8 + hash2(x + 1, z + 1) * 0.6;
      tree.scale.setScalar(scale);
      tree.position.set(x + (hash2(x, z + 9) - 0.5) * 0.4, 0, z + (hash2(x + 9, z) - 0.5) * 0.4);
      decorationGroup.add(tree);
    } else if (r > 0.045 && r < 0.075) {
      const clusterCount = 1 + Math.floor(hash2(x + 3, z + 3) * 3);
      for (let i = 0; i < clusterCount; i++) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        const jitterX = (hash2(x + i, z - i) - 0.5) * 0.6;
        const jitterZ = (hash2(x - i, z + i) - 0.5) * 0.6;
        rock.position.set(x + jitterX, h + 0.2, z + jitterZ);
        rock.rotation.set(hash2(x, i) * Math.PI, hash2(z, i) * Math.PI, 0);
        rock.scale.setScalar(0.5 + hash2(i, x + z) * 0.6);
        rock.castShadow = true;
        rock.receiveShadow = true;
        decorationGroup.add(rock);
      }
    } else if (r > 0.15 && r < 0.4) {
      for (let i = 0; i < 2; i++) {
        const tuft = new THREE.Group();
        const bladeA = new THREE.Mesh(tuftGeo, tuftMat);
        const bladeB = new THREE.Mesh(tuftGeo, tuftMat);
        bladeB.rotation.y = Math.PI / 2;
        tuft.add(bladeA, bladeB);
        tuft.position.set(
          x + (hash2(x + i, z) - 0.5) * 0.8,
          h + 0.75,
          z + (hash2(x, z + i) - 0.5) * 0.8
        );
        tuft.rotation.y = hash2(x * i + 1, z) * Math.PI;
        decorationGroup.add(tuft);
      }
    }
  });

  scene.add(decorationGroup);


  // ---- post-processing (bloom) ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
    1.1,
    0.55,
    0.12
  );
  composer.addPass(bloomPass);

  // ---- orbit (menu background) ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enabled = false;
  let orbiting = true;
  let orbitAngle = 0;

  function setMood(zone, stabilityValue = 60) {
    if (zone === "stable") {
      mood.target.sunColor.set(0xfff1c9);
      mood.target.sunIntensity = 1.6;
      mood.target.fogColor.set(0x1a2a1c);
      mood.target.fogDensity = 0.01;
      mood.target.bloom = 1.2;
      mood.target.skyTop.set(0x2f6fb0);
      mood.target.skyHorizon.set(0xdfeeff);
      mood.target.skyBottom.set(0x3a4a3a);
      mood.flicker = false;
    } else if (zone === "unstable") {
      mood.target.sunColor.set(0xd8c9a8);
      mood.target.sunIntensity = 1.05;
      mood.target.fogColor.set(0x141a14);
      mood.target.fogDensity = 0.0175;
      mood.target.bloom = 0.85;
      mood.target.skyTop.set(0x4a5560);
      mood.target.skyHorizon.set(0x9aa3ad);
      mood.target.skyBottom.set(0x2a2f33);
      mood.flicker = false;
    } else {
      mood.target.sunColor.set(0xff6a4a);
      mood.target.sunIntensity = 0.7;
      mood.target.fogColor.set(0x1a0b0b);
      mood.target.fogDensity = 0.0275;
      mood.target.bloom = 1.4;
      mood.target.skyTop.set(0x220a0a);
      mood.target.skyHorizon.set(0x8a3018);
      mood.target.skyBottom.set(0x150606);
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
    mood.current.skyTop.lerp(mood.target.skyTop, lerpAmt);
    mood.current.skyHorizon.lerp(mood.target.skyHorizon, lerpAmt);
    mood.current.skyBottom.lerp(mood.target.skyBottom, lerpAmt);

    skyMesh.position.copy(camera.position); // keep the dome centered on the player at all times

    let intensity = mood.current.sunIntensity;
    if (mood.flicker) intensity *= 0.75 + Math.random() * 0.5;
    sun.color.copy(mood.current.sunColor);
    sun.intensity = intensity;
    glowMat.color.copy(mood.current.sunColor);
    scene.fog.color.copy(mood.current.fogColor);
    scene.fog.density = mood.current.fogDensity;
    bloomPass.strength = mood.current.bloom;


    waterUniforms.uTime.value = t;
    waterUniforms.uCameraPos.value.copy(camera.position);
    waterUniforms.uShallowColor.value.set(mood.flicker ? 0x8a3a3a : 0x6fd8d8);

    updateSplashes(dt);

    cloudGroup.children.forEach((c) => {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > CENTER + 100) c.position.x = CENTER - 100;
    });

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
    return Math.max(WATER_LEVEL, Math.round(heightAt(x, z)));
  }

  return {
    camera,
    getGroundHeight,
    getWaterDepth: (x, z) => waterDepthAt(x, z),
    spawnSplash,
    CENTER,
    setMood,
    setBrightness,
    setOrbiting,
    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      blockGeo.dispose();
      blockMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      trunkGeo.dispose();
      canopyGeo.dispose();
      canopyMats.forEach((m) => m.dispose());
      rockGeo.dispose();
      tuftGeo.dispose();
      splashTex.dispose();
      splashPool.forEach((s) => s.material.dispose());
      activeSplashes.forEach((s) => s.material.dispose());
      renderer.dispose();
    },
  };
}