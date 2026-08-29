// playerMovement.js  (NEW FILE)
//
// Adds actual WASD + mouse-look movement, since the original backend
// (breathInput.js / gameLoop.js / playerState.js) has no player or
// movement system at all — it only tracks breath timing. This file is
// purely presentational: it moves the camera around the island and
// clamps it inside the glowing accessible-area fence. It never touches
// stability, power, or breath classification.
//
// Usage:
//   const player = initPlayerMovement({
//     canvas, camera: world.camera, getGroundHeight: world.getGroundHeight,
//     center: world.CENTER, controls: settings.controls,
//   });
//   player.enable();   // call when entering gameplay
//   player.disable();  // call when returning to menu
//   player.dispose();  // call if tearing down entirely

import * as THREE from "three";
import { ACCESS_RADIUS } from "./voxelWorld.js";

const MOVE_SPEED = 4.5;        // blocks per second
const JUMP_VELOCITY = 5.2;
const GRAVITY = 14;
const EYE_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.0;
const MOUSE_SENSITIVITY = 0.0022;
const FENCE_MARGIN = 0.4;      // keeps the camera from clipping through the fence posts

export function initPlayerMovement({ canvas, camera, getGroundHeight, center, controls }) {
  let enabled = false;
  let yaw = Math.PI;   // facing toward the island center at spawn
  let pitch = -0.15;
  let velocityY = 0;
  let grounded = true;
  let crouching = false;

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

  function spawn() {
    camera.position.set(center + ACCESS_RADIUS * 0.4, EYE_HEIGHT, center + ACCESS_RADIUS * 0.4);
    yaw = Math.PI + Math.PI / 4;
    pitch = -0.15;
    velocityY = 0;
  }
  spawn();

  function update(dt) {
    if (!enabled) return;

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.sin(yaw + Math.PI / 2), 0, Math.cos(yaw + Math.PI / 2));

    const move = new THREE.Vector3();
    if (keys.has(controls.moveForward)) move.add(forward);
    if (keys.has(controls.moveBackward)) move.sub(forward);
    if (keys.has(controls.moveRight)) move.add(right);
    if (keys.has(controls.moveLeft)) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      const nextX = camera.position.x + move.x;
      const nextZ = camera.position.z + move.z;

      // clamp inside the accessible-area fence — this is the "limited
      // accessible area" boundary; the rest of the island is visible
      // but the player physically cannot walk past this radius.
      const dx = nextX - center, dz = nextZ - center;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < ACCESS_RADIUS - FENCE_MARGIN) {
        camera.position.x = nextX;
        camera.position.z = nextZ;
      }
    }

    // gravity + ground collision
    velocityY -= GRAVITY * dt;
    camera.position.y += velocityY * dt;

    const groundH = getGroundHeight(camera.position.x, camera.position.z);
    const eye = crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    const floorY = groundH + eye;

    if (camera.position.y <= floorY) {
      camera.position.y = floorY;
      velocityY = 0;
      grounded = true;
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
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
      clock.getDelta(); // discard time accumulated while disabled
    },
    disable() {
      enabled = false;
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