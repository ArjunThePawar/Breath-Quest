// playerMovement.js
//
// WASD + mouse-look movement. The island's accessible area is a soft
// boundary (ACCESS_RADIUS) — walking past it starts a 10-second grace
// period before a gentle push back inside. Walking into water is now
// its own distinct feel: swimming is slower than walking, jumping is
// disabled, the camera floats and bobs at the surface instead of
// standing on the seafloor, and the transition between walking and
// swimming eases smoothly rather than snapping. A callback reports the
// current water depth each frame so the UI can show a tint overlay.

import * as THREE from "three";
import { ACCESS_RADIUS } from "./voxelWorld.js";

const MOVE_SPEED = 4.5;
const SWIM_SPEED = 2.2;         // noticeably slower than walking — water has resistance
const JUMP_VELOCITY = 8.2;
const GRAVITY = 15;
const EYE_HEIGHT = 2.3;
const CROUCH_HEIGHT = 1.5;
const SWIM_EYE_HEIGHT = 0.9;    // how high above the water surface the camera floats while swimming
const MOUSE_SENSITIVITY = 0.0022;
const BORDER_GRACE_SECONDS = 10;
const LANDING_SETTLE = 0.12;
const WATER_ENTRY_THRESHOLD = 0.15; // depth (world units) before we count the player as "in water"
const VERTICAL_EASE_SPEED = 3.5;    // how quickly the camera eases toward its target height (land <-> water)
const SWIM_BOB_SPEED = 1.6;
const SWIM_BOB_AMOUNT = 0.07;

const _levelEuler = new THREE.Euler(0, 0, 0, "YXZ");

export function initPlayerMovement({
  canvas,
  camera,
  getGroundHeight,
  getWaterDepth,
  center,
  controls,
  onBorderWarning,
  onWaterStateChange,
  spawnSplash,
}) {
  let enabled = false;
  // Separate from `enabled` on purpose: enable()/disable() are the
  // full start/stop of a session (disable resets border/water state;
  // enable() re-spawns the player). `paused` is for a temporary menu
  // (Escape) that should freeze the player exactly where they are and
  // resume from there - it must never trigger a respawn.
  let paused = false;
  let yaw = Math.PI;
  let pitch = 0;
  let velocityY = 0;
  let grounded = true;
  let crouching = false;
  let borderTimer = 0;
  let landingBobTimer = 0;
  let landingBobMagnitude = 0;
  let swimBobTime = 0;
  let inWater = false;

  const keys = new Set();

  function onKeyDown(e) {
    if (!enabled || paused) return;
    keys.add(e.code);
    // Jumping is disabled while swimming — treading water doesn't launch you.
    if (e.code === controls.jump && grounded && !inWater) {
      velocityY = JUMP_VELOCITY;
      grounded = false;
    }
    if (e.code === controls.crouch) crouching = true;
  }
  function onKeyUp(e) {
    keys.delete(e.code);
    if (e.code === controls.crouch) crouching = false;
  }
  function onMouseMove(e) {
    if (!enabled || document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * MOUSE_SENSITIVITY;
    pitch -= e.movementY * MOUSE_SENSITIVITY;
    const limit = Math.PI / 2 - 0.05;
    pitch = Math.max(-limit, Math.min(limit, pitch));
  }
  function onCanvasClick() {
    if (enabled && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("click", onCanvasClick);

  function applyLevelRotation() {
    _levelEuler.set(pitch, yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(_levelEuler);
  }

  function spawn() {
    const gx = center + ACCESS_RADIUS * 0.4;
    const gz = center + ACCESS_RADIUS * 0.4;
    const groundH = getGroundHeight(gx, gz);
    camera.position.set(gx, groundH + EYE_HEIGHT, gz);
    yaw = Math.PI + Math.PI / 4;
    pitch = 0;
    velocityY = 0;
    borderTimer = 0;
    landingBobTimer = 0;
    landingBobMagnitude = 0;
    swimBobTime = 0;
    inWater = false;
    if (onBorderWarning) onBorderWarning(null);
    if (onWaterStateChange) onWaterStateChange(0);
    applyLevelRotation();
  }
  spawn();

  function snapBackInside() {
    const dx = camera.position.x - center;
    const dz = camera.position.z - center;
    const angle = Math.atan2(dz, dx);
    const safeRadius = ACCESS_RADIUS - 1;
    camera.position.x = center + Math.cos(angle) * safeRadius;
    camera.position.z = center + Math.sin(angle) * safeRadius;
  }

  function update(dt) {
    if (!enabled || paused) return;

    const depth = getWaterDepth ? getWaterDepth(camera.position.x, camera.position.z) : 0;
    const nowInWater = depth > WATER_ENTRY_THRESHOLD;
    if (nowInWater !== inWater) {
      inWater = nowInWater;
      if (onWaterStateChange) onWaterStateChange(inWater ? depth : 0);
      // Splash only on the moment of ENTERING water, not when leaving it.
      if (inWater && spawnSplash) {
        spawnSplash(camera.position.x, camera.position.z);
      }
    } else if (inWater && onWaterStateChange) {
      onWaterStateChange(depth); // keep reporting depth while already swimming, for tint intensity
    }

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const move = new THREE.Vector3();
    if (keys.has(controls.moveForward)) move.add(forward);
    if (keys.has(controls.moveBackward)) move.sub(forward);
    if (keys.has(controls.moveRight)) move.add(right);
    if (keys.has(controls.moveLeft)) move.sub(right);

    const speed = inWater ? SWIM_SPEED : MOVE_SPEED;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.x += move.x;
      camera.position.z += move.z;
    }

    if (inWater) {
      // Swimming: no gravity, no falling — the camera eases toward a
      // floating height at the water surface, with a gentle bob so it
      // doesn't feel perfectly rigid (like treading water).
      velocityY = 0;
      grounded = false;

      swimBobTime += dt * SWIM_BOB_SPEED;
      const bob = Math.sin(swimBobTime) * SWIM_BOB_AMOUNT;
      const targetY = WATER_LEVEL_FOR_CAMERA() + SWIM_EYE_HEIGHT + bob;

      // Ease vertically instead of snapping — this is what makes entering
      // the water read as "wading in" rather than teleporting onto a float.
      camera.position.y += (targetY - camera.position.y) * Math.min(1, VERTICAL_EASE_SPEED * dt);
    } else {
      // Normal walking physics.
      velocityY -= GRAVITY * dt;
      camera.position.y += velocityY * dt;

      const groundH = getGroundHeight(camera.position.x, camera.position.z);
      const eye = crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
      const floorY = groundH + eye;

      if (camera.position.y <= floorY) {
        if (!grounded) {
          landingBobMagnitude = Math.min(0.35, Math.abs(velocityY) * 0.03);
          landingBobTimer = LANDING_SETTLE;
        }
        camera.position.y = floorY;
        velocityY = 0;
        grounded = true;
      }

      if (landingBobTimer > 0) {
        landingBobTimer = Math.max(0, landingBobTimer - dt);
        const t = landingBobTimer / LANDING_SETTLE;
        camera.position.y -= landingBobMagnitude * t;
      }
    }

    // ── Border grace-period logic (unchanged) ──
    const dx = camera.position.x - center;
    const dz = camera.position.z - center;
    const distFromCenter = Math.sqrt(dx * dx + dz * dz);

    if (distFromCenter > ACCESS_RADIUS) {
      borderTimer += dt;
      const remaining = Math.max(0, BORDER_GRACE_SECONDS - borderTimer);
      if (onBorderWarning) onBorderWarning(remaining);

      if (borderTimer >= BORDER_GRACE_SECONDS) {
        snapBackInside();
        borderTimer = 0;
        if (onBorderWarning) onBorderWarning(null);
      }
    } else if (borderTimer > 0) {
      borderTimer = 0;
      if (onBorderWarning) onBorderWarning(null);
    }

    applyLevelRotation();
  }

  // The world's water plane sits at y = 0 (WATER_LEVEL in voxelWorld.js).
  // Kept as a tiny local helper so this file doesn't need to import the
  // constant just for one number.
  function WATER_LEVEL_FOR_CAMERA() {
    return 0;
  }

  let disposed = false;
  const clock = new THREE.Clock();
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
  }
  loop();

  return {
    enable() {
      enabled = true;
      spawn();
      clock.getDelta();
    },
    disable() {
      enabled = false;
      borderTimer = 0;
      inWater = false;
      if (onBorderWarning) onBorderWarning(null);
      if (onWaterStateChange) onWaterStateChange(0);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    // Freezes the player exactly where they are (used for the Escape
    // pause menu) - deliberately does NOT touch position, border/water
    // state, or call spawn(), unlike disable()/enable(), so resuming
    // continues exactly where the player left off.
    pause() {
      paused = true;
      keys.clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    resume() {
      paused = false;
      clock.getDelta(); // discard the paused duration so it isn't treated as a physics step
    },
    dispose() {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onCanvasClick);
    },
  };
}