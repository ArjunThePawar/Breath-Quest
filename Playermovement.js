// playerMovement.js
//
// WASD + mouse-look movement. The island's accessible area is no longer
// a hard wall — the player CAN walk past ACCESS_RADIUS, but a 10-second
// grace period starts the moment they cross it. A callback fires each
// frame with the seconds remaining (or null when back inside/safe), so
// the UI layer can show a "go back inside" warning with a countdown.
// If the timer runs out while still outside, the player is gently
// pushed back to just inside the boundary.

import * as THREE from "three";
import { ACCESS_RADIUS } from "./voxelWorld.js";

const MOVE_SPEED = 4.5;
const JUMP_VELOCITY = 8.2;      // was 5.2 — noticeably higher, more visible arc
const GRAVITY = 15;             // slightly higher than default so the jump still lands crisply, not floaty
const EYE_HEIGHT = 2.3;         // was 1.7 — taller, more natural standing perspective
const CROUCH_HEIGHT = 1.5;      // scaled up to match the new eye height
const MOUSE_SENSITIVITY = 0.0022;
const BORDER_GRACE_SECONDS = 10;
const LANDING_SETTLE = 0.12;    // seconds — camera eases into the floor on landing instead of snapping

const _levelEuler = new THREE.Euler(0, 0, 0, "YXZ");

export function initPlayerMovement({ canvas, camera, getGroundHeight, center, controls, onBorderWarning }) {
  let enabled = false;
  let yaw = Math.PI;
  let pitch = 0;
  let velocityY = 0;
  let grounded = true;
  let crouching = false;
  let borderTimer = 0; // seconds spent continuously outside ACCESS_RADIUS
  let landingBobTimer = 0;
  let landingBobMagnitude = 0;

  const keys = new Set();

  function onKeyDown(e) {
    if (!enabled) return;
    keys.add(e.code);
    if (e.code === controls.jump && grounded) {
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
    if (onBorderWarning) onBorderWarning(null);
    applyLevelRotation();
  }
  spawn();

  // Pushes the player back to just inside the boundary, along the same
  // angle they wandered out on (so it feels like a nudge, not a teleport
  // to spawn).
  function snapBackInside() {
    const dx = camera.position.x - center;
    const dz = camera.position.z - center;
    const angle = Math.atan2(dz, dx);
    const safeRadius = ACCESS_RADIUS - 1;
    camera.position.x = center + Math.cos(angle) * safeRadius;
    camera.position.z = center + Math.sin(angle) * safeRadius;
  }

  function update(dt) {
    if (!enabled) return;

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const move = new THREE.Vector3();
    if (keys.has(controls.moveForward)) move.add(forward);
    if (keys.has(controls.moveBackward)) move.sub(forward);
    if (keys.has(controls.moveRight)) move.add(right);
    if (keys.has(controls.moveLeft)) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      // No boundary clamp here anymore — the player is free to walk
      // past ACCESS_RADIUS. The consequence is handled below instead.
      camera.position.x += move.x;
      camera.position.z += move.z;
    }

    velocityY -= GRAVITY * dt;
    camera.position.y += velocityY * dt;

    const groundH = getGroundHeight(camera.position.x, camera.position.z);
    const eye = crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    const floorY = groundH + eye;

    if (camera.position.y <= floorY) {
      if (!grounded) {
        // just landed — the harder the fall, the more visible the settle dip
        landingBobMagnitude = Math.min(0.35, Math.abs(velocityY) * 0.03);
        landingBobTimer = LANDING_SETTLE;
      }
      camera.position.y = floorY;
      velocityY = 0;
      grounded = true;
    }

    if (landingBobTimer > 0) {
      landingBobTimer = Math.max(0, landingBobTimer - dt);
      const t = landingBobTimer / LANDING_SETTLE; // eases 1 -> 0
      camera.position.y -= landingBobMagnitude * t;
    }

    // ── Border grace-period logic ──
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
      // player made it back inside in time — clear the warning
      borderTimer = 0;
      if (onBorderWarning) onBorderWarning(null);
    }

    applyLevelRotation();
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
      if (onBorderWarning) onBorderWarning(null);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
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