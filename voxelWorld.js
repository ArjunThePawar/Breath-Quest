// A small circular island surrounded by animated water, with a gradient
// skybox that shifts color with world mood, plus added surface detail
// (trees, rocks, grass tufts, drifting clouds) so the island reads as
// a real place rather than bare colored terrain.


import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CONFIG } from "./config.js";

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

// Real Minecraft block textures are 16x16 pixel grids of noisy value
// variation, not flat colors. This generates that same grain as a
// GRAYSCALE texture (mid-gray = neutral) so it can be multiplied on
// top of the existing per-instance block colors (grass/sand/rock)
// without changing their hue - it just gives every block that
// speckled, hand-painted-pixel look instead of a flat plastic color.
// NearestFilter (no smoothing) is what keeps it crisply pixelated
// instead of blurring into a smooth gradient.
function makeBlockNoiseTexture() {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const shade = 200 + Math.floor(Math.random() * 55); // 200-255: mostly-neutral grain
    img.data[i * 4 + 0] = shade;
    img.data[i * 4 + 1] = shade;
    img.data[i * 4 + 2] = shade;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A 16x16 leaf-cutout texture: noisy green speckle with a scatter of
// fully-transparent pixels punched through it, exactly like Minecraft's
// real leaf-block texture (alphaTest cutout, not smooth transparency).
// This is what makes leaf CUBES actually read as "leaves" instead of
// solid green boxes - you can see daylight/gaps through the canopy.
function makeLeafTexture() {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const hole = Math.random() < 0.22; // ~22% of pixels punched fully transparent
    const shade = 190 + Math.floor(Math.random() * 65);
    img.data[i * 4 + 0] = shade;
    img.data[i * 4 + 1] = shade;
    img.data[i * 4 + 2] = shade;
    img.data[i * 4 + 3] = hole ? 0 : 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 3.0);
    vec3 color = mix(uDeepColor, uShallowColor, fresnel);

    // Real sky reflection: reflect the view ray off the water's
    // normal, then sample the SAME sky gradient the skybox uses,
    // based on how high that reflected ray points. This is what makes
    // the water actually mirror the sky/clouds like a real lake,
    // instead of just being a flat colored, glassy-looking tint.
    vec3 reflectDir = reflect(-viewDir, vNormal);
    float skyT = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 reflection = mix(uSkyHorizon, uSkyTop, pow(skyT, 0.6));
    color = mix(color, reflection, fresnel * 0.85);

    // Bright glossy sun glint (Blinn-Phong highlight) on top of the
    // reflection - this is what reads as "glassy, reflective" water
    // catching direct sunlight, not just a flat tint.
    vec3 halfDir = normalize(viewDir + uSunDirection);
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 180.0);
    vec3 glint = uSunColor * spec * 3.0;

    gl_FragColor = vec4(color + glint, 0.55 + fresnel * 0.4);
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
      // ---- world "reskin" palette (terrain/foliage/water) ----
      // terrainTint multiplies the instanced block colors (grass/sand/
      // rock) directly - a near-white value leaves them untouched, a
      // warm value makes the whole island glow golden.
      terrainTint: new THREE.Color(0xffffff),
      // foliageTint is blended INTO each tree/grass-tuft/rock's own base
      // color (by sereneAmount below), rather than multiplied, so their
      // natural color variety survives even at full blend.
      foliageTint: new THREE.Color(0xffffff),
      foliageGlow: new THREE.Color(0x000000), // added as emissive on foliage for a soft glow
      waterDeep: new THREE.Color(0x0a3a4a),
      waterShallow: new THREE.Color(0x6fd8d8),
      sereneAmount: 0, // 0-1, how strongly foliageTint/foliageGlow are blended in
      sunGlowScale: 60, // size of the soft additive sun-flare sprite
    },
    target: {
      sunColor: new THREE.Color(0xfff1c9), sunIntensity: 1.5,
      fogColor: new THREE.Color(0x0e1a12), fogDensity: 0.014, bloom: 1.1,
      skyTop: new THREE.Color(0x2f6fb0), skyHorizon: new THREE.Color(0xdfeeff), skyBottom: new THREE.Color(0x3a4a3a),
      terrainTint: new THREE.Color(0xffffff),
      foliageTint: new THREE.Color(0xffffff),
      foliageGlow: new THREE.Color(0x000000),
      waterDeep: new THREE.Color(0x0a3a4a),
      waterShallow: new THREE.Color(0x6fd8d8),
      sereneAmount: 0,
      sunGlowScale: 60,
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
    uSunDirection: { value: sun.position.clone().normalize() },
    uSunColor: { value: new THREE.Color(0xfff1c9) },
    uSkyTop: { value: new THREE.Color(0x2f6fb0) },
    uSkyHorizon: { value: new THREE.Color(0xdfeeff) },
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
  const blockMat = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0.05,
    map: makeBlockNoiseTexture(), // multiplies with each instance's color for a real pixel-grain look
  });

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

  // ---- hidden treasure ----
  // Collected from the same set of grass-zone cells trees/rocks/grass
  // tufts get scattered across - so wherever the treasure ends up, it's
  // naturally surrounded by the same foliage that hides everything
  // else, not sitting in an obvious clearing. Excludes cells right next
  // to the spawn point or the fence line, and biased toward the middle
  // of the grass ring rather than right on the beach (too exposed) or
  // deep against the rocky peak (too odd a place to bury a chest).
  const treasureCandidates = [];
  heightMap.forEach((info, keyStr) => {
    const [x, z] = keyStr.split(",").map(Number);
    const { h, dist } = info;
    const isGrass = h <= 4 && h >= 1 && dist < ISLAND_RADIUS * 0.6;
    if (!isGrass) return;
    if (dist < ISLAND_RADIUS * 0.25 || dist > ISLAND_RADIUS * 0.55) return;
    treasureCandidates.push({ x, z, h });
  });

  // Picks a genuinely random hiding spot out of every valid candidate
  // cell - called once at startup, and again by resetTreasure() so a
  // fresh run doesn't hide the treasure in the same place twice in a
  // row.
  function pickRandomTreasureCell() {
    if (treasureCandidates.length === 0) {
      return { x: CENTER, y: 2, z: CENTER }; // fallback, should never actually be hit
    }
    const cell = treasureCandidates[Math.floor(Math.random() * treasureCandidates.length)];
    return { x: cell.x, y: cell.h, z: cell.z };
  }

  const TREASURE_POS = new THREE.Vector3();

  const treasureGroup = new THREE.Group();

  const chestGeo = new THREE.BoxGeometry(0.7, 0.45, 0.5);
  const chestLidGeo = new THREE.BoxGeometry(0.72, 0.22, 0.52);
  const chestTrimGeo = new THREE.BoxGeometry(0.1, 0.5, 0.54);
  const chestWoodMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.85 });
  const chestTrimMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.4, metalness: 0.6 });

  const chestBase = new THREE.Mesh(chestGeo, chestWoodMat);
  chestBase.position.y = 0.225;
  chestBase.castShadow = true;
  chestBase.receiveShadow = true;
  treasureGroup.add(chestBase);

  // Lid pivots open around its back edge once the treasure is found -
  // parented to a small pivot group offset to the hinge line instead of
  // the lid's own center, so rotating it swings it up like a real lid.
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.45, -0.25);
  const chestLid = new THREE.Mesh(chestLidGeo, chestWoodMat);
  chestLid.position.set(0, 0.11, 0.26);
  chestLid.castShadow = true;
  lidPivot.add(chestLid);
  treasureGroup.add(lidPivot);

  const chestTrim = new THREE.Mesh(chestTrimGeo, chestTrimMat);
  chestTrim.position.y = 0.3;
  treasureGroup.add(chestTrim);

  // A faint golden shimmer. Deliberately dim and VERY short-range (see
  // TREASURE_GLOW_RADIUS in config.js) so it only becomes noticeable
  // once the player is already close by - not a beacon visible from
  // across the island.
  const treasureGlowTex = makeGlowTexture();
  const treasureGlowMat = new THREE.SpriteMaterial({
    map: treasureGlowTex,
    color: 0xffd479,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const treasureGlow = new THREE.Sprite(treasureGlowMat);
  treasureGlow.scale.set(1.3, 1.3, 1);
  treasureGlow.position.y = 0.5;
  treasureGroup.add(treasureGlow);

  scene.add(treasureGroup);

  let treasureUnlocked = false;
  let treasureFound = false;
  let treasureFoundHandler = null;
  let treasureBobTime = 0;

  // Moves the (currently hidden) treasure to a fresh random spot and
  // gives it a random facing, so it doesn't always sit at the same
  // angle relative to its hiding spot either.
  function randomizeTreasurePosition() {
    const cell = pickRandomTreasureCell();
    TREASURE_POS.set(cell.x, cell.y, cell.z);
    treasureGroup.position.copy(TREASURE_POS);
    treasureGroup.rotation.y = Math.random() * Math.PI * 2;
  }
  randomizeTreasurePosition();
  treasureGroup.visible = false; // hidden entirely until the world is stabilized

  // Reveals the treasure in the world (still hidden by terrain/foliage,
  // just no longer flat-out invisible) and starts checking the player's
  // distance to it every frame. Safe to call more than once.
  function unlockTreasure() {
    if (treasureUnlocked) return;
    treasureUnlocked = true;
    treasureGroup.visible = true;
  }

  // Puts everything back to its pre-stabilization state and rolls a
  // brand new random hiding spot - call this when starting a fresh run
  // so a previous session's found/open treasure doesn't carry over, and
  // so the hunt isn't in the same place twice in a row.
  function resetTreasure() {
    treasureUnlocked = false;
    treasureFound = false;
    treasureGroup.visible = false;
    lidPivot.rotation.x = 0;
    treasureGlow.material.opacity = 0;
    treasureGlow.scale.set(1.3, 1.3, 1);
    randomizeTreasurePosition();
  }

  // Registers the function to call the instant the player is found to
  // be standing next to the (unlocked) treasure. Kept as a settable
  // handler, rather than a constructor option, since the caller (the
  // GameEngine) doesn't exist yet when the world is first created.
  function setTreasureFoundHandler(fn) {
    treasureFoundHandler = fn;
  }

  function getTreasurePosition() {
    return { x: TREASURE_POS.x, y: TREASURE_POS.y, z: TREASURE_POS.z };
  }

  function isTreasureUnlocked() {
    return treasureUnlocked;
  }

  function isTreasureFound() {
    return treasureFound;
  }

  // ---- decoration pass: trees, rocks, grass tufts ----
  const decorationGroup = new THREE.Group();

  const leafTex = makeLeafTexture();
  const rockNoiseTex = makeBlockNoiseTexture();

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4433, roughness: 1 });
  // Real cube "leaf blocks" (not smooth blobs) with a punched-through
  // alpha cutout texture - this is what makes the canopy actually read
  // as leaves, with real gaps of daylight/sky visible through it, the
  // same way Minecraft's own leaf blocks work.
  const canopyGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
  // Base colors kept around so the per-frame mood tint can blend INTO
  // them (preserving each material's natural hue variety) instead of
  // replacing them outright.
  const canopyBaseColors = [0x3f7a3f, 0x4a8a45, 0x356f38, 0x548f4f, 0x3d7550].map(
    (c) => new THREE.Color(c)
  );
  const canopyMats = canopyBaseColors.map(
    (c) =>
      new THREE.MeshStandardMaterial({
        color: c.clone(),
        map: leafTex,
        alphaTest: 0.5,
        side: THREE.DoubleSide, // so the punched-through gaps don't show black backfaces
        roughness: 0.92,
        emissive: 0x000000,
      })
  );

  const rockGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const rockBaseColor = new THREE.Color(0x8a8d92);
  const rockMat = new THREE.MeshStandardMaterial({
    color: rockBaseColor.clone(),
    map: rockNoiseTex,
    roughness: 0.95,
    flatShading: true,
  });

  const tuftGeo = new THREE.PlaneGeometry(0.6, 0.5);
  const tuftBaseColor = new THREE.Color(0x6bb552);
  const tuftMat = new THREE.MeshStandardMaterial({
    color: tuftBaseColor.clone(),
    map: leafTex,
    roughness: 1,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.4,
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

      // Canopy is built as several stacked "rings" of blobs arranged in
      // a rough circle around the trunk, rather than one loose cluster -
      // this is what makes it read as a tall, dense, near-solid green
      // column (like a real shader-pack tree) instead of a small round
      // puff sitting on top of a stick.
      const CANOPY_LEVELS = 5;
      const BLOBS_PER_LEVEL = 3;
      for (let lvl = 0; lvl < CANOPY_LEVELS; lvl++) {
        const levelT = lvl / (CANOPY_LEVELS - 1); // 0 at base, 1 at top
        const levelY = h + 0.9 + lvl * 0.62;
        const levelRadius = 0.55 * (1 - levelT * 0.35); // gentle taper toward the top
        for (let i = 0; i < BLOBS_PER_LEVEL; i++) {
          const angle =
            (i / BLOBS_PER_LEVEL) * Math.PI * 2 + hash2(x + lvl, z + i) * 1.8;
          const jx = Math.cos(angle) * levelRadius;
          const jz = Math.sin(angle) * levelRadius;
          const blob = new THREE.Mesh(canopyGeo, mat);
          blob.position.set(jx, levelY + (hash2(x + i, z + lvl) - 0.5) * 0.25, jz);
          blob.scale.setScalar(0.62 + hash2(lvl, x + z + i) * 0.35);
          blob.rotation.y = hash2(x * (i + 1), z + lvl) * Math.PI;
          blob.castShadow = true;
          tree.add(blob);
        }
      }
      // One extra blob capping the very top, closing off the column.
      const topBlob = new THREE.Mesh(canopyGeo, mat);
      topBlob.position.set(0, h + 0.9 + CANOPY_LEVELS * 0.62, 0);
      topBlob.scale.setScalar(0.55 + hash2(x + 5, z + 5) * 0.2);
      topBlob.castShadow = true;
      tree.add(topBlob);

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
      mood.target.sunColor.set(0xfff8e0);
      mood.target.sunIntensity = 1.75;
      mood.target.fogColor.set(0x1a2a1c);
      mood.target.fogDensity = 0.008;
      mood.target.bloom = 1.4;
      mood.target.skyTop.set(0x3f8fd8);
      mood.target.skyHorizon.set(0xeaf6ff);
      mood.target.skyBottom.set(0x4a5a48);
      mood.flicker = false;
      // A stabilized world doesn't just get brighter - it reskins:
      // crisp bright daylight, vivid saturated foliage, and glassy
      // reflective water with a real sun glint (see waterFragment).
      mood.target.terrainTint.set(0xf5ffe8);
      mood.target.foliageTint.set(0x52d648);
      mood.target.foliageGlow.set(0x142e12);
      mood.target.waterDeep.set(0x0a5a68);
      mood.target.waterShallow.set(0x8ff5e6);
      mood.target.sereneAmount = 1;
      mood.target.sunGlowScale = 95;
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
      // Roughly the island's natural, everyday coloring - a faint
      // dusty wash, nothing glowing yet.
      mood.target.terrainTint.set(0xeceae0);
      mood.target.foliageTint.set(0xc9c4b0);
      mood.target.foliageGlow.set(0x000000);
      mood.target.waterDeep.set(0x0a3a4a);
      mood.target.waterShallow.set(0x6fd8d8);
      mood.target.sereneAmount = 0.15;
      mood.target.sunGlowScale = 60;
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
      // Chaotic: everything reads as scorched/charred rather than lush -
      // rusty terrain, ember-glowing foliage, blood-warm water.
      mood.target.terrainTint.set(0xd98a72);
      mood.target.foliageTint.set(0x8a3a2a);
      mood.target.foliageGlow.set(0x2a0a05);
      mood.target.waterDeep.set(0x2a0d0d);
      mood.target.waterShallow.set(0x8a3a3a);
      mood.target.sereneAmount = 0.6;
      mood.target.sunGlowScale = 50;
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
    mood.current.terrainTint.lerp(mood.target.terrainTint, lerpAmt);
    mood.current.foliageTint.lerp(mood.target.foliageTint, lerpAmt);
    mood.current.foliageGlow.lerp(mood.target.foliageGlow, lerpAmt);
    mood.current.waterDeep.lerp(mood.target.waterDeep, lerpAmt);
    mood.current.waterShallow.lerp(mood.target.waterShallow, lerpAmt);
    mood.current.sereneAmount += (mood.target.sereneAmount - mood.current.sereneAmount) * lerpAmt;
    mood.current.sunGlowScale += (mood.target.sunGlowScale - mood.current.sunGlowScale) * lerpAmt;
    sunGlow.scale.set(mood.current.sunGlowScale, mood.current.sunGlowScale, 1);

    // ---- reskin the world to match the current mood ----
    // Terrain: a straight multiply tint over the instanced blocks'
    // existing per-vertex colors (grass/sand/rock), so the whole island
    // can glow warm without needing to touch per-instance data.
    blockMat.color.copy(mood.current.terrainTint);
    // Foliage & rock: blend the mood tint INTO each material's own base
    // color (by sereneAmount) rather than replacing it, so trees/grass/
    // rocks keep their natural variety even at full serenity.
    rockMat.color.copy(rockBaseColor).lerp(mood.current.foliageTint, mood.current.sereneAmount * 0.5);
    tuftMat.color.copy(tuftBaseColor).lerp(mood.current.foliageTint, mood.current.sereneAmount);
    canopyMats.forEach((mat, i) => {
      mat.color.copy(canopyBaseColors[i]).lerp(mood.current.foliageTint, mood.current.sereneAmount);
      mat.emissive.copy(mood.current.foliageGlow);
    });
    waterUniforms.uDeepColor.value.copy(mood.current.waterDeep);
    waterUniforms.uShallowColor.value.copy(mood.current.waterShallow);
    waterUniforms.uSunColor.value.copy(mood.current.sunColor);
    waterUniforms.uSkyTop.value.copy(mood.current.skyTop);
    waterUniforms.uSkyHorizon.value.copy(mood.current.skyHorizon);

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

    updateSplashes(dt);

    // ---- treasure hunt ----
    if (treasureUnlocked) {
      // A slow idle bob so it reads as an object sitting in the world
      // rather than a static prop, even before anyone's nearby.
      treasureBobTime += dt;
      treasureGroup.position.y = TREASURE_POS.y + Math.sin(treasureBobTime * 1.4) * 0.05;

      if (!treasureFound) {
        const dx = camera.position.x - treasureGroup.position.x;
        const dz = camera.position.z - treasureGroup.position.z;
        const distToTreasure = Math.sqrt(dx * dx + dz * dz);

        // The glow only ramps up within a short range (see
        // TREASURE_GLOW_RADIUS), so it can't be used to spot the
        // treasure from far away - the player has to already be close.
        const proximity = Math.max(0, 1 - distToTreasure / CONFIG.TREASURE_GLOW_RADIUS);
        treasureGlow.material.opacity = proximity * 0.8;

        if (distToTreasure <= CONFIG.TREASURE_FIND_RADIUS) {
          treasureFound = true;
          lidPivot.rotation.x = -Math.PI / 2.4; // pop the lid open
          treasureGlow.scale.set(2.6, 2.6, 1);
          treasureGlow.material.opacity = 1;
          if (treasureFoundHandler) treasureFoundHandler();
        }
      }
    }

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
    // ---- treasure hunt API ----
    unlockTreasure,
    resetTreasure,
    setTreasureFoundHandler,
    getTreasurePosition,
    isTreasureUnlocked,
    isTreasureFound,
    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
      blockGeo.dispose();
      blockMat.map.dispose();
      blockMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      trunkGeo.dispose();
      trunkMat.dispose();
      canopyGeo.dispose();
      canopyMats.forEach((m) => m.dispose());
      leafTex.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      rockNoiseTex.dispose();
      tuftGeo.dispose();
      tuftMat.dispose();
      chestGeo.dispose();
      chestLidGeo.dispose();
      chestTrimGeo.dispose();
      chestWoodMat.dispose();
      chestTrimMat.dispose();
      treasureGlowTex.dispose();
      treasureGlowMat.dispose();
      splashTex.dispose();
      splashPool.forEach((s) => s.material.dispose());
      activeSplashes.forEach((s) => s.material.dispose());
      renderer.dispose();
    },
  };
}