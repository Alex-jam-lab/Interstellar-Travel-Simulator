/**
 * 米勒星 · 着陆任务
 * ------------------------------------------------------------------
 * Three.js 实时场景：
 *  - 程序化浅海 + 潮汐波 + 巨型波前
 *  - 阴云天空 + Gargantua 黑洞
 *  - 真实下降物理（重力 / 推力 / 垂直速度 / 接触判定）
 *  - 自动降落控制律 + 手动油门 / 姿态控制
 *  - 不依赖任何外部贴图或音频文件
 */

import * as THREE from 'three';
import './style.css';
import './miller.css';

/* ============================================================
   工具
   ============================================================ */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const lerp = (a, b, t) => a + (b - a) * t;

const GRAVITY = 7.6;
const MAX_THRUST = 19.0;
const GEAR_HEIGHT = 5.6;
const START_HEIGHT = 1600;
const BH_DIR = new THREE.Vector3(0.22, 0.13, -1.0).normalize();
const BH_SCALE = 0.155;
const DILATION = 61320; // 1 local hour = 61320 Earth hours = 7 years

/* ============================================================
   渲染器 / 相机
   ============================================================ */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.setClearColor(0x0a1114, 1);
$('m-stage').appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x748286, 0.000040);

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.5, 30000);
camera.position.set(0, 1640, 70);

/* 灯光：Gargantua 的暖光 + 阴天环境光 */
const hemi = new THREE.HemisphereLight(0x9fb4bd, 0x1b2b2e, 1.15);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffd3a0, 2.0);
keyLight.position.set(-500, 400, -800);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9dd7ff, 0.65);
fillLight.position.set(400, 180, 500);
scene.add(fillLight);

/* ============================================================
   天空 / Gargantua
   ============================================================ */

const skyUniforms = {
  uTime: { value: 0 },
  uBhDir: { value: BH_DIR.clone() },
  uBhScale: { value: BH_SCALE },
};

const skyMaterial = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec3 vDir;

    uniform float uTime;
    uniform vec3 uBhDir;
    uniform float uBhScale;

    #include <common>

    float hash31(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float noise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i);
      float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
      return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
      );
    }

    float fbm3(vec3 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        s += a * noise3(p);
        p = p * 2.03 + vec3(11.2, 7.4, 3.1);
        a *= 0.5;
      }
      return s / 0.875;
    }

    vec3 gargantua(vec3 d, out float occl) {
      occl = 0.0;
      vec3 c = normalize(uBhDir);
      float ca = dot(d, c);
      if (ca < 0.5) return vec3(0.0);

      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), c));
      vec3 up = normalize(cross(c, right));
      vec2 q = vec2(dot(d, right), dot(d, up)) / uBhScale;
      float r = length(q);
      float t = uTime;

      float shadow = 1.0 - smoothstep(0.9, 1.08, r);
      float edge = smoothstep(0.5, 0.6, ca);
      occl = shadow * edge;

      // 吸积盘
      float bandY = q.y - 0.035 * sin(q.x * 0.6 + t * 0.2);
      float band = exp(-pow(bandY / (0.07 + 0.02 * abs(q.x)), 2.0));
      float radial = (1.0 - smoothstep(1.05, 7.0, abs(q.x))) * smoothstep(0.98, 1.14, r);
      float turb = 0.55 + 0.45 * sin(q.x * 2.2 + sin(q.x * 1.2 + t * 0.35) * 2.0 + t * 0.2);
      float doppler = mix(0.36, 1.8, 1.0 - smoothstep(-3.5, 0.8, q.x));
      vec3 diskCol = mix(vec3(0.92, 0.18, 0.015), vec3(1.0, 0.82, 0.48), smoothstep(1.0, 3.5, r));
      vec3 col = band * radial * turb * doppler * diskCol * 1.35;

      // 光子环 + 二次透镜弧 + 外晕
      col += exp(-pow((r - 1.0) / 0.015, 2.0)) * vec3(1.5, 1.25, 0.95) * 1.3;
      col += exp(-pow((r - 1.32) / 0.06, 2.0)) * vec3(1.0, 0.48, 0.13) * 0.42;
      col += exp(-r * 0.62) * vec3(0.22, 0.085, 0.025) * 0.3;

      // 视界内部不保留外晕，保证阴影是真正的黑色
      col *= (1.0 - shadow * 0.92);
      return col * edge;
    }

    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -1.0, 1.0);

      // 阴天 / 风暴天空
      vec3 topCol = vec3(0.025, 0.040, 0.048);
      vec3 horCol = vec3(0.16, 0.18, 0.18);
      vec3 sky = mix(horCol, topCol, smoothstep(-0.05, 0.82, h));

      vec3 cloudP = d * 3.1 + vec3(uTime * 0.004, 0.0, uTime * 0.003);
      float n = fbm3(cloudP);
      float n2 = fbm3(cloudP * 2.0 + vec3(6.0, 2.0, 1.0));
      float clouds = smoothstep(0.33, 0.82, n * 0.75 + n2 * 0.25);
      vec3 cloudCol = mix(vec3(0.05, 0.06, 0.065), vec3(0.2, 0.21, 0.21), smoothstep(0.3, 0.9, n));
      sky = mix(sky, cloudCol, clouds * (0.32 + 0.34 * smoothstep(0.0, 0.9, h)));

      // 接近 Gargantua 的天空辉光
      vec3 c = normalize(uBhDir);
      float ca = max(dot(d, c), 0.0);
      sky += vec3(0.42, 0.19, 0.06) * pow(ca, 180.0) * 0.55;
      sky += vec3(0.16, 0.075, 0.03) * pow(ca, 12.0) * 0.08;

      float occl = 0.0;
      vec3 bh = gargantua(d, occl);
      sky = sky * (1.0 - occl) + bh;

      // 海平线雾
      sky = mix(vec3(0.215, 0.225, 0.22), sky, smoothstep(-0.07, 0.14, h));

      gl_FragColor = vec4(sky, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 48, 24), skyMaterial);
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

/* ============================================================
   海洋 / 潮汐波
   ============================================================ */

const oceanUniforms = {
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uBhDir: { value: BH_DIR.clone() },
  uFogColor: { value: new THREE.Color(0x748286) },
  uFogDensity: { value: 0.000040 },
  uSplashPos: { value: new THREE.Vector3() },
  uSplashAge: { value: 0 },
  uWaveFront: { value: -2600 },
};

const oceanMaterial = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  groundColor: new THREE.Color(0x1c292b),
  vertexShader: /* glsl */ `
    precision highp float;

    uniform float uTime;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vHeight;

    #include <common>

    float waveHeight(vec2 p) {
      float h = 0.0;
      h += sin(dot(p, vec2(0.028, 0.012)) - uTime * 0.55) * 2.4;
      h += sin(dot(p, vec2(-0.013, 0.031)) + uTime * 0.80) * 1.25;
      h += sin(dot(p, vec2(0.009, -0.047)) - uTime * 1.30) * 0.5;
      h += sin(dot(p, vec2(0.0016, 0.0011)) - uTime * 0.08) * 7.5;

      // 巨大的潮汐波前，从 -z 向 +z 缓慢推进
      float front = -1200.0 + mod(uTime * 2.2, 12000.0);
      float d = p.y - front;
      h += exp(-pow(d / 460.0, 2.0)) * 260.0;
      return h;
    }

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float h = waveHeight(wp.xz);
      wp.y += h;

      float e = 18.0;
      float hx = waveHeight(wp.xz + vec2(e, 0.0)) - waveHeight(wp.xz - vec2(e, 0.0));
      float hz = waveHeight(wp.xz + vec2(0.0, e)) - waveHeight(wp.xz - vec2(0.0, e));
      vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

      vWorldPos = wp.xyz;
      vHeight = h;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uTime;
    uniform vec3 uCamPos;
    uniform vec3 uBhDir;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec3 uSplashPos;
    uniform float uSplashAge;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vHeight;

    #include <common>

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
        mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm2(vec2 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        s += a * noise2(p);
        p = p * 2.07 + vec2(9.3, 4.7);
        a *= 0.5;
      }
      return s / 0.875;
    }

    vec3 skyReflect(vec3 d) {
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(vec3(0.18, 0.2, 0.2), vec3(0.035, 0.052, 0.06), smoothstep(0.0, 0.8, h));
      float n = fbm2(vec2(d.x, d.z) * 4.0 + vec2(uTime * 0.01, 0.0));
      col += vec3(0.07, 0.08, 0.08) * smoothstep(0.38, 0.8, n);
      float g = pow(max(dot(normalize(d), normalize(uBhDir)), 0.0), 90.0);
      col += vec3(0.55, 0.24, 0.07) * g * 0.55;
      return col;
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(uCamPos - vWorldPos);
      vec3 R = reflect(-V, N);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

      vec3 refl = skyReflect(R);
      vec3 deep = vec3(0.006, 0.020, 0.026);
      vec3 shallow = vec3(0.075, 0.105, 0.1);
      vec3 water = mix(deep, shallow, 0.28 + 0.24 * smoothstep(-2.0, 12.0, vHeight));
      vec3 col = mix(water, refl, 0.22 + fres * 0.76);

      // 巨型潮汐波：深色波面 + 白色波峰，让它从灰色天空里分离出来
      float giantMask = smoothstep(28.0, 95.0, vHeight);
      col = mix(col, vec3(0.008, 0.023, 0.028), giantMask * 0.78);

      // 波峰白沫
      float noiseA = fbm2(vWorldPos.xz * 0.055 + vec2(uTime * 0.025, 0.0));
      float crest = smoothstep(4.0, 12.5, vHeight);
      float foam = crest * (0.3 + 0.7 * noiseA);
      foam *= mix(1.0, 0.32, giantMask);
      foam += smoothstep(248.0, 285.0, vHeight) * 0.85;
      foam = clamp(foam + smoothstep(0.72, 0.9, noiseA) * smoothstep(0.0, 2.0, vHeight) * 0.35, 0.0, 1.0);
      col = mix(col, vec3(0.72, 0.76, 0.75), foam * 0.75);

      // Gargantua 方向的镜面反光
      vec3 lightDir = normalize(vec3(0.15, 0.22, -1.0));
      float spec = pow(max(dot(R, normalize(lightDir + V)), 0.0), 90.0);
      col += vec3(0.8, 0.5, 0.22) * spec * 0.45;

      // 着陆溅起的同心涟漪
      if (uSplashAge > 0.0) {
        float dist = length(vWorldPos.xz - uSplashPos.xz);
        float age = uSplashAge;
        float radius = age * 21.0;
        float ring = exp(-pow((dist - radius) / 6.0, 2.0)) * exp(-age * 0.55);
        float ring2 = exp(-pow((dist - radius * 0.62) / 4.0, 2.0)) * exp(-age * 0.8);
        col = mix(col, vec3(0.82, 0.88, 0.87), clamp(ring + ring2 * 0.65, 0.0, 0.9));
      }

      // 海面雾
      float distCam = length(vWorldPos - uCamPos);
      float fog = 1.0 - exp(-uFogDensity * distCam);
      col = mix(col, uFogColor * 0.9, fog);

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

const oceanGeometry = new THREE.PlaneGeometry(32000, 32000, 280, 280);
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI / 2;
ocean.frustumCulled = false;
ocean.position.y = 0;
scene.add(ocean);

/* JS 侧波高，用于着陆接触判定（与 GLSL 保持近似一致） */
function waveHeightAt(x, z, t) {
  let h = 0;
  h += Math.sin(x * 0.028 + z * 0.012 - t * 0.55) * 2.4;
  h += Math.sin(x * -0.013 + z * 0.031 + t * 0.8) * 1.25;
  h += Math.sin(x * 0.009 + z * -0.047 - t * 1.3) * 0.5;
  h += Math.sin(x * 0.0016 + z * 0.0011 - t * 0.08) * 7.5;
  const front = -1200 + ((t * 2.2) % 12000);
  const d = z - front;
  h += Math.exp(-Math.pow(d / 460, 2)) * 260;
  return h;
}

function waveFrontDistance(z, t) {
  const front = -1200 + ((t * 2.2) % 12000);
  return Math.abs(front - z);
}

/* ============================================================
   游骑兵号着陆器
   ============================================================ */

function buildLander() {
  const group = new THREE.Group();

  const white = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, metalness: 0.35, roughness: 0.46 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121a1c, metalness: 0.55, roughness: 0.34 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xc56d2e, metalness: 0.3, roughness: 0.55 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.9, 5.0, 8, 18), white);
  body.position.y = 0.4;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 2.4, 18), dark);
  belly.position.y = -2.1;
  group.add(belly);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), dark);
  cockpit.scale.set(1.0, 0.68, 0.55);
  cockpit.position.set(0, 1.05, -2.5);
  group.add(cockpit);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 3.0), orange);
  stripe.position.set(2.05, 0.4, -0.4);
  group.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.position.x = -2.05;
  group.add(stripe2);

  // 四个着陆腿
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI * 0.25 + i * Math.PI * 0.5;
    const sx = Math.sin(angle) * 2.7;
    const sz = Math.cos(angle) * 2.7;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 5.0, 8), dark);
    leg.position.set(sx, -3.1, sz);
    leg.rotation.z = -Math.sin(angle) * 0.38;
    leg.rotation.x = Math.cos(angle) * 0.38;
    group.add(leg);

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.25, 12), white);
    foot.position.set(sx * 1.55, -5.55, sz * 1.55);
    group.add(foot);
  }

  // 引擎喷口与冷光
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.0, 1.3, 16), dark);
  engine.position.y = -4.25;
  group.add(engine);

  const engineGlow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), glow);
  engineGlow.rotation.x = Math.PI / 2;
  engineGlow.position.y = -4.95;
  group.add(engineGlow);

  const engineLight = new THREE.PointLight(0x7fd2ff, 2.4, 35, 2);
  engineLight.position.y = -4.6;
  group.add(engineLight);

  // 天线
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), white);
  antenna.position.set(0.8, 3.6, 0.3);
  group.add(antenna);

  group.userData.engineGlow = engineGlow;
  group.userData.engineLight = engineLight;
  return group;
}

const lander = buildLander();
scene.add(lander);

/* ============================================================
   溅落粒子
   ============================================================ */

const splashCount = 220;
const splashGeom = new THREE.BufferGeometry();
const splashPos = new Float32Array(splashCount * 3);
const splashVel = new Float32Array(splashCount * 3);
splashGeom.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
function makeSplashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(225,245,255,0.9)');
  grad.addColorStop(0.7, 'rgba(190,220,230,0.25)');
  grad.addColorStop(1.0, 'rgba(190,220,230,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const splashMat = new THREE.PointsMaterial({
  color: 0xd7e8e8,
  size: 0.62,
  map: makeSplashTexture(),
  transparent: true,
  opacity: 0.9,
  alphaTest: 0.01,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const splashPoints = new THREE.Points(splashGeom, splashMat);
splashPoints.frustumCulled = false;
scene.add(splashPoints);
let splashParticlesLife = 0;

function spawnSplash(worldPos) {
  for (let i = 0; i < splashCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 2.5 + Math.random() * 18;
    splashPos[i * 3] = worldPos.x + Math.cos(a) * Math.random() * 3.0;
    splashPos[i * 3 + 1] = worldPos.y + 0.8;
    splashPos[i * 3 + 2] = worldPos.z + Math.sin(a) * Math.random() * 3.0;
    splashVel[i * 3] = Math.cos(a) * speed;
    splashVel[i * 3 + 1] = 5.0 + Math.random() * 22;
    splashVel[i * 3 + 2] = Math.sin(a) * speed;
  }
  splashGeom.attributes.position.needsUpdate = true;
  splashParticlesLife = 1.0;
  splashMat.opacity = 0.8;
}

function updateSplashParticles(dt) {
  if (splashParticlesLife <= 0) return;
  splashParticlesLife -= dt * 0.5;
  for (let i = 0; i < splashCount; i++) {
    splashVel[i * 3 + 1] -= 16 * dt;
    splashPos[i * 3] += splashVel[i * 3] * dt;
    splashPos[i * 3 + 1] += splashVel[i * 3 + 1] * dt;
    splashPos[i * 3 + 2] += splashVel[i * 3 + 2] * dt;
    if (splashPos[i * 3 + 1] < 0) splashPos[i * 3 + 1] = 0;
  }
  splashGeom.attributes.position.needsUpdate = true;
  splashMat.opacity = clamp(splashParticlesLife, 0, 0.95);
  if (splashParticlesLife <= 0) splashMat.opacity = 0;
}

/* ============================================================
   任务状态
   ============================================================ */

const state = {
  started: false,
  landed: false,
  landedHard: false,
  auto: true,
  height: START_HEIGHT,
  vy: -8,
  throttle: 0.42,
  yaw: 0,
  pitch: 0,
  roll: 0,
  attitude: { pitch: 0, roll: 0 },
  localTime: 0,
  worldTime: 0,
  splashAge: 0,
  splashPos: new THREE.Vector3(),
  toastTimer: 0,
  warnTimer: 0,
  landedTimer: 0,
  showLandedAt: 0,
  muted: false,
  gear: true,
  hardLimit: 11.0,
  impactSpeed: 0,
};

const keys = new Set();

/* ============================================================
   音频
   ============================================================ */

class MillerAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = 0.65;
  }

  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.8;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(this.ctx.destination);

    const sr = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(2, Math.floor(sr * 3), sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.noise.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const white = Math.random() * 2 - 1;
        last = 0.98 * last + 0.02 * white;
        d[i] = last * 3.0;
      }
    }

    this.wind = this.ctx.createBufferSource();
    this.wind.buffer = this.noise;
    this.wind.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 520;
    this.windFilter.Q.value = 0.55;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.1;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();

    this.rumble = this.ctx.createBufferSource();
    this.rumble.buffer = this.noise;
    this.rumble.loop = true;
    this.rumbleFilter = this.ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 130;
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0.16;
    this.rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    this.rumble.start();

    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 58;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 380;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.03;
    this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engine.start();

    this.ready = true;
    await this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(m ? 0 : this.volume * 0.8, now, 0.1);
  }

  update({ throttle, height, vy, landed }) {
    if (!this.ready || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime;
    const near = clamp(1 - height / 1600, 0, 1);
    const speed = clamp(Math.abs(vy) / 40, 0, 1);
    this.windGain.gain.setTargetAtTime(0.07 + 0.1 * near + 0.05 * speed, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(380 + near * 500 + speed * 900, t, 0.25);
    this.rumbleGain.gain.setTargetAtTime(landed ? 0.2 : 0.12 + speed * 0.08, t, 0.4);
    this.engineGain.gain.setTargetAtTime(landed ? 0.02 : 0.025 + throttle * 0.11, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 700, t, 0.12);
    this.engine.frequency.setTargetAtTime(52 + throttle * 30, t, 0.2);
  }

  splash() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.48, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2.2);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(70, t);
    thud.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    thud.connect(tg).connect(this.master);
    thud.start(t);
    thud.stop(t + 1.5);
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }
}

const audio = new MillerAudio();

/* ============================================================
   界面辅助
   ============================================================ */

function showToast(text, duration = 2600) {
  const el = $('m-toast');
  el.textContent = text;
  el.classList.add('is-visible');
  state.toastTimer = duration / 1000;
}

function formatInt(n) {
  return Math.max(0, Math.round(n)).toString().padStart(4, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatSigned(v, digits = 1) {
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`;
}

function formatEarthTime(localSeconds) {
  const earthHours = localSeconds * DILATION / 3600;
  const years = Math.floor(earthHours / (365.25 * 24));
  const days = Math.floor((earthHours - years * 365.25 * 24) / 24);
  const hours = Math.floor(earthHours - years * 365.25 * 24 - days * 24);
  return { years, days, hours, earthHours };
}

function formatEarthString(localSeconds) {
  const t = formatEarthTime(localSeconds);
  return `+ ${t.years} 年 ${t.days} 天 ${String(t.hours).padStart(2, '0')} 时`;
}

/* ============================================================
   相机
   ============================================================ */

const tmpForward = new THREE.Vector3();
const tmpDesired = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpSplash = new THREE.Vector3();

function updateWorldTransform() {
  const water = waveHeightAt(0, 0, state.worldTime);
  lander.position.set(0, water + state.height + GEAR_HEIGHT, 0);
  lander.rotation.set(state.attitude.pitch, state.yaw, state.attitude.roll, 'YXZ');
}

function updateCamera(dt, snap = false) {
  tmpForward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));

  // 相机跟随：位于着陆器后上方，视线投向海平线
  tmpDesired.copy(lander.position);
  tmpDesired.x -= tmpForward.x * 52;
  tmpDesired.z -= tmpForward.z * 52;
  tmpDesired.y += 20;

  const k = snap ? 1 : 1 - Math.exp(-dt * 4.2);
  camera.position.lerp(tmpDesired, k);

  tmpLook.copy(lander.position);
  tmpLook.x += tmpForward.x * 300;
  tmpLook.z += tmpForward.z * 300;
  tmpLook.y += 48;

  if (state.splashAge > 0 && state.splashAge < 1.2) {
    camera.position.x += (Math.random() - 0.5) * 0.5;
    camera.position.y += (Math.random() - 0.5) * 0.35;
  }

  camera.lookAt(tmpLook);
}

/* ============================================================
   物理 / 自动降落
   ============================================================ */

function toggleMode(auto) {
  state.auto = auto;
  $('m-auto-btn').classList.toggle('is-active', auto);
  $('m-manual-btn').classList.toggle('is-active', !auto);
  $('m-mode-label').textContent = auto ? 'AUTO DESCENT' : 'MANUAL CONTROL';
  $('m-land-btn').querySelector('span').textContent = auto ? '自动降落' : '接管自动';
  showToast(auto ? '自动降落已接管 · 正在计算下降剖面' : '手动驾驶已接管 · Shift 上升 / Space 下降');
}

function resetMission(auto = true) {
  state.started = true;
  state.landed = false;
  state.landedHard = false;
  state.auto = auto;
  state.height = START_HEIGHT;
  state.vy = -8;
  state.throttle = 0.42;
  state.yaw = 0;
  state.pitch = 0;
  state.roll = 0;
  state.attitude.pitch = 0;
  state.attitude.roll = 0;
  state.localTime = 0;
  state.splashAge = 0;
  state.splashPos.set(0, 0, 0);
  state.landedTimer = 0;
  state.showLandedAt = 0;
  state.impactSpeed = 0;
  $('m-landed').classList.add('is-hidden');
  $('m-intro').classList.add('is-hidden');
  $('m-hud').classList.remove('is-hidden');
  $('m-warning').classList.remove('is-visible');
  $('m-wave-banner').classList.remove('is-visible');
  lander.userData.engineGlow.visible = true;
  lander.userData.engineLight.intensity = 2.4;
  $('m-touchdown-state').textContent = '等待接触海面';
  toggleMode(auto);
  updateWorldTransform();
  updateCamera(0.016, true);
  audio.resume();
  showToast('下降程序启动 · 目标：米勒星海面');
}

function startMission(auto = true) {
  resetMission(auto);
}

function finishLanding() {
  if (state.landed) return;
  state.landed = true;
  state.landedHard = state.vy < -10.0;
  state.impactSpeed = Math.abs(state.vy);
  state.height = 0;
  state.vy = 0;
  state.throttle = 0;
  state.landedTimer = 0;
  state.showLandedAt = 1.2;
  state.splashAge = 0.001;
  state.splashPos.set(0, waveHeightAt(0, 0, state.worldTime), 0);

  lander.userData.engineGlow.visible = false;
  lander.userData.engineLight.intensity = 0;
  $('m-touchdown-state').textContent = state.landedHard ? '硬着陆 · 船体受损' : '接触确认 · 软着陆';

  spawnSplash(new THREE.Vector3(0, waveHeightAt(0, 0, state.worldTime), 0));
  audio.splash();
  showToast(state.landedHard ? '着陆冲击过大 · 船体受损' : '接触海面 · 起落架锁定', 3600);
}

function updatePhysics(dt) {
  if (!state.started) return;
  state.localTime += dt;

  if (state.landed) {
    // 已着陆：随波轻微起伏，等待用户重来
    state.landedTimer += dt;
    if (state.landedTimer >= state.showLandedAt && state.showLandedAt > 0) {
      state.showLandedAt = 0;
      showLandedOverlay();
    }
    return;
  }

  if (state.auto) {
    let vTarget;
    if (state.height > 500) vTarget = -48;
    else if (state.height > 140) vTarget = -24;
    else if (state.height > 32) vTarget = -8.5;
    else if (state.height > 4) vTarget = -2.0;
    else vTarget = -0.7;

    const desiredAccel = (vTarget - state.vy) * 2.4;
    const wantedThrottle = clamp((GRAVITY + desiredAccel) / MAX_THRUST, 0, 1);
    state.throttle = damp(state.throttle, wantedThrottle, 3.5, dt);
    state.attitude.pitch = damp(state.attitude.pitch, 0.03, 1.4, dt);
    state.attitude.roll = damp(state.attitude.roll, 0, 1.4, dt);
  } else {
    const hover = GRAVITY / MAX_THRUST;
    let target = hover;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) target += 0.5;
    if (keys.has('Space')) target -= 0.58;
    state.throttle = damp(state.throttle, clamp(target, 0, 1), 3.2, dt);
  }

  // 垂直推进 + 重力
  const accel = state.throttle * MAX_THRUST - GRAVITY;
  state.vy += accel * dt;
  state.height += state.vy * dt;

  // 姿态（视觉与手动操控）
  if (!state.auto) {
    const pitchInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const yawInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    const rollInput = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
    state.attitude.pitch = clamp(state.attitude.pitch + pitchInput * 0.55 * dt, -0.55, 0.55);
    state.attitude.roll = clamp(state.attitude.roll + rollInput * 0.65 * dt, -0.7, 0.7);
    state.yaw += yawInput * 0.4 * dt;
  }

  if (state.height <= 0.05) {
    state.height = 0;
    finishLanding();
  }

  if (!state.landed) {
    const water = waveHeightAt(0, 0, state.worldTime);
    lander.position.set(0, water + state.height + GEAR_HEIGHT, 0);
    lander.rotation.set(state.attitude.pitch, state.yaw, state.attitude.roll, 'YXZ');
  }
}

function showLandedOverlay() {
  const t = formatEarthTime(state.localTime);
  $('m-landed-title').textContent = state.landedHard ? '米勒星 · 硬着陆' : '米勒星 · 已着陆';
  $('m-landed-desc').textContent = state.landedHard
    ? '起落架承受了过大的冲击。船体仍有部分系统在线，但这次着陆并不完美。'
    : '游骑兵号稳稳停在浅海表面。潮汐波仍在远方翻涌，Gargantua 悬挂在阴云之后。';
  $('m-landed-local').textContent = `${String(Math.floor(state.localTime / 60)).padStart(2, '0')}:${String(Math.floor(state.localTime % 60)).padStart(2, '0')}`;
  $('m-landed-earth').textContent = `${t.years} 年 ${t.days} 天`;
  $('m-landed-speed').textContent = `-${state.impactSpeed.toFixed(1)} m/s`;
  $('m-landed').classList.remove('is-hidden');
}

/* ============================================================
   HUD
   ============================================================ */

function buildAltTape() {
  const holder = $('m-alt-marks');
  holder.innerHTML = '';
  for (let i = 0; i <= 20; i++) {
    const el = document.createElement('span');
    el.style.top = `${i * 5}%`;
    if (i % 2 === 0) {
      el.classList.add('major');
      if (i % 4 === 0) {
        el.classList.add('label');
        el.textContent = (2000 - i * 100).toString();
      }
    }
    holder.appendChild(el);
  }
}

let hudAcc = 0;
function updateHUD(dt) {
  hudAcc += dt;
  const t = state.worldTime;
  const earth = formatEarthTime(state.localTime);
  const wave = waveHeightAt(0, 0, t);
  const altitude = Math.max(0, state.height);

  $('m-altitude').textContent = formatInt(altitude);
  $('m-alt-tape').textContent = formatInt(altitude);
  $('m-vsi').innerHTML = `${formatSigned(state.vy)} <i>m/s</i>`;
  $('m-wave').innerHTML = `${(Math.abs(wave) + 8).toFixed(1)} <i>m</i>`;
  $('m-earth-years').textContent = (earth.earthHours / (365.25 * 24)).toFixed(3);
  $('m-throttle-bar').style.width = `${(state.throttle * 100).toFixed(1)}%`;
  $('m-throttle-value').textContent = `${Math.round(state.throttle * 100)}%`;
  const clockText = `${String(Math.floor(state.localTime / 3600)).padStart(2, '0')}:${String(Math.floor((state.localTime % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(state.localTime % 60)).padStart(2, '0')}`;
  $('m-local-clock').textContent = clockText;
  $('m-mobile-alt').textContent = formatInt(altitude);
  $('m-mobile-vsi').textContent = formatSigned(state.vy, 1);
  $('m-mobile-time').textContent = clockText;
  $('m-mobile-earth').textContent = `${earth.years} 年 ${earth.days} 天`;
  $('m-earth-elapsed').textContent = formatEarthString(state.localTime);
  $('m-vsi-bar').style.width = `${clamp(Math.abs(state.vy) / 50 * 100, 3, 100)}%`;
  $('m-gear').textContent = state.gear ? '已展开' : '收起';
  $('m-thruster-state').textContent = state.landed ? '关闭' : state.throttle > 0.1 ? '工作' : '待命';

  const descVector = $('m-descent-vector');
  if (descVector) {
    const len = clamp(Math.abs(state.vy) * 1.8, 0, 58);
    descVector.setAttribute('d', `M110 110 l0 ${len}`);
  }

  const modeText = state.auto ? '自动下降' : '手动控制';
  $('m-mode-label').textContent = state.auto ? 'AUTO DESCENT' : 'MANUAL CONTROL';
  $('m-phase').textContent = state.landed
    ? (state.landedHard ? 'HARD LANDING / 硬着陆' : 'TOUCHDOWN / 已着陆')
    : (state.auto ? 'AUTO DESCENT / 自动下降' : 'MANUAL DESCENT / 手动下降');

  const warn = $('m-warning');
  if (!state.landed && state.vy < -14 && state.height < 260) {
    warn.classList.add('is-visible');
    $('m-warning-text').textContent = state.auto ? '自动程序正在拉平 · 请保持稳定' : '下降率过高 · 增加上升推力';
  } else {
    warn.classList.remove('is-visible');
  }

  const waveBanner = $('m-wave-banner');
  if (!state.landed && state.height < 220) {
    waveBanner.classList.add('is-visible');
    $('m-wave-banner').querySelector('b').textContent = `波前 ${(waveFrontDistance(0, t) / 1000).toFixed(1)} km · 保持推力`;
  } else {
    waveBanner.classList.remove('is-visible');
  }

  // 潮汐扫描曲线
  if (Math.floor(t * 3) !== Math.floor((t - dt) * 3)) {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const x = (i / 20) * 260;
      const y = 68 - Math.sin(i * 0.55 + t * 0.9) * 8 - Math.cos(i * 0.24 + t * 0.4) * 4;
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    $('m-wave-line').setAttribute('d', points.join(' '));
    $('m-wave-line2').setAttribute('d', points.map((p, i) => {
      const x = (i / 20) * 260;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(80 - Math.sin(i * 0.38 + t * 0.55) * 5).toFixed(1)}`;
    }).join(' '));
    $('m-wave-distance').textContent = `${(waveFrontDistance(0, t) / 1000).toFixed(1)} km`;
    $('m-wave-dot').setAttribute('cx', (220 - (t * 6) % 180).toFixed(1));
  }

  if (state.toastTimer > 0) {
    state.toastTimer -= dt;
    if (state.toastTimer <= 0) $('m-toast').classList.remove('is-visible');
  }
}

/* ============================================================
   输入 / 界面绑定
   ============================================================ */

function bindUI() {
  $('m-start-auto').addEventListener('click', async () => {
    try {
      await audio.init();
    } catch (error) {
      console.warn('[miller] 音频初始化失败', error);
    }
    startMission(true);
  });
  $('m-start-manual').addEventListener('click', async () => {
    try {
      await audio.init();
    } catch (error) {
      console.warn('[miller] 音频初始化失败', error);
    }
    startMission(false);
  });

  $('m-auto-btn').addEventListener('click', () => {
    if (!state.started) return;
    toggleMode(true);
  });
  $('m-manual-btn').addEventListener('click', () => {
    if (!state.started) return;
    toggleMode(false);
  });

  $('m-land-btn').addEventListener('click', () => {
    if (!state.started || state.landed) return;
    toggleMode(true);
    showToast('自动降落接管 · 正在收敛到着陆剖面');
  });

  $('m-reset-btn').addEventListener('click', () => {
    if (!state.started) return;
    resetMission(state.auto);
  });

  $('m-retry').addEventListener('click', () => {
    resetMission(true);
  });

  $('m-audio').addEventListener('click', () => {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    $('m-audio').classList.toggle('is-muted', state.muted);
    showToast(state.muted ? '声音已关闭' : '声音已开启');
  });

  window.addEventListener('keydown', (e) => {
    if (!state.started || state.landed) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code.startsWith('Shift')) e.preventDefault();
    keys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code) && state.auto) {
      toggleMode(false);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('visibilitychange', () => {
    if (!audio.ready) return;
    if (document.hidden) audio.ctx.suspend().catch(() => {});
    else audio.resume();
  });
}

/* ============================================================
   启动
   ============================================================ */

let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.worldTime += dt;

  // 天空跟随相机，保持海平线位置稳定
  sky.position.copy(camera.position);

  skyUniforms.uTime.value = state.worldTime;
  const front = -2600 + ((state.worldTime * 2.2) % 12000);
  oceanUniforms.uTime.value = state.worldTime;
  oceanUniforms.uCamPos.value.copy(camera.position);
  oceanUniforms.uSplashAge.value = state.splashAge;
  oceanUniforms.uSplashPos.value.copy(state.splashPos);

  updatePhysics(dt);
  updateWorldTransform();
  updateCamera(dt);
  updateSplashParticles(dt);

  const enginesVisible = state.started && !state.landed;
  lander.userData.engineGlow.visible = enginesVisible;
  lander.userData.engineLight.intensity = enginesVisible ? 1.2 + state.throttle * 4.0 : 0;
  lander.userData.engineGlow.scale.setScalar(0.6 + state.throttle * 0.7);

  if (state.splashAge > 0) state.splashAge += dt;

  if (state.started) {
    audio.update({
      throttle: state.throttle,
      height: state.height,
      vy: state.vy,
      landed: state.landed,
    });
    updateHUD(dt);
  }

  renderer.render(scene, camera);

  // 极简自适应分辨率：在低性能设备上降一点
  fpsAcc += dt;
  fpsFrames++;
  if (fpsFrames >= 120) {
    if (fpsAcc / fpsFrames > 0.04 && renderer.getPixelRatio() > 0.8) {
      renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() - 0.2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      showToast('已自动降低渲染分辨率');
    }
    fpsAcc = 0;
    fpsFrames = 0;
  }
}

function boot() {
  buildAltTape();
  bindUI();
  updateWorldTransform();
  updateCamera(0.016, true);
  // 初始镜头：展示浅海和远处 Gargantua
  camera.position.set(-18, START_HEIGHT + 24, 74);
  camera.lookAt(0, START_HEIGHT + 4, -320);
  requestAnimationFrame(animate);
  console.info('[miller] 米勒星着陆任务已就绪');

  // 自动化调试接口（不影响正常体验）
  window.__miller = {
    state,
    start: (auto = true) => resetMission(auto),
    setHeight: (h) => { state.height = Math.max(0, Number(h) || 0); state.vy = -1.2; },
    setAuto: (v) => toggleMode(!!v),
    snapshot: () => ({
      started: state.started,
      landed: state.landed,
      height: state.height,
      vy: state.vy,
      throttle: state.throttle,
      localTime: state.localTime,
      auto: state.auto,
      camera: camera.position.toArray(),
    }),
    camera,
    scene,
    renderer,
  };
}

boot();
