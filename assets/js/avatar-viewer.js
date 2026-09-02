// ===== Quest Zone — 3D Avatar Viewer =====
//
// Renders the low-poly Quest Zone avatar into a container element,
// auto-rotating slowly and draggable for manual inspection. Built with
// primitive geometry (no external 3D model file) styled after the four
// reference renders (front/back/left/right) — a plain-white tee, grey
// joggers, light skin, short black hair, bare feet.
//
// The rig is a real Object3D hierarchy with named joints AND named
// equipment anchors (head/necklace/body/legs/boots/gloves/back/
// mainHand/offHand/accessory) so a future cosmetics system has real
// attachment points to hang meshes from — see setAvatarEquipment() at
// the bottom, which is intentionally a stub for now.
//
// Public API: window.QZAvatarViewer.mount(containerEl, fallbackImgEl)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const ROTATION_PERIOD_S = 9;          // one full 360° turn every ~9s
const RESUME_DELAY_MS = 2600;         // pause after release before auto-spin resumes
const DRAG_SENSITIVITY = 0.010;       // radians per pixel of drag
const MOMENTUM_DECAY_PER_MS = 0.006;  // how fast leftover drag speed bleeds off
const MAX_MOMENTUM_SPEED = 2.2;       // rad/s cap so a fast flick can't spin wildly

// ---------------- character build ----------------

const COLORS = {
  skin: 0xe3a97c,
  skinShade: 0xcf9268,
  shirt: 0xf0f2f6,
  shirtShade: 0xd7dbe2,
  joggers: 0x6f737b,
  joggersCuff: 0x4c4f56,
  hair: 0x201b1a,
};

function mat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

// A short cylinder segment, its own group pivoting at the TOP (the
// joint), with the mesh hanging downward from that pivot — this is
// what lets e.g. the forearm rotate naturally from the elbow, and lets
// a hand/anchor sit exactly at the segment's bottom end.
function limbSegment(radiusTop, radiusBottom, length, color, radialSegments = 6) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radialSegments);
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.position.y = -length / 2;
  group.add(mesh);
  const end = new THREE.Group();
  end.position.y = -length;
  group.add(end);
  return { group, end };
}

function buildCharacter() {
  const root = new THREE.Group();
  const anchors = {}; // future equipment attachment points
  const parts = {};

  // ---- pelvis / hips (joggers waistband) ----
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.26), mat(COLORS.joggers));
  pelvis.position.y = 0.97;
  root.add(pelvis);
  parts.pelvis = pelvis;

  // ---- legs ----
  function buildLeg(sign) {
    const hip = new THREE.Group();
    hip.position.set(sign * 0.13, 0.95, 0);
    root.add(hip);

    const upper = limbSegment(0.115, 0.10, 0.44, COLORS.joggers);
    hip.add(upper.group);

    const lower = limbSegment(0.095, 0.075, 0.42, COLORS.joggers);
    upper.end.add(lower.group);

    // ankle cuff accent
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.075, 0.05, 6), mat(COLORS.joggersCuff));
    cuff.position.y = -0.40;
    lower.group.add(cuff);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), mat(COLORS.skin));
    foot.position.set(0, -0.455, 0.06);
    lower.group.add(foot);

    const bootsAnchor = new THREE.Group();
    bootsAnchor.position.set(0, -0.42, 0);
    lower.group.add(bootsAnchor);

    return { hip, upper, lower, foot, bootsAnchor };
  }
  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);
  parts.leftUpperLeg = leftLeg.upper.group;
  parts.leftLowerLeg = leftLeg.lower.group;
  parts.leftFoot = leftLeg.foot;
  parts.rightUpperLeg = rightLeg.upper.group;
  parts.rightLowerLeg = rightLeg.lower.group;
  parts.rightFoot = rightLeg.foot;
  // "legs" equipment covers both upper legs; "boots" anchors at both ankles
  anchors.legs = pelvis;
  anchors.boots = [leftLeg.bootsAnchor, rightLeg.bootsAnchor];

  // ---- torso (shirt) ----
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.40, 0.28), mat(COLORS.shirt));
  torso.position.y = 1.23;
  root.add(torso);
  parts.torso = torso;
  anchors.body = torso;

  const backAnchor = new THREE.Group();
  backAnchor.position.set(0, 1.28, -0.15);
  root.add(backAnchor);
  anchors.back = backAnchor;

  const accessoryAnchor = new THREE.Group();
  accessoryAnchor.position.set(0, 1.0, 0.14);
  root.add(accessoryAnchor);
  anchors.accessory = accessoryAnchor;

  // ---- neck + head ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.08, 6), mat(COLORS.skin));
  neck.position.y = 1.47;
  root.add(neck);

  const necklaceAnchor = new THREE.Group();
  necklaceAnchor.position.set(0, 1.44, 0.09);
  root.add(necklaceAnchor);
  anchors.necklace = necklaceAnchor;

  const head = new THREE.Group();
  head.position.y = 1.51;
  root.add(head);
  parts.head = head;
  anchors.head = head;

  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.32, 0.30), mat(COLORS.skin));
  skull.position.y = 0.16;
  head.add(skull);

  // simple faceted jaw taper for a less boxy silhouette
  const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 0.10, 6), mat(COLORS.skinShade));
  jaw.rotation.x = Math.PI;
  jaw.position.set(0, 0.015, 0.01);
  head.add(jaw);

  // spiky low-poly hair — small angled boxes fanned across the crown
  const hairGroup = new THREE.Group();
  hairGroup.position.y = 0.16;
  head.add(hairGroup);
  parts.hair = hairGroup;
  const spikes = [
    { p: [0, 0.16, 0.02], r: [0.1, 0, 0.05], s: [0.14, 0.16, 0.16] },
    { p: [-0.09, 0.15, 0.0], r: [0.05, 0, -0.35], s: [0.12, 0.15, 0.14] },
    { p: [0.09, 0.15, 0.0], r: [0.05, 0, 0.35], s: [0.12, 0.15, 0.14] },
    { p: [0, 0.14, -0.11], r: [-0.4, 0, 0], s: [0.16, 0.14, 0.14] },
    { p: [-0.1, 0.1, -0.06], r: [-0.1, 0, -0.5], s: [0.1, 0.12, 0.12] },
    { p: [0.1, 0.1, -0.06], r: [-0.1, 0, 0.5], s: [0.1, 0.12, 0.12] },
  ];
  const hairMat = mat(COLORS.hair);
  for (const s of spikes) {
    const spike = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hairMat);
    spike.scale.set(...s.s);
    spike.position.set(...s.p);
    spike.rotation.set(...s.r);
    hairGroup.add(spike);
  }
  // side hair coverage so the head doesn't look bald from the side/back
  const backHair = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.14), hairMat);
  backHair.position.set(0, 0.08, -0.1);
  hairGroup.add(backHair);

  // ---- arms ----
  function buildArm(sign) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sign * 0.32, 1.40, 0);
    root.add(shoulder);

    // slight outward rest angle so arms don't clip the torso
    shoulder.rotation.z = sign * -0.06;

    const upper = limbSegment(0.075, 0.07, 0.32, COLORS.shirt); // short sleeve = shirt-colored
    shoulder.add(upper.group);

    const forearm = limbSegment(0.062, 0.052, 0.30, COLORS.skin);
    upper.end.add(forearm.group);

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.05), mat(COLORS.skin));
    hand.position.y = -0.045;
    forearm.end.add(hand);

    const handAnchor = new THREE.Group();
    forearm.end.add(handAnchor);

    return { shoulder, upper, forearm, hand, handAnchor };
  }
  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);
  parts.leftUpperArm = leftArm.upper.group;
  parts.leftForearm = leftArm.forearm.group;
  parts.leftHand = leftArm.hand;
  parts.rightUpperArm = rightArm.upper.group;
  parts.rightForearm = rightArm.forearm.group;
  parts.rightHand = rightArm.hand;
  // right hand = main hand, left hand = off hand (mirror later if needed)
  anchors.mainHand = rightArm.handAnchor;
  anchors.offHand = leftArm.handAnchor;
  anchors.gloves = [leftArm.hand, rightArm.hand];

  return { root, anchors, parts };
}

// ---------------- viewer (scene / camera / renderer / interaction) ----------------

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function buildScene() {
  const scene = new THREE.Scene();

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(1.2, 2.4, 2.0);
  scene.add(key);

  const fill = new THREE.AmbientLight(0x8fa5c8, 0.55);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.7);
  rim.position.set(-1.2, 1.6, -2.0);
  scene.add(rim);

  return scene;
}

function reduceMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function mount(container, fallbackImg) {
  const canvas = document.createElement('canvas');
  canvas.className = 'avatar-3d-canvas';
  container.appendChild(canvas);

  let renderer;
  try {
    const testCtx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!testCtx) throw new Error('WebGL unavailable');
    renderer = createRenderer(canvas);
  } catch (err) {
    console.warn('[avatar-viewer] WebGL unavailable, showing static fallback image.', err);
    canvas.remove();
    if (fallbackImg) fallbackImg.hidden = false;
    return null;
  }

  const scene = buildScene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  // Framed with real headroom/footroom: the ~1.91-unit-tall character
  // occupies roughly 78% of the visible vertical frame, not edge-to-edge.
  camera.position.set(0, 1.15, 4.9);
  camera.lookAt(0, 0.95, 0);

  const { root: rig, anchors, parts } = buildCharacter();
  scene.add(rig);

  // ---- sizing (responsive, crisp, never distorted) ----
  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // ---- rotation state ----
  let currentAngle = 0;
  let autoSpin = !reduceMotion();
  let isDragging = false;
  let lastPointerX = 0;
  let dragSpeed = 0;       // rad/s, for the brief post-release momentum
  let momentumSpeed = 0;
  let resumeTimer = null;
  let lastFrameTime = performance.now();
  let running = true;
  let rafId = null;

  function clearResumeTimer() {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function scheduleResume() {
    clearResumeTimer();
    if (reduceMotion()) return; // stays manual-only under reduced motion
    resumeTimer = setTimeout(() => {
      autoSpin = true;
      resumeTimer = null;
    }, RESUME_DELAY_MS);
  }

  // ---- pointer interaction (mouse + touch via Pointer Events) ----
  function onPointerDown(e) {
    isDragging = true;
    autoSpin = false;
    momentumSpeed = 0;
    dragSpeed = 0;
    clearResumeTimer();
    lastPointerX = e.clientX;
    container.classList.add('dragging');
    try { container.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    const dt = Math.max(1, e.timeStamp - (onPointerMove._lastT || e.timeStamp));
    onPointerMove._lastT = e.timeStamp;
    const dAngle = dx * DRAG_SENSITIVITY;
    currentAngle += dAngle;
    dragSpeed = dAngle / (dt / 1000); // rad/s, for momentum on release
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    container.classList.remove('dragging');
    momentumSpeed = Math.max(-MAX_MOMENTUM_SPEED, Math.min(MAX_MOMENTUM_SPEED, dragSpeed));
    scheduleResume();
  }

  function onPointerUp(e) {
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    endDrag();
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  // a pointer released outside the element (capture missed, e.g. some
  // touch edge cases) should still end the drag rather than leave it stuck
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', endDrag);

  // ---- render loop ----
  function tick(now) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    const dt = Math.min(now - lastFrameTime, 100) / 1000;
    lastFrameTime = now;

    if (!isDragging) {
      if (momentumSpeed !== 0) {
        currentAngle += momentumSpeed * dt;
        const decay = MOMENTUM_DECAY_PER_MS * (dt * 1000);
        if (momentumSpeed > 0) momentumSpeed = Math.max(0, momentumSpeed - decay);
        else momentumSpeed = Math.min(0, momentumSpeed + decay);
      }
      if (autoSpin) {
        currentAngle += (Math.PI * 2 / ROTATION_PERIOD_S) * dt;
      }
    }

    rig.rotation.y = currentAngle;
    renderer.render(scene, camera);
  }

  function start() {
    if (rafId) return;
    lastFrameTime = performance.now();
    running = true;
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  start();

  function destroy() {
    stop();
    resizeObserver.disconnect();
    clearResumeTimer();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('blur', endDrag);
    renderer.dispose();
    canvas.remove();
  }

  // Reserved for a future cosmetics/equipment system — validates and
  // stores the requested equipment against the rig's named anchors.
  // Actually loading/attaching meshes per slot is intentionally not
  // implemented yet.
  const equipmentState = {};
  function setAvatarEquipment(equipment) {
    if (!equipment || typeof equipment !== 'object') return;
    for (const slot of Object.keys(equipment)) {
      if (!(slot in anchors)) {
        console.warn('[avatar-viewer] Unknown equipment slot: ' + slot);
        continue;
      }
      equipmentState[slot] = equipment[slot];
      // TODO: once item meshes exist, load/attach them to anchors[slot]
      // here and detach whatever previously occupied that slot.
    }
  }

  window.addEventListener('pagehide', destroy, { once: true });

  return { rig, anchors, parts, setAvatarEquipment, destroy };
}

window.QZAvatarViewer = { mount };
