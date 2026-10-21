/**
 * 星际穿越 · 虫洞场景着色器
 * ------------------------------------------------------------------
 * 全屏 Fragment Shader：
 *  - 解析法射线-球体求交 + 三次折射，构建“晶体球面虫洞”
 *  - 引力偏折近似（弱场偏折角叠加）采样背景星场
 *  - Raymarching 体渲染四维折叠管道（喉部湍流、辉光、粒子）
 *  - 程序化太阳系 / 巨人座双星系天球
 *  - 程序化 Gargantua 黑洞、吸积盘与光子环
 */

export const sceneVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const sceneFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform mat3  uCamMat;
  uniform float uFov;
  uniform float uThroat;
  uniform float uLens;
  uniform float uChroma;
  uniform float uDust;
  uniform float uExposure;
  uniform float uWarp;
  uniform float uInside;
  uniform float uPhase;
  uniform float uJourney;
  uniform float uFlash;
  uniform vec3  uBhDir;
  uniform float uBhIntensity;

  // Gargantua 世界坐标（第二阶段升级：真实吸积盘 + 事件视界）
  uniform vec3  uBhPos;
  uniform float uBhRs;
  uniform float uDiskInner;
  uniform float uDiskOuter;
  uniform vec3  uDiskNormal;
  uniform float uBhActive;

  #define PI  3.14159265359
  #define TAU 6.28318530718

  /* ---------------- 哈希 / 噪声 ---------------- */

  float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453123);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
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
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += amp * noise3(p);
      p = p * 2.03 + vec3(17.3, 9.2, 4.7);
      amp *= 0.5;
    }
    return sum / 0.875;
  }

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  vec3 rotateToward(vec3 v, vec3 target, float angle) {
    vec3 axis = cross(v, target);
    float s = length(axis);
    if (s < 1e-5) return v;
    axis /= s;
    float c = cos(angle);
    float si = sin(angle);
    return v * c + cross(axis, v) * si + axis * dot(axis, v) * (1.0 - c);
  }

  vec3 rotateAroundAxis(vec3 v, vec3 axis, float angle) {
    vec3 a = normalize(axis + vec3(1e-5));
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
  }

  /* ---------------- 星场 ---------------- */

  float starLayer(vec3 d, vec2 grid, float density, float seed, float glowScale) {
    float u = atan(d.z, d.x) / TAU + 0.5;
    float v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    vec2 p = vec2(u, v) * grid;
    vec2 id = floor(p);
    vec2 f = fract(p);
    float h = hash21(id + seed);
    if (h > density) return 0.0;
    vec2 sp = vec2(
      0.22 + 0.56 * hash21(id + seed + 13.17),
      0.22 + 0.56 * hash21(id + seed + 27.41)
    );
    vec2 dd = (f - sp) * vec2(1.0, 0.72);
    float r2 = dot(dd, dd);
    float core = exp(-r2 * 6200.0 * glowScale);
    float halo = exp(-sqrt(r2) * 108.0 * glowScale) * 0.038;
    float flare = (
      exp(-abs(dd.x) * 130.0 * glowScale) * exp(-abs(dd.y) * 12.0 * glowScale) +
      exp(-abs(dd.y) * 130.0 * glowScale) * exp(-abs(dd.x) * 12.0 * glowScale)
    ) * 0.075;
    float twinkle = 0.82 + 0.18 * sin(uTime * (1.2 + h * 2.4) + h * 51.0);
    return (core + halo + flare) * twinkle * (0.35 + h * 0.85);
  }

  vec3 starField(vec3 d, float strength) {
    float s1 = starLayer(d, vec2(88.0, 44.0), 0.17, 3.1, 1.25);
    float s2 = starLayer(d, vec2(176.0, 88.0), 0.3, 8.7, 0.95);
    float s3 = starLayer(d, vec2(352.0, 176.0), 0.36, 21.3, 0.72);
    float s4 = starLayer(d, vec2(704.0, 352.0), 0.4, 39.9, 0.55);
    vec3 col = vec3(0.0);
    col += s1 * vec3(1.0, 0.84, 0.64) * 1.3;
    col += s2 * vec3(0.64, 0.82, 1.0) * 0.82;
    col += s3 * vec3(0.84, 0.91, 1.0) * 0.58;
    col += s4 * vec3(0.56, 0.74, 1.0) * 0.4;
    return col * strength;
  }

  vec3 screenStars(vec2 fragCoord, float cellSize, float density, float seed, float gain) {
    vec2 p = fragCoord / cellSize;
    vec2 id = floor(p);
    vec2 f = fract(p);
    float h = hash21(id + seed);
    if (h > density) return vec3(0.0);
    vec2 sp = vec2(
      0.24 + 0.52 * hash21(id + seed + 13.7),
      0.24 + 0.52 * hash21(id + seed + 29.1)
    );
    vec2 dd = f - sp;
    float core = exp(-dot(dd, dd) * 58.0);
    float twinkle = 0.78 + 0.22 * sin(uTime * (1.0 + h * 2.8) + h * 37.0);
    vec3 tint = mix(vec3(0.68, 0.82, 1.0), vec3(1.0, 0.84, 0.64), hash21(id + seed + 7.3));
    return tint * core * twinkle * gain;
  }

  /* ---------------- 太阳系天球 ---------------- */

  vec3 solSky(vec3 d, float starAmount) {
    d = normalize(d);
    float t = uTime * 0.004;

    vec3 col = mix(vec3(0.0015, 0.003, 0.009), vec3(0.003, 0.009, 0.03), smoothstep(-0.7, 0.9, d.y));

    // 深蓝 / 金色星云
    float n1 = fbm3(d * 2.15 + vec3(1.7, 0.3, 0.9) + t * 0.5);
    float n2 = fbm3(d * 4.4 + vec3(-2.3, 1.1, 3.7) - t * 0.4);
    float cloud = smoothstep(0.46, 0.8, n1) * (0.25 + 0.75 * n2);
    vec3 blueNeb = vec3(0.01, 0.062, 0.18);
    vec3 goldNeb = vec3(0.34, 0.16, 0.045);
    col += blueNeb * pow(cloud, 1.15) * 1.0;
    col += goldNeb * pow(cloud, 2.5) * 0.52;

    // 银河盘带
    vec3 bandN = normalize(vec3(0.26, 0.88, 0.34));
    float band = exp(-pow(dot(d, bandN) * 3.1, 2.0));
    float dust = fbm3(d * 6.0 + vec3(3.1, -2.0, 1.4));
    float dustMask = smoothstep(0.32, 0.74, dust);
    col += band * (vec3(0.026, 0.05, 0.1) * (0.55 + dustMask) + vec3(0.12, 0.085, 0.04) * pow(dustMask, 2.0) * 0.45);
    col += starField(d, 1.0) * (0.5 + band * 0.85) * starAmount;

    // 一缕暖色星云丝
    float filament = pow(max(0.0, 1.0 - abs(dot(d, normalize(vec3(-0.7, 0.35, 0.62)))) * 3.2), 5.0);
    col += vec3(0.3, 0.13, 0.04) * filament * 0.24;

    return col;
  }

  /* ---------------- 巨人座天球 ---------------- */

  vec3 gargantuaSky(vec3 d, float starAmount) {
    d = normalize(d);
    float t = uTime * 0.005;

    vec3 col = mix(vec3(0.002, 0.0015, 0.008), vec3(0.006, 0.003, 0.02), smoothstep(-0.8, 0.8, d.y));

    // 紫 / 青 / 琥珀异星云
    float n1 = fbm3(d * 2.5 + vec3(-4.2, 1.9, 2.4) + t * 0.6);
    float n2 = fbm3(d * 5.2 + vec3(7.1, -3.3, 0.8) - t * 0.5);
    float cloud = smoothstep(0.44, 0.82, n1) * (0.25 + 0.75 * n2);
    vec3 violet = vec3(0.15, 0.028, 0.24);
    vec3 teal = vec3(0.01, 0.115, 0.18);
    vec3 amber = vec3(0.4, 0.16, 0.03);
    col += violet * pow(cloud, 1.2) * 0.95;
    col += teal * pow(cloud, 2.4) * 0.72;
    col += amber * pow(cloud, 3.4) * 0.48;

    // 更密集的异星系星群
    col += starField(d, 1.12) * starAmount;

    // 异星系尘埃带
    vec3 bandN = normalize(vec3(-0.5, 0.5, 0.7));
    float band = exp(-pow(dot(d, bandN) * 3.5, 2.0));
    float dust = fbm3(d * 7.5 + vec3(1.3, 4.2, -2.8));
    col += band * (vec3(0.06, 0.03, 0.1) * (0.5 + dust) + vec3(0.19, 0.08, 0.025) * pow(smoothstep(0.34, 0.82, dust), 2.0) * 0.8);

    // 远处仙女状旋涡星系
    vec3 galaxyDir = normalize(vec3(0.52, -0.34, 0.78));
    float ang = acos(clamp(dot(d, galaxyDir), -1.0, 1.0));
    float galaxyCore = exp(-pow(ang / 0.028, 2.0));
    float galaxyHalo = exp(-pow(ang / 0.12, 2.0));
    vec3 galRight = normalize(cross(vec3(0.0, 1.0, 0.0), galaxyDir));
    vec3 galUp = normalize(cross(galaxyDir, galRight));
    vec2 gp = vec2(dot(d, galRight), dot(d, galUp)) / 0.05;
    float spiral = 0.5 + 0.5 * sin(atan(gp.y, gp.x) * 2.0 + length(gp) * 7.0);
    col += galaxyHalo * vec3(0.16, 0.06, 0.2) * 0.18;
    col += galaxyCore * vec3(1.0, 0.8, 0.6) * 1.05;
    col += spiral * galaxyHalo * vec3(0.15, 0.08, 0.18) * 0.36;

    return col;
  }

  /* ---------------- 巨人黑洞 ---------------- */

  vec3 blackHole(vec3 d, out float occl) {
    occl = 0.0;
    vec3 c = normalize(uBhDir);
    float ca = dot(d, c);
    if (ca < 0.66) return vec3(0.0);

    vec3 refUp = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(refUp, c));
    vec3 up = normalize(cross(c, right));

    float scale = 0.144;
    vec2 q = vec2(dot(d, right), dot(d, up)) / scale;
    float r = length(q);
    if (r > 9.0) return vec3(0.0);

    float t = uTime;
    float shadow = 1.0 - smoothstep(0.88, 1.07, r);
    float edgeFade = smoothstep(0.66, 0.76, ca);
    occl = shadow * edgeFade;

    vec3 col = vec3(0.0);

    // 近边缘朝向的吸积盘：薄、亮、带湍流与相对论多普勒增亮
    float warpY = 0.035 * sin(q.x * 0.55 + t * 0.16) + 0.012 * sin(q.x * 1.7 - t * 0.4);
    float bandY = q.y - warpY;
    float diskBand = exp(-pow(bandY / (0.075 + 0.018 * abs(q.x)), 2.0));
    float radial = (1.0 - smoothstep(1.05, 6.8, abs(q.x))) * smoothstep(0.98, 1.12, r);
    float disk = diskBand * radial;

    float turb = 0.56 + 0.44 * sin(q.x * 2.3 + sin(q.x * 1.1 + t * 0.3) * 2.0 + t * 0.5);
    turb *= 0.72 + 0.28 * sin(q.x * 7.3 - t * 0.9 + q.y * 4.0);
    turb = pow(max(turb, 0.0), 1.35);

    float doppler = mix(0.35, 1.9, 1.0 - smoothstep(-3.4, 0.9, q.x));
    vec3 dopplerTint = mix(vec3(0.82, 0.92, 1.18), vec3(1.25, 0.9, 0.62), 1.0 - smoothstep(-3.0, 0.5, q.x));
    vec3 diskColor = mix(vec3(1.0, 0.2, 0.035), vec3(1.0, 0.78, 0.5), smoothstep(1.05, 5.2, r));
    col += disk * turb * doppler * dopplerTint * diskColor * 3.6;

    // 吸积盘内侧的炽热亮边
    float innerEdge = exp(-pow((r - 1.11) / 0.035, 2.0)) * diskBand;
    col += innerEdge * vec3(1.0, 0.74, 0.42) * 1.6;

    // 二次透镜成像（上下弧）
    float arc = exp(-pow((r - 1.3) / 0.038, 2.0));
    float arcMask = 0.35 + 0.65 * smoothstep(-0.2, 0.7, 0.5 + 0.5 * sin(atan(q.y, q.x) * 2.0 + 1.2));
    col += arc * arcMask * vec3(1.0, 0.58, 0.26) * 1.15;
    float arc2 = exp(-pow((r - 1.52) / 0.055, 2.0));
    col += arc2 * (0.5 + 0.5 * arcMask) * vec3(0.7, 0.38, 0.14) * 0.55;

    // 光子环：明亮而纤细
    float photon = exp(-pow((r - 1.0) / 0.013, 2.0));
    col += photon * vec3(1.5, 1.3, 1.05) * 1.55;
    float inner = exp(-pow((r - 1.06) / 0.009, 2.0));
    col += inner * vec3(0.58, 0.85, 1.0) * 0.65;

    // 穿过阴影下缘的前方吸积盘（电影级视感）
    float frontY = q.y + 0.17 + 0.018 * sin(q.x * 2.2 + t * 0.4);
    float frontBand = exp(-pow(frontY / 0.042, 2.0));
    frontBand *= 1.0 - smoothstep(0.5, 1.28, abs(q.x));
    frontBand *= 1.0 - smoothstep(0.92, 1.12, r);
    float frontTurb = 0.55 + 0.45 * sin(q.x * 8.0 - t * 1.2 + sin(q.x * 2.0));
    col += frontBand * frontTurb * vec3(1.45, 0.52, 0.12) * 0.85;

    // 外侧薄雾
    col += exp(-r * 0.82) * vec3(0.22, 0.09, 0.03) * 0.38;
    col += exp(-r * 0.34) * vec3(0.08, 0.035, 0.06) * 0.2;

    return col * uBhIntensity * edgeFade;
  }

  /* ---------------- Gargantua：世界坐标吸积盘 + 事件视界 ---------------- */

  // 黑体辐射艺术化色带：内圈高温蓝白，外圈金黄 / 暗红
  vec3 blackbodyRamp(float temp) {
    temp = clamp(temp, 0.0, 1.0);
    vec3 darkRed = vec3(0.14, 0.008, 0.001);
    vec3 red     = vec3(0.72, 0.065, 0.004);
    vec3 orange  = vec3(1.0, 0.30, 0.03);
    vec3 gold    = vec3(1.0, 0.64, 0.2);
    vec3 white   = vec3(1.0, 0.94, 0.82);
    vec3 col = mix(darkRed, red, smoothstep(0.0, 0.28, temp));
    col = mix(col, orange, smoothstep(0.24, 0.55, temp));
    col = mix(col, gold, smoothstep(0.52, 0.8, temp));
    col = mix(col, white, smoothstep(0.78, 1.0, temp));
    return col;
  }

  // 吸积盘的单次平面穿越采样：FBM 湍流 + 黑体色 + 多普勒射束
  vec3 sampleAccretionDisk(vec3 hit, vec3 rayDir, out float opacity) {
    vec3 axis = normalize(uDiskNormal);
    vec3 ref = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 e1 = normalize(cross(axis, ref));
    vec3 e2 = cross(axis, e1);

    vec2 uv = vec2(dot(hit, e1), dot(hit, e2));
    float radius = length(uv);
    float tNorm = clamp((radius - uDiskInner) / max(uDiskOuter - uDiskInner, 0.001), 0.0, 1.0);
    float temp = pow(1.0 - tNorm, 0.55);
    vec3 baseColor = blackbodyRamp(temp);

    float theta = atan(uv.y, uv.x);
    // 差速旋转：内圈转得快，外圈拖出螺旋
    float swirl = theta + uTime * 0.62 / pow(max(radius, 1.0), 1.35);
    vec3 q = vec3(cos(swirl), sin(swirl), 0.0) * radius;
    q.z = radius * 0.7 + uTime * 0.16;

    // 3D FBM：气体、尘埃与涡旋
    float n = fbm3(q * 0.58 + vec3(0.0, 0.0, uTime * 0.12));
    float fine = 0.5 + 0.5 * sin(radius * 5.3 - theta * 3.0 + uTime * 1.25 + n * 5.0);
    float spiral = 0.5 + 0.5 * sin(theta * 2.0 - 6.2 * log(radius + 1.0) + uTime * 0.34);
    float density = smoothstep(0.24, 0.7, n * 0.68 + fine * 0.2 + spiral * 0.18);
    density *= smoothstep(0.0, 0.07, tNorm) * (1.0 - smoothstep(0.84, 1.0, tNorm));

    // 相对论多普勒：轨道速度方向与视线夹角
    vec3 radialDir = length(uv) > 1e-4 ? normalize(e1 * uv.x + e2 * uv.y) : e1;
    vec3 tangent = normalize(cross(axis, radialDir));
    float beta = clamp(0.62 * sqrt(uDiskInner / max(radius, uDiskInner)), 0.0, 0.72);
    float cosTheta = dot(tangent, -normalize(rayDir));
    float gamma = inversesqrt(max(1.0 - beta * beta, 0.02));
    float doppler = 1.0 / max(gamma * (1.0 - beta * cosTheta), 0.12);
    float beam = pow(clamp(doppler, 0.25, 3.0), 3.0);   // I_obs ∝ δ³
    vec3 dopplerTint = mix(
      vec3(1.15, 0.52, 0.28),      // 远离侧：红移
      vec3(0.62, 0.85, 1.28),      // 接近侧：蓝移
      smoothstep(0.78, 1.48, doppler)
    );

    // 引力红移：越靠近视界，亮度越低
    float grav = sqrt(max(0.0, 1.0 - 1.0 / max(radius, 1.001)));
    vec3 gravTint = mix(vec3(0.9, 0.55, 0.42), vec3(1.0), smoothstep(1.0, 4.5, radius));
    float emission = (0.22 + density * 2.4) * 1.8;
    opacity = clamp(density * 0.9, 0.035, 0.95);

    return baseColor * dopplerTint * gravTint * emission * beam * (0.35 + grav * 0.65);
  }

  // 世界坐标中的 Schwarzschild 近似光线积分
  // 返回：捕获 → 纯黑 + 盘面发光；逃逸 → 透镜后的背景星空 + 盘面
  vec3 traceGargantua(vec3 ro, vec3 rd, vec3 baseColor) {
    vec3 p = (ro - uBhPos) / max(uBhRs, 0.001);
    vec3 v = rd;

    vec3 L = cross(p, v);
    float h2 = dot(L, L);                 // 比角动量平方，沿测地线守恒
    float tc = -dot(p, v);
    float closest2 = max(0.0, dot(p, p) - tc * tc);
    float bImpact = sqrt(closest2);       // 直线近似冲击参数（Rs 单位）

    // 远离黑洞且方向不朝向黑洞：直接采样未弯曲天球
    if (tc < 0.0 || bImpact > uDiskOuter + 4.0) {
      return baseColor;
    }

    vec3 diskCol = vec3(0.0);
    float trans = 1.0;
    bool captured = false;

    for (int i = 0; i < 128; i++) {
      float r2 = dot(p, p);
      float r = sqrt(r2);
      if (r < 1.0) {
        captured = true;
        break;
      }
      if (r > 55.0 && dot(p, v) > 0.0) break;

      // 自适应步长：远处大跨步，靠近光子球 / 视界时缩小
      float dt = clamp(0.065 * r, 0.018, 0.62);
      // 史瓦西近似：a = -1.5 h² r_vec / r^5（几何单位）
      vec3 acc = -1.5 * h2 * p / (r2 * r2 * max(r, 0.25) + 1e-4);

      vec3 pPrev = p;
      float prevPlane = dot(p, uDiskNormal);
      v += acc * dt;
      p += v * dt;

      float curPlane = dot(p, uDiskNormal);
      if (prevPlane * curPlane < 0.0) {
        float f = prevPlane / (prevPlane - curPlane);
        vec3 hit = mix(pPrev, p, f);
        float rh = length(hit);
        if (rh > uDiskInner && rh < uDiskOuter) {
          float diskOpacity = 0.0;
          vec3 diskLight = sampleAccretionDisk(hit, normalize(v), diskOpacity);
          // 盘面部分遮挡背景；多次穿越自动形成上下透镜像
          diskCol += trans * diskLight * diskOpacity;
          trans *= 1.0 - diskOpacity * 0.82;
        }
      }

      if (trans < 0.02) break;
    }

    if (captured) {
      // 视界内部：纯黑。盘面在视界前方的部分仍会发光
      return diskCol;
    }

    vec3 lensedSky = gargantuaSky(normalize(v), 1.0);
    return lensedSky * trans + diskCol;
  }

  /* ---------------- 引力偏折 ---------------- */

  vec3 lensDirection(vec3 ro, vec3 rd) {
    vec3 toCenter = normalize(-ro);
    float cosC = clamp(dot(rd, toCenter), -1.0, 1.0);
    if (cosC < 0.02) return rd;

    float camDist = length(ro);
    float sinC = sqrt(max(0.0, 1.0 - cosC * cosC));
    float b = camDist * sinC;

    float angle = uLens * 0.64 * (uThroat * uThroat) / (b * b + uThroat * uThroat * 0.08);
    angle = clamp(angle, 0.0, 0.82) * smoothstep(0.0, 0.25, cosC);

    vec3 dir = rotateToward(rd, toCenter, angle);

    // 爱因斯坦环附近的切向旋涡拉伸
    vec3 tangential = normalize(cross(toCenter, dir) + vec3(1e-5));
    dir = normalize(dir + tangential * angle * 0.16 * sin(atan(dir.y, dir.x) * 2.0 + uTime * 0.5));
    return dir;
  }

  /* ---------------- 球体 / 虫洞 ---------------- */

  bool raySphere(vec3 ro, vec3 rd, float rad, out float t0, out float t1) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rad * rad;
    float h = b * b - c;
    if (h < 0.0) {
      t0 = -1.0;
      t1 = -1.0;
      return false;
    }
    h = sqrt(h);
    t0 = -b - h;
    t1 = -b + h;
    return true;
  }

  vec3 portalSurface(vec3 ro, vec3 rd, float farMix, float tEntry) {
    vec3 p1 = ro + rd * tEntry;
    vec3 n1 = normalize(p1);

    float ior = 1.285;
    vec3 r1 = refract(rd, n1, 1.0 / ior);
    if (dot(r1, r1) < 0.0005) {
      r1 = reflect(rd, n1);
    }
    r1 = normalize(r1);

    // 出射点（球内二次求交）
    float b = dot(p1, r1);
    float c = dot(p1, p1) - uThroat * uThroat;
    float h = b * b - c;
    float tExit = -b + sqrt(max(0.0, h));
    vec3 p2 = p1 + r1 * tExit;
    vec3 n2 = normalize(p2);

    vec3 r2 = refract(r1, -n2, ior);
    if (dot(r2, r2) < 0.0005) {
      r2 = reflect(r1, -n2);
    }
    r2 = normalize(r2);

    float ndv = abs(dot(rd, n1));
    float limb = pow(1.0 - ndv, 1.8);
    float fres = pow(1.0 - ndv, 2.8);

    // 晶体球面的强边缘折射：越靠近轮廓，异星系影像越被拉成切向弧
    vec3 lensDir = normalize(mix(r2, n1, limb * 0.42));
    float swirl = limb * (0.35 * sin(uTime * 0.22 + n1.y * 5.0) + 0.18);
    lensDir = normalize(rotateAroundAxis(lensDir, n1, swirl));

    // farMix = 0：远端是太阳系；1：远端是 Gargantua 星系
    vec3 farColor = mix(solSky(lensDir, 0.16), gargantuaSky(lensDir, 0.16), farMix);

    // 从太阳系端透视虫洞时，异星系深处的 Gargantua 也应收敛在晶体球面内
    if (farMix > 0.5) {
      float occ = 0.0;
      vec3 bh = blackHole(lensDir, occ);
      farColor = farColor * (1.0 - occ) + bh;
    }

    // 晶体球面内的稀疏星点：使用屏幕空间钉扎，避免球面放大把星点糊成光斑
    farColor += screenStars(gl_FragCoord.xy, 5.5, 0.052, 5.7, 0.8) * 0.9;
    farColor += screenStars(gl_FragCoord.xy, 12.5, 0.07, 17.3, 1.5) * 0.65;

    // 球面内的星系旋涡与切向拉丝
    float portalSwirl = 0.5 + 0.5 * sin(atan(n1.y, n1.x) * 3.0 + length(n1.xy) * 9.0 - uTime * 0.12);
    farColor += mix(vec3(1.0, 0.55, 0.2), vec3(0.35, 0.74, 1.0), portalSwirl) * pow(portalSwirl, 3.0) * limb * 0.26;

    // 石英色偏与内部吸收
    float path = tExit;
    vec3 tint = mix(vec3(1.12, 0.92, 0.74), vec3(0.72, 0.92, 1.12), farMix);
    farColor *= tint * (0.3 + 0.12 * exp(-path / uThroat));
    // 水晶透镜：中心更暗，异星系影像被压缩到球面边缘
    farColor *= 0.38 + 0.62 * pow(limb, 0.75);

    // 晶面高光
    vec3 lightDir = normalize(vec3(-0.32, 0.66, 0.34));
    float sheen = pow(max(0.0, dot(n1, lightDir)), 26.0);
    farColor += vec3(0.42, 0.64, 0.9) * sheen * 0.3;
    float sunGlint = pow(max(0.0, dot(reflect(rd, n1), normalize(vec3(-0.45, 0.32, 0.83)))), 180.0);
    farColor += vec3(1.0, 0.82, 0.58) * sunGlint * 1.2;

    // 表面 Fresnel 边缘光
    vec3 rimColor = mix(vec3(1.0, 0.6, 0.22), vec3(0.42, 0.86, 1.0), 0.5 + 0.5 * sin(atan(n1.y, n1.x) * 2.0 + uTime * 0.35));
    farColor += rimColor * fres * 0.26;

    // 晶体球内的切向爱因斯坦弧
    float arcPhase = atan(n1.y, n1.x) * 3.0 + uTime * 0.18;
    float crystalArc = pow(0.5 + 0.5 * sin(arcPhase), 5.0) * limb;
    farColor += mix(vec3(0.9, 0.55, 0.2), vec3(0.35, 0.75, 1.0), 0.5 + 0.5 * sin(arcPhase * 1.7)) * crystalArc * 0.85;
    float causticRing = pow(limb, 7.0) * (0.5 + 0.5 * sin(arcPhase * 1.6 + 1.0));
    farColor += vec3(0.8, 0.9, 1.0) * causticRing * 0.36;

    // 晶面焦散
    float caustic = fbm3(n1 * 6.3 + vec3(0.0, uTime * 0.12, 0.0));
    farColor += (vec3(0.16, 0.55, 0.78) + rimColor * 0.4) * pow(caustic, 4.0) * 0.12;
    float vein = pow(0.5 + 0.5 * sin(n1.x * 11.0 + n1.y * 13.0 + n1.z * 7.0 + caustic * 9.0), 10.0);
    farColor += vec3(0.35, 0.65, 0.85) * vein * fres * 0.15;

    return farColor;
  }

  vec3 outsideScene(vec3 ro, vec3 rd) {
    // 世界坐标跨越喉部轴：在 z=0 附近平滑混合双宇宙。真正穿越时由隧道覆盖接缝。
    float sideMix = smoothstep(-uThroat * 0.22, uThroat * 0.22, ro.z);
    vec3 toCenter = normalize(-ro);
    float cosC = clamp(dot(rd, toCenter), -1.0, 1.0);
    float camDist = length(ro);
    float b = camDist * sqrt(max(0.0, 1.0 - cosC * cosC));

    vec3 localDir = lensDirection(ro, rd);
    vec3 localSky = mix(gargantuaSky(localDir, 1.0), solSky(localDir, 1.0), sideMix);
    vec3 col = localSky;

    // 球形虫洞：命中即进入晶体球面。farMix 为对端宇宙的权重。
    float t0, t1;
    if (raySphere(ro, rd, uThroat, t0, t1) && t0 > 0.0) {
      col = portalSurface(ro, rd, 1.0 - sideMix, t0);

      // 球体边缘的薄膜高光
      vec3 n = normalize(ro + rd * t0);
      float edge = pow(1.0 - abs(dot(rd, n)), 3.2);
      col += vec3(1.0, 0.72, 0.38) * edge * 0.45;
    }

    // 爱因斯坦环
    float ringWidth = uThroat * 0.0085;
    float ringPhase = 1.0 + 0.04 * sin(uTime * 0.9);
    float ring = exp(-pow((b - uThroat * ringPhase) / ringWidth, 2.0));
    float ringHalo = exp(-pow((b - uThroat * ringPhase) / (uThroat * 0.06), 2.0)) * 0.08;
    float ring2 = exp(-pow((b - uThroat * 1.045) / (uThroat * 0.006), 2.0));
    float ringMask = smoothstep(0.0, 0.28, cosC);
    float ringAngle = atan(rd.y, rd.x);
    vec3 ringCol = mix(vec3(1.0, 0.72, 0.34), vec3(0.58, 0.9, 1.0), 0.5 + 0.5 * sin(ringAngle * 2.0 + uTime * 0.3));

    // 球面背面留下一条极窄的暗边，强化“水晶球”轮廓
    float limbDark = exp(-pow((b - uThroat * 0.973) / (uThroat * 0.014), 2.0)) * ringMask;
    col *= 1.0 - 0.62 * limbDark;

    col += ring * ringCol * uLens * 1.85 * ringMask;
    col += ringHalo * ringCol * uLens * ringMask;
    col += ring2 * vec3(0.7, 0.92, 1.0) * uLens * 0.6 * ringMask;

    // 环外的切向透镜弧，模拟被拉成弧线的遥远星系
    float arcPhase2 = atan(rd.y, rd.x) * 4.0 - uTime * 0.22;
    float lensedArcs = pow(0.5 + 0.5 * sin(arcPhase2), 6.0) * exp(-pow((b - uThroat * 1.12) / (uThroat * 0.15), 2.0));
    vec3 arcTint = mix(vec3(1.0, 0.58, 0.24), vec3(0.4, 0.82, 1.0), 0.5 + 0.5 * sin(arcPhase2 * 0.7));
    col += lensedArcs * arcTint * uLens * 0.5 * ringMask;

    // 环外弥散光晕与切向弧
    float halo = exp(-pow((b - uThroat) / (uThroat * 0.3), 2.0)) * ringMask;
    col += halo * vec3(0.11, 0.09, 0.07) * uLens * 0.14;
    float arcs = exp(-pow((b - uThroat * 1.015) / (uThroat * 0.09), 2.0)) * ringMask;
    float arcPattern = 0.5 + 0.5 * sin(ringAngle * 3.0 - uTime * 0.35);
    col += arcs * (0.06 + 0.13 * arcPattern) * vec3(0.4, 0.25, 0.1) * uLens;

    return col;
  }

  /* ---------------- 四维折叠管道（Raymarching） ---------------- */

  float tunnelSDF(vec3 p) {
    float z = p.z;
    float twist = z * 0.115 + sin(z * 0.13 + uTime * 0.55) * 1.15;
    vec2 q = rot2(twist) * p.xy;
    float angle = atan(q.y, q.x);
    float wallR = uThroat * (
      0.58
      + 0.075 * sin(z * 0.22 + uTime * 0.75)
      + 0.04 * sin(angle * 3.0 + z * 0.42 - uTime * 0.5)
    );
    return length(q) - wallR;
  }

  vec3 tunnelWallNormal(vec3 p) {
    float e = 0.06;
    float dx = tunnelSDF(p + vec3(e, 0.0, 0.0)) - tunnelSDF(p - vec3(e, 0.0, 0.0));
    float dy = tunnelSDF(p + vec3(0.0, e, 0.0)) - tunnelSDF(p - vec3(0.0, e, 0.0));
    float dz = tunnelSDF(p + vec3(0.0, 0.0, e)) - tunnelSDF(p - vec3(0.0, 0.0, e));
    return normalize(vec3(dx, dy, dz) + vec3(1e-5));
  }

  vec3 tunnelWallShade(vec3 p, vec3 rd, float tHit) {
    vec3 n = tunnelWallNormal(p);
    float z = p.z;
    float angle = atan(p.y, p.x);

    float flow = 0.5 + 0.5 * sin(p.x * 0.62 + z * 0.41 + uTime * 0.6 + sin(p.y * 0.5 + uTime * 0.2));
    flow *= 0.5 + 0.5 * sin(p.y * 0.77 - z * 0.58 + uTime * 0.36 + sin(p.x * 0.4));

    float veins = pow(0.5 + 0.5 * sin(angle * 9.0 + z * 1.25 + uTime * 1.8 + flow * 4.0), 6.0);
    float ribs = pow(0.5 + 0.5 * sin(z * 0.82 + angle * 2.0 - uTime * 2.4), 7.0);
    float bands = pow(0.5 + 0.5 * sin(z * 0.46 - uTime * 1.35 + flow * 3.0), 12.0);

    vec3 base = mix(vec3(0.008, 0.022, 0.05), vec3(0.04, 0.008, 0.065), smoothstep(0.2, 0.8, flow));
    float ndl = max(dot(n, normalize(vec3(0.15, 0.28, -1.0))), 0.0);
    vec3 col = base * (0.25 + ndl * 0.95);

    vec3 emit = mix(vec3(0.03, 0.34, 0.68), vec3(0.5, 0.07, 0.62), smoothstep(0.25, 0.8, flow));
    emit *= 0.22 + veins * 1.55 + bands * 0.65;
    emit += vec3(1.0, 0.42, 0.1) * ribs * 1.25;
    emit += vec3(0.22, 0.75, 1.0) * bands * 0.9;
    col += emit * 0.8;

    float fres = pow(1.0 - abs(dot(n, -rd)), 2.4);
    col += vec3(0.25, 0.62, 1.0) * fres * 0.55;

    // 管道内部的极淡体积辉光
    float haze = 0.018 + 0.035 * flow;
    col += vec3(0.04, 0.16, 0.3) * haze * (0.4 + uDust);
    col *= exp(-tHit * 0.032);
    return col;
  }

  vec3 tunnelScene(vec3 ro, vec3 rd) {
    float jitter = hash21(gl_FragCoord.xy + fract(uTime) * 37.0);
    float tRay = 0.1 + jitter * 0.25;
    bool hit = false;
    float hitT = 0.0;
    vec3 hitP = vec3(0.0);
    vec3 volume = vec3(0.0);

    for (int i = 0; i < 56; i++) {
      vec3 p = ro + rd * tRay;
      if (p.z < -uThroat * 2.6 || p.z > uThroat * 2.6) break;

      float sd = tunnelSDF(p);
      if (sd > -0.002) {
        hit = true;
        hitT = tRay;
        hitP = p;
        break;
      }

      // 稀薄星尘体积光，保持管道深度感
      float dustNoise = 0.5 + 0.5 * sin(p.x * 1.2 + p.z * 0.9 + uTime * 0.7);
      vec3 dustCol = mix(vec3(0.02, 0.16, 0.3), vec3(0.22, 0.05, 0.3), dustNoise);
      volume += dustCol * 0.0022 * (0.4 + uDust);

      float stepLen = max(0.08, -sd * 0.55);
      tRay += min(stepLen, 1.35);
      if (tRay > uThroat * 4.5) break;
    }

    vec3 col;
    if (hit) {
      col = tunnelWallShade(hitP, rd, hitT);
    } else {
      // 轴向逃逸：看见另一端的星系（前景为巨人座，身后为太阳系）
      vec3 farSky = (-rd.z > 0.0) ? gargantuaSky(rd, 0.45) : solSky(rd, 0.45);
      col = farSky * 0.42;
      col += vec3(0.004, 0.008, 0.022);
    }
    col += volume;

    // 前方出洞辉光：冷蓝色光轮 + 柔和的中心亮斑
    vec3 exitPos = vec3(0.0, 0.0, -uThroat * 2.2);
    vec3 toExit = normalize(exitPos - ro);
    float exitAngle = acos(clamp(dot(rd, toExit), -1.0, 1.0));
    float exitCore = exp(-pow(exitAngle / 0.13, 2.0));
    float exitRing = exp(-pow((exitAngle - 0.225) / 0.028, 2.0));
    float exitHalo = exp(-pow(exitAngle / 0.42, 2.0)) * 0.35;
    col += exitCore * vec3(0.45, 0.7, 1.0) * 0.36;
    col += exitRing * vec3(0.42, 0.78, 1.0) * 0.48;
    col += exitHalo * vec3(0.12, 0.32, 0.52) * 0.4;

    // 身后进口辉光（太阳系镜像）
    vec3 entryPos = vec3(0.0, 0.0, uThroat * 2.2);
    vec3 toEntry = normalize(entryPos - ro);
    float entryAngle = acos(clamp(dot(rd, toEntry), -1.0, 1.0));
    col += exp(-pow(entryAngle / 0.14, 2.0)) * vec3(1.0, 0.62, 0.28) * 0.18;
    col += exp(-pow((entryAngle - 0.3) / 0.045, 2.0)) * vec3(0.9, 0.5, 0.2) * 0.1;

    // 轴向蓝移流线
    float alongAxis = clamp(-rd.z, 0.0, 1.0);
    float streak = pow(max(0.0, 1.0 - abs(rd.x * 5.5 + sin(rd.y * 18.0 + uTime * 2.0))), 22.0) * smoothstep(0.0, 0.85, alongAxis);
    col += streak * vec3(0.3, 0.7, 1.0) * 0.12 * (0.25 + uWarp);

    // 画面级量子闪光
    col += uFlash * vec3(0.55, 0.8, 1.0) * 0.18;

    return col;
  }

  /* ---------------- 主函数 ---------------- */

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float tanHalf = tan(radians(uFov) * 0.5);

    vec3 camRay = normalize(vec3((uv.x * 2.0 - 1.0) * aspect * tanHalf, (uv.y * 2.0 - 1.0) * tanHalf, -1.0));
    vec3 rd = normalize(uCamMat * camRay);
    vec3 ro = uCamPos;

    vec3 col;

    if (uInside > 0.985) {
      col = tunnelScene(ro, rd);
    } else if (uInside < 0.012) {
      col = outsideScene(ro, rd);
    } else {
      vec3 outside = outsideScene(ro, rd);
      vec3 tunnel = tunnelScene(ro, rd);
      float m = smoothstep(0.0, 1.0, uInside);
      col = mix(outside, tunnel, m);
      // 穿越界面的光爆
      float flash = sin(m * PI);
      col += flash * vec3(0.8, 0.95, 1.0) * 0.22;
    }

    // Gargantua：世界坐标黑洞 + 吸积盘 + 事件视界（仅异星系端启用）
    if (uBhActive > 0.001 && ro.z < 0.0 && uInside < 0.25) {
      vec3 traced = traceGargantua(ro, rd, col);
      col = mix(col, traced, uBhActive);
    }

    // 全局量子闪白
    col += uFlash * vec3(0.55, 0.8, 1.0) * 0.35;

    // 轻微暗角，后期也会叠加
    col *= 0.92 + 0.08 * (1.0 - smoothstep(0.15, 0.9, length(uv - 0.5)));

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`;
