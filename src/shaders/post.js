/**
 * 电影级后期处理：
 *  - 径向色差 / 曲速径向拉丝
 *  - 多采样柔光 Bloom
 *  - ACES Filmic 色调映射、暗角、胶片颗粒、扫描线
 */

export const postVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const postFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uWarp;
  uniform float uFlash;
  uniform float uChroma;
  uniform float uExposure;
  uniform float uInside;

  #define PI 3.14159265359

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 sampleScene(vec2 uv) {
    // 4-tap tent，轻微抗锯齿
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec2 o = px * 0.38;
    vec3 c = texture2D(tDiffuse, uv).rgb * 0.4;
    c += texture2D(tDiffuse, uv + vec2(o.x, o.y)).rgb * 0.15;
    c += texture2D(tDiffuse, uv + vec2(-o.x, o.y)).rgb * 0.15;
    c += texture2D(tDiffuse, uv + vec2(o.x, -o.y)).rgb * 0.15;
    c += texture2D(tDiffuse, uv + vec2(-o.x, -o.y)).rgb * 0.15;
    return c;
  }

  vec3 blurBright(vec2 uv, float radius) {
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec3 sum = vec3(0.0);
    float total = 0.0;

    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471975512;
      vec2 dir = vec2(cos(a), sin(a));
      vec3 s1 = texture2D(tDiffuse, uv + dir * px * radius).rgb;
      vec3 s2 = texture2D(tDiffuse, uv + dir * px * radius * 2.15).rgb;
      float l1 = max(max(s1.r, s1.g), s1.b);
      float l2 = max(max(s2.r, s2.g), s2.b);
      s1 *= smoothstep(0.82, 1.75, l1);
      s2 *= smoothstep(0.82, 1.75, l2) * 0.6;
      sum += s1 + s2;
      total += 1.6;
    }
    return sum / total;
  }

  void main() {
    vec2 uv = vUv;
    vec2 center = uv - 0.5;
    float r2 = dot(center, center);

    // 曲速径向拉丝
    vec3 baseSample = sampleScene(uv);
    float caBase = (0.00055 + 0.0055 * r2) * (0.3 + uChroma) * (0.75 + uWarp * 1.8);
    vec3 chromatic;
    chromatic.r = texture2D(tDiffuse, uv + center * caBase).r;
    chromatic.g = baseSample.g;
    chromatic.b = texture2D(tDiffuse, uv - center * caBase).b;

    if (uWarp > 0.02) {
      vec3 streak = vec3(0.0);
      float total = 0.0;
      for (int i = 1; i <= 7; i++) {
        float f = float(i) / 7.0;
        float w = 1.0 - f;
        vec2 suv = uv - center * f * 0.075 * uWarp;
        vec3 s = texture2D(tDiffuse, suv).rgb;
        streak += s * w;
        total += w;
      }
      chromatic = mix(chromatic, streak / max(total, 0.001), uWarp * 0.28);
    }

    vec3 col = chromatic;

    // 曲速 / 喉部的高速径向流线
    if (uInside > 0.03) {
      float ang = atan(center.y, center.x);
      float radial = length(center);
      float spokes = pow(0.5 + 0.5 * sin(ang * 46.0 + sin(radial * 16.0 - uTime * 2.4) * 2.0 + uTime * 6.0), 20.0);
      spokes *= smoothstep(0.1, 0.78, radial) * uInside;
      col += spokes * vec3(0.22, 0.55, 0.95) * 0.11 * (0.4 + uWarp);
    }

    // 柔光 Bloom
    vec3 bloom = blurBright(uv, 4.0 + uWarp * 7.0);
    col += bloom * (0.3 + uWarp * 0.42) * vec3(0.7, 0.9, 1.15) * 0.48;
    col += bloom * vec3(1.15, 0.8, 0.55) * 0.1;

    // 曲速时中心冷光
    col += (1.0 - smoothstep(0.0, 0.42, sqrt(r2))) * vec3(0.18, 0.38, 0.55) * uWarp * 0.22;

    // 闪光
    col += uFlash * vec3(0.7, 0.88, 1.0) * 0.3;

    // 曝光 + ACES
    col *= uExposure;
    col = aces(col);

    // 青蓝阴影 / 琥珀高光
    col = pow(col, vec3(0.96, 1.0, 1.05));
    col += vec3(0.0025, 0.005, 0.008) * (1.0 - col);

    // 暗角
    float vignette = 1.0 - smoothstep(0.24, 0.92, length(center * vec2(1.03, 0.98)));
    col *= 0.7 + 0.3 * vignette;
    col *= 1.0 - smoothstep(0.35, 0.82, length(center)) * 0.12;

    // 胶片颗粒
    float grain = hash12(gl_FragCoord.xy + floor(uTime * 24.0) * vec2(37.0, 17.0)) - 0.5;
    col += grain * (0.012 + uInside * 0.007);

    // 极轻扫描线
    float scan = sin(gl_FragCoord.y * 1.55) * 0.5 + 0.5;
    col *= 0.987 + 0.013 * scan;

    // 保护暗部，仅避免完全死黑到无法显示
    col = max(col, vec3(0.0006, 0.001, 0.0018));

    // 手动 sRGB 编码（renderer 使用 LinearSRGBColorSpace）
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;
