/**
 * 星际穿越 · 虫洞穿梭
 * Three.js + GLSL Raymarching 沉浸式体验主程序
 */

import * as THREE from 'three';
import './style.css';
import { CosmicAudio } from './audio.js';
import { sceneVertexShader, sceneFragmentShader } from './shaders/scene.js';
import { postVertexShader, postFragmentShader } from './shaders/post.js';

/* ============================================================
   常量与工具
   ============================================================ */

const JOURNEY_DURATION = 58.0; // 自动航程总时长（秒）
const PHASE_ONE_END = 0.32;
const PHASE_TWO_END = 0.64;
const DEFAULT_PARAMS = {
  throat: 10,
  lens: 1.0,
  chroma: 0.55,
  dust: 1.0,
  exposure: 1.0,
  volume: 0.7,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const pad = (n, len = 2) => String(Math.floor(n)).padStart(len, '0');
const signed = (v, digits = 1) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`;

const STAGE_META = {
  1: {
    kicker: 'PHASE 01 / SOL SYSTEM',
    title: '接近虫洞喉部',
    sub: 'APPROACH PORTAL',
  },
  2: {
    kicker: 'PHASE 02 / HYPERSPACE FOLD',
    title: '喉部穿梭',
    sub: 'THROAT TRANSIT',
  },
  3: {
    kicker: 'PHASE 03 / GARGANTUA SYSTEM',
    title: '异星系降临',
    sub: 'GARGANTUA EMERGENCE',
  },
};

const SUBTITLES = {
  1: [
    '土星轨道 · 距虫洞 0.8 AU · 永续号正在接近球形事件界面',
    '光学阵列捕获爱因斯坦环 · 背景星系开始弯曲',
    '虫洞不是黑洞 · 它是一枚悬浮在时空中的球形晶体',
    '引力透镜系数持续上升 · 准备进入喉部',
  ],
  2: [
    '事件视界已穿透 · 四维空间折叠开始',
    '检测到量子湍流与粒子剪切 · 保持航向',
    '时空曲率超出仪表量程 · 依靠引力波导航',
    '前方出现高维出口 · 准备跃出',
  ],
  3: [
    '出洞成功 · 巨人座星系全景展开',
    '太阳系已在身后坍缩为一枚球形镜像',
    '检测到 Gargantua 超大质量黑洞吸积盘',
    '永续号已抵达 · 这里是新世界的起点',
  ],
};

const $ = (id) => document.getElementById(id);

/* ============================================================
   渲染器 / 场景
   ============================================================ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: false,
  });
} catch (error) {
  console.error('[webgl] 初始化失败', error);
}
const stageEl = $('stage');

if (!renderer) {
  const desc = document.querySelector('.intro-desc');
  if (desc) desc.innerHTML = '当前浏览器无法初始化 WebGL 渲染环境。<br />请使用支持 WebGL2 的现代浏览器，并确认硬件加速已开启。';
  const startBtn = $('startBtn');
  if (startBtn) startBtn.disabled = true;
  throw new Error('WebGL renderer unavailable');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = true;
stageEl.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 8000);
camera.position.set(0, 10, 72);

const fullscreenScene = new THREE.Scene();
const fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fullscreenGeo = new THREE.PlaneGeometry(2, 2);

const sceneUniforms = {
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uCamMat: { value: new THREE.Matrix3() },
  uFov: { value: 60 },
  uThroat: { value: DEFAULT_PARAMS.throat },
  uLens: { value: DEFAULT_PARAMS.lens },
  uChroma: { value: DEFAULT_PARAMS.chroma },
  uDust: { value: DEFAULT_PARAMS.dust },
  uExposure: { value: DEFAULT_PARAMS.exposure },
  uWarp: { value: 0 },
  uInside: { value: 0 },
  uPhase: { value: 1 },
  uJourney: { value: 0 },
  uFlash: { value: 0 },
  uBhDir: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
  uBhIntensity: { value: 0.55 },
  uBhPos: { value: new THREE.Vector3(0, 34.5, -520) },
  uBhRs: { value: 18 },
  uDiskInner: { value: 3.0 },
  uDiskOuter: { value: 14.0 },
  uDiskNormal: { value: new THREE.Vector3(0.06, 1.0, 0.12).normalize() },
  uBhActive: { value: 0 },
};

const sceneMaterial = new THREE.ShaderMaterial({
  uniforms: sceneUniforms,
  vertexShader: sceneVertexShader,
  fragmentShader: sceneFragmentShader,
  depthTest: false,
  depthWrite: false,
  transparent: false,
});
const sceneMesh = new THREE.Mesh(fullscreenGeo, sceneMaterial);
sceneMesh.frustumCulled = false;
fullscreenScene.add(sceneMesh);

const postUniforms = {
  tDiffuse: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uWarp: { value: 0 },
  uFlash: { value: 0 },
  uChroma: { value: DEFAULT_PARAMS.chroma },
  uExposure: { value: DEFAULT_PARAMS.exposure },
  uInside: { value: 0 },
};

const postMaterial = new THREE.ShaderMaterial({
  uniforms: postUniforms,
  vertexShader: postVertexShader,
  fragmentShader: postFragmentShader,
  depthTest: false,
  depthWrite: false,
});
const postScene = new THREE.Scene();
const postQuad = new THREE.Mesh(fullscreenGeo, postMaterial);
postQuad.frustumCulled = false;
postScene.add(postQuad);

const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
  depthBuffer: false,
  stencilBuffer: false,
});
renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
postUniforms.tDiffuse.value = renderTarget.texture;

let resolutionScale = 1;

/* ============================================================
   状态
   ============================================================ */

const input = {
  keys: new Set(),
  boostKey: false,
  brakeKey: false,
  boostButton: false,
  dragging: false,
  lastPointerX: 0,
  lastPointerY: 0,
  lookYaw: 0,
  lookPitch: 0,
};

const state = {
  started: false,
  audioReady: false,
  muted: false,
  auto: true,
  autoBlend: 1,
  autoBlendFromPos: new THREE.Vector3(),
  autoBlendFromQuat: new THREE.Quaternion(),
  journeyPlaying: false,
  journey: 0,
  journeyRate: 1,
  journeyFinished: false,
  journeyEndClock: 0,
  stage: 1,
  inside: 0,
  warp: 0,
  flash: 0,
  flashTimer: 0.6,
  boost: false,
  brake: false,
  speed: 0.218,
  manualThrottle: 0.62,
  bhActive: 0,
  time: 0,
  missionElapsed: 0,
  subtitleIndex: 0,
  subtitleTimer: 0,
  bannerTimer: 0,
  toastTimer: 0,
  params: { ...DEFAULT_PARAMS },
};

const manual = {
  pos: new THREE.Vector3(0, 10, 72),
  quat: new THREE.Quaternion(),
  throttle: 0.62,
  speed: 0,
};

const audio = new CosmicAudio();
audio.setVolume(DEFAULT_PARAMS.volume);

let baseQuat = new THREE.Quaternion();

/* ============================================================
   相机 / 航线
   ============================================================ */

const UP = new THREE.Vector3(0, 1, 0);
const LOOK_EULER = new THREE.Euler(0, 0, 0, 'YXZ');
const LOOK_QUAT = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _qRoll = new THREE.Quaternion();
const _qShake = new THREE.Quaternion();
const _eShake = new THREE.Euler(0, 0, 0, 'YXZ');
const _zAxis = new THREE.Vector3(0, 0, 1);
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vBh = new THREE.Vector3();
const _qAuto = new THREE.Quaternion();
const _qDesired = new THREE.Quaternion();
const _qSteer = new THREE.Quaternion();
const _hudEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function throatRadius() {
  return state.params.throat;
}

function getBlackHolePos(out = new THREE.Vector3()) {
  const R = throatRadius();
  return out.set(0, R * 3.45, -R * 52);
}

function lookQuaternionAt(pos, target, roll = 0) {
  _m4.lookAt(pos, target, UP);
  _qAuto.setFromRotationMatrix(_m4);
  _qRoll.setFromAxisAngle(_zAxis, roll);
  _qAuto.multiply(_qRoll);
  return _qAuto;
}

function computeAutoCamera(journey, time) {
  const R = throatRadius();
  let pos = _vA;
  let target = _vB;

  if (journey < PHASE_ONE_END) {
    // ---------- 阶段一：接近虫洞 ----------
    const p = clamp(journey / PHASE_ONE_END, 0, 1);
    // 先保持远距观察，再逐渐加速坠向喉部，避免球体过早占满画面
    const e = Math.pow(p, 1.85);
    const startZ = R * 7.4;
    const endZ = R * 1.55;

    pos.set(
      (R * 1.9) * (1 - e) + Math.sin(p * 4.1 + 0.35) * R * 0.24 * (1 - e) + Math.sin(time * 0.21) * R * 0.035 * (1 - e),
      (R * 1.05) * (1 - e) + Math.cos(p * 3.3) * R * 0.085 * (1 - e) + Math.sin(time * 0.16) * R * 0.03 * (1 - e),
      startZ * (1 - e) + endZ * e
    );

    target.set(
      Math.sin(p * 1.9 + 0.3) * R * 0.055,
      Math.cos(p * 2.2) * R * 0.045,
      0
    );

    const fov = 57 + e * 3.5 + Math.sin(p * Math.PI) * 2.0;
    return { pos, target, roll: Math.sin(p * 2.8 + 0.4) * 0.035 + Math.sin(time * 0.1) * 0.012, fov };
  }

  if (journey < PHASE_TWO_END) {
    // ---------- 阶段二：喉部穿梭 ----------
    const p = clamp((journey - PHASE_ONE_END) / (PHASE_TWO_END - PHASE_ONE_END), 0, 1);
    const e = smoothstep(0, 1, p);
    const z = R * 1.55 * (1 - e) + (-R * 3.0) * e;
    const envelope = Math.sin(p * Math.PI);

    pos.set(
      Math.sin(p * Math.PI * 3.2 + 0.3) * R * 0.19 * envelope + Math.sin(time * 2.1) * R * 0.015 * envelope,
      Math.cos(p * Math.PI * 2.1 + 0.8) * R * 0.13 * envelope + Math.cos(time * 1.7) * R * 0.012 * envelope,
      z
    );

    target.set(pos.x * 0.2, pos.y * 0.2, z - R * 2.5);
    target.x += Math.sin(time * 1.6) * R * 0.06 * (0.3 + envelope);
    target.y += Math.cos(time * 1.35) * R * 0.05 * (0.3 + envelope);

    const roll = Math.sin(p * Math.PI * 2.0) * 0.18 + Math.sin(time * 0.85) * 0.025;
    const fov = 61 + Math.pow(envelope, 1.15) * 37;
    return { pos, target, roll, fov };
  }

  // ---------- 阶段三：出洞与异星系降临 ----------
  const p = clamp((journey - PHASE_TWO_END) / (1 - PHASE_TWO_END), 0, 1);
  const e = smoothstep(0, 1, p);
  const extra = state.journeyFinished ? Math.max(0, time - state.journeyEndClock) : 0;

  pos.set(
    Math.sin(p * Math.PI * 1.6) * R * 0.28 + Math.sin(time * 0.2) * R * 0.12 * p,
    R * 0.18 * e + e * R * 0.66 + Math.sin(time * 0.17 + p) * R * 0.06 * p,
    (-R * 3.0) + e * (-R * 6.4) - extra * R * 0.11
  );

  getBlackHolePos(target);
  target.y -= R * 0.28;
  target.x += Math.sin(time * 0.11) * R * 0.16;

  return { pos, target, roll: Math.sin(p * Math.PI * 1.1) * 0.055 + Math.sin(time * 0.15) * 0.018, fov: 62 - e * 2.5 };
}

function applyAutoCamera(dt, time) {
  const shot = computeAutoCamera(state.journey, time);

  // 从手动接管平滑恢复
  if (state.autoBlend < 1) {
    state.autoBlend = Math.min(1, state.autoBlend + dt / 1.5);
    const k = smoothstep(0, 1, state.autoBlend);
    camera.position.lerpVectors(state.autoBlendFromPos, shot.pos, k);
    _qDesired.copy(lookQuaternionAt(shot.pos, shot.target, shot.roll));
    baseQuat.slerpQuaternions(state.autoBlendFromQuat, _qDesired, k);
    camera.quaternion.copy(baseQuat);
    camera.fov = THREE.MathUtils.lerp(camera.fov, shot.fov, 0.08);
  } else {
    camera.position.copy(shot.pos);
    baseQuat.copy(lookQuaternionAt(shot.pos, shot.target, shot.roll));
    camera.quaternion.copy(baseQuat);
    camera.fov = shot.fov;
  }

  camera.fov = clamp(camera.fov, 40, 120);
  camera.updateProjectionMatrix();
}

function updateManualCamera(dt) {
  const R = throatRadius();

  const forwardPressed = input.keys.has('KeyW') || input.keys.has('ArrowUp');
  const backPressed = input.keys.has('KeyS') || input.keys.has('ArrowDown');
  const leftPressed = input.keys.has('KeyA') || input.keys.has('ArrowLeft');
  const rightPressed = input.keys.has('KeyD') || input.keys.has('ArrowRight');
  const rollLeft = input.keys.has('KeyQ');
  const rollRight = input.keys.has('KeyE');

  const pitchAxis = (forwardPressed ? 1 : 0) - (backPressed ? 1 : 0);
  const yawAxis = (leftPressed ? 1 : 0) - (rightPressed ? 1 : 0);
  const rollAxis = (rollLeft ? 1 : 0) - (rollRight ? 1 : 0);

  const pitchRate = 0.82;
  const yawRate = 0.7;
  const rollRate = 1.1;

  if (pitchAxis !== 0) {
    _eShake.set(pitchAxis * pitchRate * dt, 0, 0, 'YXZ');
    manual.quat.multiply(_qSteer.setFromEuler(_eShake));
  }
  if (yawAxis !== 0) {
    _eShake.set(0, yawAxis * yawRate * dt, 0, 'YXZ');
    manual.quat.multiply(_qSteer.setFromEuler(_eShake));
  }
  if (rollAxis !== 0) {
    _eShake.set(0, 0, rollAxis * rollRate * dt, 'YXZ');
    manual.quat.multiply(_qSteer.setFromEuler(_eShake));
  }
  manual.quat.normalize();

  const throttleTarget = state.brake ? 0.08 : state.boost ? 1.75 : 0.72;
  manual.throttle = damp(manual.throttle, throttleTarget, 2.6, dt);

  const cruiseSpeed = 3.8 * (R / 10);
  manual.speed = manual.throttle * cruiseSpeed * (state.boost ? 1.45 : 1.0);

  _vTarget.set(0, 0, -1).applyQuaternion(manual.quat);
  manual.pos.addScaledVector(_vTarget, manual.speed * dt);

  // 航程边界，避免飞出体验空间
  const maxDist = R * 46;
  if (manual.pos.length() > maxDist) {
    manual.pos.setLength(maxDist);
  }

  camera.position.copy(manual.pos);
  baseQuat.copy(manual.quat);
  camera.quaternion.copy(baseQuat);

  const fovTarget = 64 + state.inside * 13 + (state.boost ? 6 : 0);
  camera.fov = damp(camera.fov, fovTarget, 2.2, dt);
  camera.updateProjectionMatrix();
}

function resolveStage() {
  if (state.auto) {
    if (state.journey < PHASE_ONE_END) return 1;
    if (state.journey < PHASE_TWO_END) return 2;
    return 3;
  }

  const R = throatRadius();
  const dist = camera.position.length();
  if (state.stage === 2) {
    if (dist < R * 1.24) return 2;
  } else if (dist < R * 1.02) {
    return 2;
  }
  return camera.position.z >= 0 ? 1 : 3;
}

function estimateJourneyFromCamera() {
  const R = throatRadius();
  const dist = camera.position.length();
  const z = camera.position.z;
  if (dist < R * 1.02) {
    const p = clamp((R - z) / (2 * R), 0, 1);
    return PHASE_ONE_END + (PHASE_TWO_END - PHASE_ONE_END) * p;
  }
  if (z >= 0) {
    const d = clamp((dist - R) / (R * 6.5), 0, 1);
    return PHASE_ONE_END * (1 - d);
  }
  const d = clamp((dist - R) / (R * 9), 0, 1);
  return PHASE_TWO_END + (1 - PHASE_TWO_END) * d;
}

function updateCamera(dt, time) {
  if (state.auto) {
    applyAutoCamera(dt, time);
  } else {
    updateManualCamera(dt);
  }

  // 喉部湍流 / 曲速时的镜头震动
  const shakeStrength = state.inside * 0.55 + state.warp * 0.25;
  if (shakeStrength > 0.01) {
    const R = throatRadius();
    const amp = shakeStrength * R * 0.006;
    camera.position.x += (Math.sin(time * 27.3) + Math.sin(time * 13.7 + 1.3)) * amp;
    camera.position.y += (Math.cos(time * 23.1 + 0.4) + Math.sin(time * 17.9)) * amp;
    camera.position.z += Math.sin(time * 19.4 + 2.2) * amp * 0.6;

    _eShake.set(
      (Math.sin(time * 21.1 + 0.2) * 0.0035 + Math.cos(time * 9.7) * 0.0016) * shakeStrength,
      (Math.cos(time * 18.4 + 1.1) * 0.0042) * shakeStrength,
      (Math.sin(time * 24.3) * 0.006) * shakeStrength
    );
    _qShake.setFromEuler(_eShake);
    camera.quaternion.copy(baseQuat).multiply(_qShake);
  } else {
    camera.quaternion.copy(baseQuat);
  }

  // 鼠标自由观察（叠加在驾驶姿态之上）
  LOOK_EULER.set(input.lookPitch, input.lookYaw, 0, 'YXZ');
  LOOK_QUAT.setFromEuler(LOOK_EULER);
  camera.quaternion.multiply(LOOK_QUAT);
  camera.quaternion.normalize();

  camera.updateMatrixWorld(true);
}

/* ============================================================
   每帧状态更新
   ============================================================ */

function updateJourney(dt) {
  if (state.auto && state.journeyPlaying) {
    let targetRate = 1;
    if (state.boost) targetRate = 2.15;
    else if (state.brake) targetRate = 0.42;
    state.journeyRate = damp(state.journeyRate, targetRate, 3.0, dt);
    state.journey = Math.min(1, state.journey + (dt / JOURNEY_DURATION) * state.journeyRate);

    if (state.journey >= 1 && !state.journeyFinished) {
      state.journeyFinished = true;
      state.journeyEndClock = state.time;
      showToast('库珀航程已完成 · 可拖拽视角回望身后的球形镜像', 4200);
      showPhaseBanner(3);
    }
  }
}

function updatePhysics(dt) {
  const R = throatRadius();
  const dist = camera.position.length();

  const targetInside = 1 - smoothstep(R * 0.78, R * 1.18, dist);
  state.inside = damp(state.inside, targetInside, 6.0, dt);

  const targetWarp = clamp(
    state.inside * 0.78 + (state.boost ? 0.55 : 0) + (state.stage === 2 ? 0.16 : 0),
    0,
    1
  );
  state.warp = damp(state.warp, targetWarp, 4.0, dt);

  state.boost = (input.boostKey || input.boostButton) && state.started;
  state.brake = input.brakeKey && state.started;

  state.flash = Math.max(0, state.flash - dt * 2.0);
  state.flashTimer -= dt;
  if (state.started && state.stage === 2 && state.inside > 0.25 && state.flashTimer <= 0) {
    if (Math.random() < 0.72) {
      state.flash = Math.max(state.flash, 0.16 + Math.random() * 0.26);
    }
    state.flashTimer = 0.6 + Math.random() * 1.4;
  }

  // 速度显示
  let targetSpeed;
  if (state.auto) {
    targetSpeed = 0.218 + state.inside * 0.12 + (state.boost ? 0.56 : 0) - (state.brake ? 0.08 : 0);
  } else {
    targetSpeed = clamp(manual.speed / 16, 0.04, 0.99);
  }
  state.speed = damp(state.speed, targetSpeed, 3.0, dt);

  state.manualThrottle = manual.throttle;
}

function updateStageAndProgress(dt) {
  const stage = resolveStage();
  if (stage !== state.stage) {
    setStage(stage);
  }

  if (!state.auto) {
    const R = throatRadius();
    const dist = camera.position.length();
    if (state.stage === 1) {
      state.journey = PHASE_ONE_END * clamp(1 - (dist - R) / (R * 6.5), 0, 1);
    } else if (state.stage === 2) {
      const p = clamp((R - camera.position.z) / (2 * R), 0, 1);
      state.journey = PHASE_ONE_END + (PHASE_TWO_END - PHASE_ONE_END) * p;
    } else {
      const p = clamp((dist - R) / (R * 9), 0, 1);
      state.journey = PHASE_TWO_END + (1 - PHASE_TWO_END) * p;
    }
  }

  state.subtitleTimer -= dt;
  if (state.subtitleTimer <= 0) {
    state.subtitleIndex = (state.subtitleIndex + 1) % SUBTITLES[state.stage].length;
    $('subtitleText').textContent = SUBTITLES[state.stage][state.subtitleIndex];
    state.subtitleTimer = 7.5;
  }

  if (state.bannerTimer > 0) {
    state.bannerTimer -= dt;
    if (state.bannerTimer <= 0) $('phaseBanner').classList.remove('is-visible');
  }

  if (state.toastTimer > 0) {
    state.toastTimer -= dt;
    if (state.toastTimer <= 0) $('toast').classList.remove('is-visible');
  }
}

function setStage(stage, force = false) {
  if (stage === state.stage && !force) return;
  state.stage = stage;
  state.subtitleIndex = 0;
  state.subtitleTimer = 7.5;
  $('subtitleText').textContent = SUBTITLES[stage][0];
  showPhaseBanner(stage);
  state.flash = Math.max(state.flash, 0.55);

  document.querySelectorAll('.stage-item').forEach((el) => {
    const s = Number(el.dataset.stage);
    el.classList.toggle('is-active', s === stage);
    el.classList.toggle('is-done', s < stage);
  });

  const link = $('linkText');
  if (stage === 1) {
    link.textContent = '稳定';
    link.style.color = '#8fffd0';
  } else if (stage === 2) {
    link.textContent = '高维负载';
    link.style.color = '#ffd39a';
  } else {
    link.textContent = '重连成功';
    link.style.color = '#8fe8ff';
  }
}

function showPhaseBanner(stage) {
  const meta = STAGE_META[stage];
  $('phaseKicker').textContent = meta.kicker;
  $('phaseTitle').textContent = meta.title;
  $('phaseSub').textContent = meta.sub;
  const banner = $('phaseBanner');
  banner.classList.remove('is-visible');
  // 强制重排以重新触发过渡
  void banner.offsetWidth;
  banner.classList.add('is-visible');
  state.bannerTimer = 4.4;
}

function showToast(message, duration = 2600) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  state.toastTimer = duration / 1000;
}

/* ============================================================
   HUD 更新
   ============================================================ */

const HUD_INTERVAL = 0.08;
let hudAccum = 0;

function formatDistance(km) {
  const n = Math.max(0, Math.round(km));
  return String(n).padStart(6, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function updateHUD() {
  const R = throatRadius();
  const camDist = camera.position.length();
  const surfaceDist = Math.max(0, camDist - R);
  const km = surfaceDist * 148000;
  const lensFactor = Math.min(9.999, state.params.lens * (R * R) / Math.max(0.18, surfaceDist * surfaceDist));
  const curvature = Math.min(9.999, lensFactor * 0.42 + state.inside * 2.4 + state.warp * 0.35);
  const doppler = clamp(0.006 + state.speed * 0.42 + state.inside * 0.46 + (state.boost ? 0.1 : 0), 0, 3);

  $('throatDistance').textContent = formatDistance(km);
  $('lensFactor').textContent = lensFactor.toFixed(3);
  $('doppler').textContent = `${doppler >= 0 ? '+' : ''}${doppler.toFixed(3)}`;
  $('curvature').textContent = curvature.toFixed(3);
  $('phaseMetric').textContent = `${pad(state.stage, 2)} / 03`;

  const closeness = clamp(1 - surfaceDist / (R * 7.2), 0, 1);
  $('throatBar').style.width = `${(closeness * 100).toFixed(1)}%`;
  $('journeyPercent').textContent = `${(state.journey * 100).toFixed(1).padStart(4, '0')}%`;
  $('journeyBar').style.width = `${(state.journey * 100).toFixed(2)}%`;

  $('coordX').textContent = signed(camera.position.x, 1);
  $('coordY').textContent = signed(camera.position.y, 1);
  $('coordZ').textContent = signed(camera.position.z, 1);

  // 姿态解算
  const euler = _hudEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  let yawDeg = THREE.MathUtils.radToDeg(euler.y);
  let pitchDeg = THREE.MathUtils.radToDeg(euler.x);
  let rollDeg = THREE.MathUtils.radToDeg(euler.z);
  yawDeg = ((yawDeg + 180) % 360 + 360) % 360 - 180;
  pitchDeg = ((pitchDeg + 180) % 360 + 360) % 360 - 180;
  rollDeg = ((rollDeg + 180) % 360 + 360) % 360 - 180;
  const heading = ((Math.round(-yawDeg) % 360) + 360) % 360;

  $('yawValue').textContent = `${signed(yawDeg, 1)}°`;
  $('rollValue').textContent = `${signed(rollDeg, 1)}°`;
  $('pitchValue').textContent = `${signed(pitchDeg, 1)}°`;
  $('pitchValue2').textContent = `${signed(pitchDeg, 1)}°`;
  $('headingValue').textContent = `${pad(heading, 3)}°`;
  $('headingBig').textContent = pad(heading, 3);

  const horizon = $('attitudeHorizon');
  horizon.setAttribute(
    'transform',
    `rotate(${(rollDeg * 0.6).toFixed(1)} 60 60) translate(0 ${(clamp(pitchDeg, -45, 45) * 0.35).toFixed(1)})`
  );
  $('rollNeedle').setAttribute('transform', `rotate(${rollDeg.toFixed(1)} 60 60)`);

  const missionSec = Math.floor(state.missionElapsed);
  $('missionClock').textContent = `T+ ${pad(missionSec / 3600)}:${pad((missionSec % 3600) / 60)}:${pad(missionSec % 60)}`;

  $('throttleBar').style.width = `${clamp(state.speed * 100, 6, 100).toFixed(1)}%`;
  $('speedReadout').textContent = state.speed.toFixed(3);
  $('boostState').textContent = state.boost ? '曲速爆发' : state.brake ? '减速' : state.inside > 0.5 ? '高维滑行' : '巡航';

  const stageText = state.stage === 1 ? 'SOL / 太阳系端' : state.stage === 2 ? 'THROAT / 喉部' : 'GARGANTUA / 异星系';
  $('reticle-status-target').textContent = stageText;

  // 雷达波动
  const t = state.time;
  const amp = 8 + state.warp * 14;
  const path = `M0 80 C 30 80 34 ${74 - Math.sin(t * 1.3) * amp} 48 72 S 70 80 88 ${78 - Math.sin(t * 1.7) * amp} S 110 ${20 + Math.cos(t * 0.9) * 8} 128 ${44 - state.warp * 10} S 145 80 162 ${74 + Math.sin(t * 1.1) * amp * 0.5} S 200 62 240 78`;
  $('radarWave').setAttribute('d', path);
  $('radarPulse').setAttribute('cx', (128 + Math.sin(t * 0.65) * 34).toFixed(1));
  $('radarPulse').setAttribute('cy', (44 + Math.cos(t * 0.9) * 12 - state.warp * 8).toFixed(1));

  const reticle = $('reticleRoll');
  if (reticle) reticle.style.transform = `rotate(${rollDeg.toFixed(1)}deg)`;
}

function updateParamsDisplays() {
  $('valThroat').textContent = state.params.throat.toFixed(1);
  $('valLens').textContent = state.params.lens.toFixed(2);
  $('valChroma').textContent = state.params.chroma.toFixed(2);
  $('valDust').textContent = state.params.dust.toFixed(2);
  $('valExposure').textContent = state.params.exposure.toFixed(2);
  $('valVolume').textContent = String(Math.round(state.params.volume * 100));

  sceneUniforms.uThroat.value = state.params.throat;
  sceneUniforms.uLens.value = state.params.lens;
  sceneUniforms.uChroma.value = state.params.chroma;
  sceneUniforms.uDust.value = state.params.dust;
  sceneUniforms.uExposure.value = state.params.exposure;
  postUniforms.uChroma.value = state.params.chroma;
  postUniforms.uExposure.value = state.params.exposure;
}

/* ============================================================
   模式控制 / 交互
   ============================================================ */

function setMode(mode) {
  if (!state.started) return;
  if (mode === 'auto' && !state.auto) {
    state.journey = estimateJourneyFromCamera();
    state.journeyPlaying = true;
    state.journeyFinished = state.journey >= 1;
    if (state.journeyFinished) state.journeyEndClock = state.time;
    state.auto = true;
    state.autoBlend = 0;
    state.autoBlendFromPos.copy(camera.position);
    state.autoBlendFromQuat.copy(baseQuat);
    showToast('自动驾驶已接管 · 正在回归库珀航线');
  } else if (mode === 'manual' && state.auto) {
    manual.pos.copy(camera.position);
    manual.quat.copy(baseQuat);
    manual.throttle = 0.72;
    manual.speed = manual.throttle * 3.8 * (throatRadius() / 10);
    state.auto = false;
    state.journeyPlaying = false;
    state.autoBlend = 1;
    input.lookYaw = 0;
    input.lookPitch = 0;
    showToast('手动驾驶已接管 · W/A/S/D 调整姿态 · Q/E 滚转');
  }
  syncModeButtons();
}

function syncModeButtons() {
  $('autoBtn').classList.toggle('is-active', state.auto);
  $('manualBtn').classList.toggle('is-active', !state.auto);
}

function setBoost(active, source = 'key') {
  if (source === 'key') input.boostKey = active;
  else input.boostButton = active;
  const next = input.boostKey || input.boostButton;
  if (next && !state.boost && state.started) {
    audio.boostBurst();
    state.flash = Math.max(state.flash, 0.32);
    showToast('曲速推进器过载 · 视界拉伸增强', 1800);
  }
  state.boost = next && state.started;
  $('boostBtn').classList.toggle('is-held', next);
}

function setBrake(active) {
  input.brakeKey = active;
  state.brake = active && state.started;
}

function toggleParams(force) {
  const panel = $('paramsPanel');
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('is-open');
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', String(!open));
}

function toggleAudio() {
  if (!state.started) return;
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  $('audioToggle').classList.toggle('is-muted', state.muted);
  showToast(state.muted ? '深空音频已静音' : '深空音频已开启');
}

function applyParamsFromInputs() {
  state.params.throat = Number($('paramThroat').value);
  state.params.lens = Number($('paramLens').value);
  state.params.chroma = Number($('paramChroma').value);
  state.params.dust = Number($('paramDust').value);
  state.params.exposure = Number($('paramExposure').value);
  state.params.volume = Number($('paramVolume').value) / 100;
  updateParamsDisplays();
  if (state.audioReady) audio.setVolume(state.params.volume);
}

function resetParams() {
  $('paramThroat').value = DEFAULT_PARAMS.throat;
  $('paramLens').value = DEFAULT_PARAMS.lens;
  $('paramChroma').value = DEFAULT_PARAMS.chroma;
  $('paramDust').value = DEFAULT_PARAMS.dust;
  $('paramExposure').value = DEFAULT_PARAMS.exposure;
  $('paramVolume').value = DEFAULT_PARAMS.volume * 100;
  applyParamsFromInputs();
  showToast('时空参数已恢复默认');
}

async function beginJourney(restart = false) {
  if (!state.started) {
    state.started = true;
    state.journeyPlaying = true;
    state.journey = 0;
    state.journeyRate = 1;
    state.journeyFinished = false;
    state.missionElapsed = 0;
    state.subtitleIndex = 0;
    state.subtitleTimer = 0;
    setStage(1);
    state.stage = 1;

    $('intro').classList.add('is-hidden');
    $('hud').classList.remove('is-hidden');

    try {
      await audio.init();
      audio.setVolume(state.params.volume);
      audio.setMuted(state.muted);
      state.audioReady = true;
    } catch (error) {
      console.warn('[audio] 初始化失败', error);
      state.audioReady = false;
    }

    syncModeButtons();
    showPhaseBanner(1);
    showToast('航程开始 · Endurance 正在接近虫洞喉部', 3000);
    $('subtitleText').textContent = SUBTITLES[1][0];
  } else if (restart) {
    state.journey = 0;
    state.journeyRate = 1;
    state.journeyPlaying = true;
    state.journeyFinished = false;
    state.auto = true;
    state.manualThrottle = 0.62;
    state.inside = 0;
    state.warp = 0;
    state.flash = 0.7;
    state.subtitleIndex = 0;
    state.subtitleTimer = 0;
    state.journeyEndClock = 0;
    input.lookPitch = 0;
    input.lookYaw = 0;
    state.autoBlend = 1;
    syncModeButtons();
    setStage(1);
    showPhaseBanner(1);
    showToast('库珀航程已重置 · 再次穿越事件视界', 2600);
    $('subtitleText').textContent = SUBTITLES[1][0];
  }
}

/* ============================================================
   事件绑定
   ============================================================ */

function bindUI() {
  $('startBtn').addEventListener('click', () => beginJourney(false));
  $('resetBtn').addEventListener('click', () => {
    if (state.started) beginJourney(true);
  });
  $('autoBtn').addEventListener('click', () => setMode('auto'));
  $('manualBtn').addEventListener('click', () => setMode('manual'));
  $('boostBtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setBoost(true, 'button');
  });
  window.addEventListener('pointerup', () => setBoost(false, 'button'));
  window.addEventListener('pointercancel', () => setBoost(false, 'button'));

  $('paramsToggle').addEventListener('click', () => toggleParams());
  $('paramsClose').addEventListener('click', () => toggleParams(false));
  $('audioToggle').addEventListener('click', toggleAudio);
  $('paramsReset').addEventListener('click', resetParams);

  ['Throat', 'Lens', 'Chroma', 'Dust', 'Exposure', 'Volume'].forEach((name) => {
    $(`param${name}`).addEventListener('input', applyParamsFromInputs);
  });

  // 鼠标 / 触摸自由观察
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.started) return;
    input.dragging = true;
    input.lastPointerX = e.clientX;
    input.lastPointerY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!input.dragging) return;
    const dx = e.clientX - input.lastPointerX;
    const dy = e.clientY - input.lastPointerY;
    input.lastPointerX = e.clientX;
    input.lastPointerY = e.clientY;
    const sensitivity = 0.0026;
    input.lookYaw = clamp(input.lookYaw - dx * sensitivity, -2.0, 2.0);
    input.lookPitch = clamp(input.lookPitch - dy * sensitivity, -1.3, 1.3);
  });
  const endDrag = () => {
    input.dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.dragging = false;
    setBoost(false, 'key');
    setBoost(false, 'button');
    setBrake(false);
  });

  // 键盘
  window.addEventListener('keydown', (e) => {
    const target = e.target;
    const isFormField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if (e.code === 'Escape') {
      toggleParams(false);
      return;
    }
    if (!isFormField && e.code === 'KeyP') {
      e.preventDefault();
      toggleParams();
      return;
    }
    if (!isFormField && e.code === 'KeyM') {
      e.preventDefault();
      toggleAudio();
      return;
    }
    if (isFormField || !state.started) return;

    const controlKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Space',
    ]);
    if (controlKeys.has(e.code)) e.preventDefault();

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      setBoost(true, 'key');
      return;
    }
    if (e.code === 'Space') {
      setBrake(true);
      return;
    }

    input.keys.add(e.code);

    // 驾驶键自动接管手动模式
    const takeoverKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (takeoverKeys.includes(e.code) && state.auto) {
      setMode('manual');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      setBoost(false, 'key');
      return;
    }
    if (e.code === 'Space') {
      setBrake(false);
      return;
    }
    input.keys.delete(e.code);
  });
}

/* ============================================================
   罗盘刻度 / 初始化
   ============================================================ */

function buildCompass() {
  const holder = $('compassTicks');
  holder.innerHTML = '';
  const labels = ['北', '东', '南', '西'];
  for (let i = 0; i <= 24; i++) {
    const tick = document.createElement('span');
    const ratio = i / 24;
    tick.style.left = `${ratio * 100}%`;
    if (i % 6 === 0) {
      tick.classList.add('major', 'label');
      tick.textContent = labels[i / 6];
    } else if (i % 3 === 0) {
      tick.classList.add('major');
    }
    holder.appendChild(tick);
  }
}

/* ============================================================
   尺寸 / 自适应
   ============================================================ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.35 : 1.5) * resolutionScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, true);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  renderTarget.setSize(buffer.x, buffer.y);
  sceneUniforms.uResolution.value.set(buffer.x, buffer.y);
  postUniforms.uResolution.value.set(buffer.x, buffer.y);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!state.audioReady || !audio.ctx) return;
  if (document.hidden) {
    audio.ctx.suspend().catch(() => {});
  } else {
    audio.resume();
  }
});

/* ============================================================
   主循环
   ============================================================ */

function updateUniforms() {
  sceneUniforms.uTime.value = state.time;
  sceneUniforms.uCamPos.value.copy(camera.position);
  sceneUniforms.uCamMat.value.setFromMatrix4(camera.matrixWorld);
  sceneUniforms.uFov.value = camera.fov * (camera.aspect < 0.82 ? 1.16 : 1.0);
  sceneUniforms.uWarp.value = state.warp;
  sceneUniforms.uInside.value = state.inside;
  sceneUniforms.uPhase.value = state.stage;
  sceneUniforms.uJourney.value = state.journey;
  sceneUniforms.uFlash.value = state.flash * (0.35 + state.inside * 0.65);

  const R = state.params.throat;
  const bhPos = getBlackHolePos(_vBh);
  sceneUniforms.uBhPos.value.copy(bhPos);
  sceneUniforms.uBhRs.value = R * 1.8;
  sceneUniforms.uDiskInner.value = 3.0;
  sceneUniforms.uDiskOuter.value = 14.0;
  sceneUniforms.uDiskNormal.value.set(0.06, 1.0, 0.12).normalize();
  sceneUniforms.uBhActive.value = state.bhActive;

  _vTarget.copy(bhPos).sub(camera.position).normalize();
  sceneUniforms.uBhDir.value.copy(_vTarget);

  postUniforms.uTime.value = state.time;
  postUniforms.uWarp.value = state.warp;
  postUniforms.uFlash.value = state.flash;
  postUniforms.uInside.value = state.inside;
  postUniforms.uChroma.value = state.params.chroma;
  postUniforms.uExposure.value = state.params.exposure;
}

let lastTimestamp = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let qualityReduced = false;
let paused = false;

function animate(now) {
  requestAnimationFrame(animate);
  if (paused) {
    lastTimestamp = now;
    return;
  }
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTimestamp) / 1000));
  lastTimestamp = now;
  state.time += dt;
  if (state.started) state.missionElapsed += dt;

  updateJourney(dt);
  updateCamera(dt, state.time);
  updatePhysics(dt);
  updateStageAndProgress(dt);

  state.bhActive = damp(
    state.bhActive,
    state.stage === 3 && state.inside < 0.25 ? 1 : 0,
    1.6,
    dt
  );

  sceneUniforms.uBhIntensity.value = damp(
    sceneUniforms.uBhIntensity.value,
    state.stage === 3 ? 0.95 : state.stage === 2 ? 0.35 : 0.6,
    1.2,
    dt
  );

  updateUniforms();

  if (state.audioReady) {
    audio.update({
      dt,
      stage: state.stage,
      inside: state.inside,
      warp: state.warp,
      boost: state.boost,
      brake: state.brake,
      speed: state.speed,
    });
  }

  hudAccum += dt;
  if (hudAccum >= HUD_INTERVAL) {
    hudAccum = 0;
    if (state.started) updateHUD();
  }

  // 开场时也给出轻微罗盘/雷达动态
  if (!state.started) {
    const t = state.time;
    $('radarPulse').setAttribute('cx', (128 + Math.sin(t * 0.65) * 34).toFixed(1));
    $('radarPulse').setAttribute('cy', (44 + Math.cos(t * 0.9) * 12).toFixed(1));
  }

  // 渲染：场景 -> HDR RT -> 后期 -> Canvas
  renderer.setRenderTarget(renderTarget);
  sceneMesh.visible = true;
  renderer.render(fullscreenScene, fullscreenCamera);

  renderer.setRenderTarget(null);
  sceneMesh.visible = false;
  renderer.render(postScene, fullscreenCamera);

  // 简单自适应降采样
  fpsAccum += dt;
  fpsFrames += 1;
  if (fpsFrames >= 90) {
    const avg = fpsAccum / fpsFrames;
    if (!qualityReduced && avg > 0.042 && resolutionScale > 0.66) {
      qualityReduced = true;
      resolutionScale = Math.max(0.66, resolutionScale - 0.22);
      resize();
      showToast('检测到 GPU 负载较高 · 已自动优化渲染分辨率', 2600);
    }
    fpsAccum = 0;
    fpsFrames = 0;
  }
}

/* ============================================================
   启动
   ============================================================ */

function boot() {
  resize();
  buildCompass();
  updateParamsDisplays();
  bindUI();

  // 初始镜头
  updateCamera(0.016, 0);
  updatePhysics(0.016);
  updateUniforms();

  // 构建初始阶段 UI
  document.querySelectorAll('.stage-item').forEach((el) => {
    const s = Number(el.dataset.stage);
    el.classList.toggle('is-active', s === 1);
    el.classList.toggle('is-done', false);
  });

  $('subtitleText').textContent = SUBTITLES[1][0];
  lastTimestamp = performance.now();
  requestAnimationFrame(animate);

  // 调试 / 自动化接口（不影响正常体验）
  window.__wormhole = {
    start: () => beginJourney(false),
    jump: (value) => {
      state.started = true;
      state.auto = true;
      state.autoBlend = 1;
      const v = clamp(Number(value) || 0, 0, 1);
      state.journey = v;
      state.journeyPlaying = false;
      state.journeyFinished = v >= 1;
      const targetStage = v < PHASE_ONE_END ? 1 : v < PHASE_TWO_END ? 2 : 3;
      state.stage = targetStage;
      state.inside = 0;
      state.autoBlend = 1;
      $('intro').classList.add('is-hidden');
      $('hud').classList.remove('is-hidden');
      setStage(targetStage, true);
    },
    pause: () => { paused = true; },
    resume: () => { paused = false; lastTimestamp = performance.now(); },
    snapshot: () => ({
      journey: state.journey,
      stage: state.stage,
      inside: state.inside,
      warp: state.warp,
      camera: camera.position.toArray(),
      fov: camera.fov,
      audioReady: state.audioReady,
      pixelRatio: renderer.getPixelRatio(),
      renderSize: [renderTarget.width, renderTarget.height],
    }),
    state,
    input,
    renderer,
    camera,
    audio,
    sceneUniforms,
    postUniforms,
  };

  // 隐藏首屏加载状态（无 loading 层，仅确保画布已就绪）
  console.info('[interstellar] 虫洞引擎已就绪');
}

boot();
