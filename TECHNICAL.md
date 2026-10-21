# 《星际穿越》球形虫洞与 Gargantua · 技术白皮书

> 目标：在浏览器中用 Three.js + 单个全屏 Fragment Shader 实时渲染「双星系天球 + 球形虫洞 + 四维管道 + Gargantua 黑洞」。
> 本文说明数学物理模型、GLSL 实现、Three.js 管线与性能优化；完整可运行代码位于 `src/shaders/scene.js`、`src/shaders/post.js` 与 `src/main.js`。

---

## 1. 总体渲染管线

```text
DOM HUD（中文全息仪表 / 参数面板）
        ↑
Canvas ← Post Shader（色差、Bloom、ACES、暗角、颗粒、扫描线）
        ↑
HDR RenderTarget（HalfFloat RGBA）
        ↑
Scene Shader（全屏四边形，单 pass 逆向光线）
        ↑
uCamPos / uCamMat / uTime / uThroat / uLens / uWarp / uInside ...
```

关键设计：

1. **整个 3D 场景由全屏 Fragment Shader 程序化生成**，没有加载贴图、模型或 HDR 环境球。
2. 相机只负责产生位置与朝向，CPU 每帧把 `uCamPos`、`uCamMat` 传给 GPU。
3. 场景先渲染到 HalfFloat RenderTarget，再由后期 Shader 做电影色调映射与光学效果。
4. HUD 是独立 DOM 层，不受 Shader 变色 / 模糊影响，保证中文仪表始终锐利可读。

这种架构的优点是：

- 无几何提交、无纹理带宽、无材质切换；
- 光线可以任意弯曲、穿洞、折射，不受 Three.js 光栅化管线限制；
- 适合「星空 / 虫洞 / 黑洞」这种以程序化体积与解析光学为主的场景。

代价是每像素成本较高，必须严格控制步进次数与噪声采样量（见第 6 节）。

---

## 2. 数学物理与光线偏折原理

### 2.1 从零测地线到屏幕上的偏折

静态球对称质量周围的零测地线可由轨道方程描述：

$$
\frac{d^2u}{d\varphi^2} + u = \frac{3GM}{c^2}u^2,
\qquad u = \frac{1}{r}
$$

其中 $b$ 为冲击参数（impact parameter）。在弱场、大冲击参数下，偏折角近似为：

$$
\alpha \approx \frac{4GM}{c^2 b} = \frac{2R_s}{b}
$$

这个公式揭示了两件对 Shader 很重要的事：

1. **偏折角随冲击参数增大迅速衰减**，所以真正明显的弯曲只发生在虫洞 / 黑洞轮廓附近；
2. **存在一条「光线恰好绕行」的临界区域**，在视觉上会汇聚成爱因斯坦环。

对于点源 + 点透镜的弱场近似，爱因斯坦环角半径为：

$$
\theta_E = \sqrt{\frac{4GM}{c^2}\frac{D_{LS}}{D_L D_S}}
= \sqrt{\frac{2R_s D_{LS}}{D_L D_S}}
$$

在实时渲染中，逐像素积分完整测地线代价太高。因此本实现采用**解析近似 + 屏幕空间环**：

- 用射线到原点的最近距离 `b` 作为冲击参数；
- 以 $\alpha \propto R^2/(b^2+\epsilon)$ 做方向偏折，并用 `clamp` 防止奇异；
- 在 `b ≈ uThroat` 的屏幕位置叠加高斯环，得到视觉上的 **Einstein Ring**；
- 同时叠加更细的二级环与切向透镜弧。

### 2.2 逆向光线生成

相机空间中的像素射线：

```glsl
float aspect  = uResolution.x / uResolution.y;
float tanHalf = tan(radians(uFov) * 0.5);

vec3 camRay = normalize(vec3(
  (uv.x * 2.0 - 1.0) * aspect * tanHalf,
  (uv.y * 2.0 - 1.0) * tanHalf,
  -1.0
));

vec3 rd = normalize(uCamMat * camRay);
vec3 ro = uCamPos;
```

`uCamMat` 是相机世界矩阵的旋转部分（`Matrix3.setFromMatrix4(camera.matrixWorld)`）。相机朝向变化不需要重编译 Shader，只更新 uniform。

### 2.3 引力偏折实现

核心函数 `lensDirection()`：

```glsl
vec3 lensDirection(vec3 ro, vec3 rd) {
  vec3 toCenter = normalize(-ro);
  float cosC = clamp(dot(rd, toCenter), -1.0, 1.0);
  if (cosC < 0.02) return rd;

  float camDist = length(ro);
  float sinC = sqrt(max(0.0, 1.0 - cosC * cosC));
  float b = camDist * sinC;                 // 冲击参数

  float angle = uLens * 0.64 * (uThroat * uThroat)
              / (b * b + uThroat * uThroat * 0.08);
  angle = clamp(angle, 0.0, 0.82)
        * smoothstep(0.0, 0.25, cosC);

  vec3 dir = rotateToward(rd, toCenter, angle);  // 朝虫洞中心弯折

  // 环附近的切向涡旋，制造被拉长的透镜弧
  vec3 tangential = normalize(cross(toCenter, dir) + vec3(1e-5));
  dir = normalize(dir + tangential * angle * 0.16
        * sin(atan(dir.y, dir.x) * 2.0 + uTime * 0.5));
  return dir;
}
```

`rotateToward(v, target, angle)` 用 Rodrigues 公式把方向向量朝中心旋转。偏折强度由 `uLens` 暴露给参数面板，实现「引力透镜强度」实时调节。

### 2.4 球形虫洞：双星系空间折叠

可穿越虫洞的经典 Morris–Thorne 度规：

$$
ds^2 = -e^{2\Phi(l)}dt^2 + dl^2 + r(l)^2\left(d\theta^2 + \sin^2\theta\,d\varphi^2\right)
$$

喉部条件为 $r(0)=b_0$，且满足 flare-out 条件 $dr/dl|_{0}=0$、$d^2r/dl^2>0$。一个常用的嵌入形式是：

$$
r(l)=b_0\cosh(l/b_0)
$$

把 $z$ 方向作为嵌入坐标，可得到两个在喉部相接的宇宙片。电影中虫洞之所以像一个「球」而不是一个洞，是因为我们看到的其实是**另一端宇宙的像**被强烈弯曲后覆盖在球面轮廓内。

实时 Shader 不需要真的积分这个度规。本实现用**球面折射 + 双宇宙采样**做等价视觉：

1. 射线与半径 `uThroat` 的球求交；
2. 在入射点按 IOR `1.285` 折射；
3. 在球内求第二次交点，再折射出射；
4. 用出射方向采样「另一端」的天球；
5. 根据 `ro.z` 的符号选择：
   - `z > 0`：本地是太阳系，远端是 Gargantua 星系；
   - `z < 0`：本地是 Gargantua 星系，远端是太阳系。

```glsl
vec3 portalSurface(vec3 ro, vec3 rd, float side, float tEntry) {
  vec3 p1 = ro + rd * tEntry;
  vec3 n1 = normalize(p1);

  float ior = 1.285;
  vec3 r1 = refract(rd, n1, 1.0 / ior);     // 进入球体
  // ... 求球内出射点 p2 ...
  vec3 r2 = refract(r1, -n2, ior);          // 离开球体

  vec3 farColor = side > 0.0
    ? gargantuaSky(lensDir, 0.16)
    : solSky(lensDir, 0.16);
  // ...
}
```

视觉上进一步叠加：

- **Fresnel 边缘光**：`pow(1 - |dot(rd, n1)|, 2.8)`；
- **晶体焦散 / 切向弧**：基于表面法线的程序化条纹；
- **轮廓暗边**：在球面边缘略靠内处压暗，形成水晶球壁厚；
- **屏幕空间钉扎星点**：避免球面法线重映射把星星放大成巨大光斑。

> 物理边界：这是一个「折射球 + 双宇宙采样」的艺术模型，不是完整 Morris–Thorne 零测地线积分。它保留了双宇宙拓扑、球面透镜、爱因斯坦环等关键视觉特征，同时把性能控制在实时范围。

### 2.5 黑洞、光子球与吸积盘（世界坐标 Raymarching 版）

Gargantua 位于异星系空间中的一个固定世界坐标 `uBhPos`，黑洞半径以 `uBhRs`（世界单位 / 史瓦西半径）归一化。所有计算在黑洞局部坐标系中进行：

```glsl
vec3 p = (ro - uBhPos) / uBhRs;   // 世界坐标 → Rs 单位
vec3 v = rd;                       // 光线方向
vec3 L = cross(p, v);
float h2 = dot(L, L);              // 比角动量平方，近似守恒
```

光线积分采用常见的史瓦西零测地线 Cartesian 近似：

$$
\frac{d^2\mathbf r}{d\lambda^2}
= -\frac{3}{2}h^2\frac{\mathbf r}{r^5}
$$

其中 $h=|\mathbf r\times\mathbf v|$ 为比角动量。代码中对应：

```glsl
vec3 acc = -1.5 * h2 * p / (r2 * r2 * max(r, 0.25) + 1e-4);
v += acc * dt;
p += v * dt;
```

关键判定：

- `r < 1.0`（以 $R_s$ 为单位）：光线进入事件视界，**立即停止采样背景并返回纯黑**；
- 光线逃逸：用最终速度方向采样 Gargantua 天球，得到被引力透镜弯曲的星空；
- 盘面求交：每一步记录 `dot(p, uDiskNormal)` 的符号，符号翻转时在区间内插值得到精确的平面穿越点；
- 一次光线可能多次穿越盘面，因此上方 / 下方被弯曲的二次像会自然出现。

吸积盘温度近似 $T \propto r^{-3/4}$，用黑体色带 `blackbodyRamp()` 映射：

- 内圈：蓝白 / 高温；
- 中圈：金黄 / 白热；
- 外圈：橙红 / 暗红。

相对论多普勒与射束：

$$
\delta = \frac{1}{\gamma(1-\beta\cos\theta)}
\qquad
I_{\rm obs} \propto \delta^3 I_{\rm emit}
$$

盘面轨道速度按开普勒近似衰减，接近摄像机的一侧增亮并偏蓝，远离的一侧变暗并偏红：

```glsl
float beta = clamp(0.62 * sqrt(uDiskInner / max(radius, uDiskInner)), 0.0, 0.72);
float cosTheta = dot(tangent, -normalize(rayDir));
float gamma = inversesqrt(max(1.0 - beta * beta, 0.02));
float doppler = 1.0 / max(gamma * (1.0 - beta * cosTheta), 0.12);
float beam = pow(clamp(doppler, 0.25, 3.0), 3.0);
```

盘面纹理由 3D FBM 驱动：

```glsl
float swirl = theta + uTime * 0.62 / pow(max(radius, 1.0), 1.35);
vec3 q = vec3(cos(swirl), sin(swirl), 0.0) * radius;
q.z = radius * 0.7 + uTime * 0.16;
float n = fbm3(q * 0.58 + vec3(0.0, 0.0, uTime * 0.12));
```

再叠加高频细纹与螺旋臂，得到流动的尘埃、热斑和暗带。盘面不是无限薄：数值积分中的多次穿越与透明度会自然形成前后遮挡、透镜弧和“甜甜圈”式环带。

---

## 3. GLSL 核心实现

### 3.1 程序化星空

因为无法加载真实星表，本实现用多重哈希网格生成不同尺度的星点：

```glsl
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
  float core = exp(-dot(dd, dd) * 6200.0 * glowScale);
  float halo = exp(-sqrt(dot(dd, dd)) * 108.0 * glowScale) * 0.038;
  float flare = /* 十字星芒 */;
  return (core + halo + flare) * twinkle * (0.35 + h * 0.85);
}
```

多层叠加：4 个尺度分别对应稀疏亮星、中景星、细密星尘与远景微光。星点颜色按哈希在冷蓝与暖金之间混合，避免单调。

星云则用 3 个 octave 的 value noise 做 fbm，分别叠加：

- 深蓝 / 金色星云；
- 银河尘埃带；
- 暗色尘埃遮挡；
- 明亮星团核心。

### 3.2 四维折叠管道 Raymarching

喉部内部用 SDF + 球体追踪（Sphere Tracing）而不是固定步长：

```glsl
float tunnelSDF(vec3 p) {
  float z = p.z;
  float twist = z * 0.115 + sin(z * 0.13 + uTime * 0.55) * 1.15;
  vec2 q = rot2(twist) * p.xy;
  float angle = atan(q.y, q.x);

  float wallR = uThroat * (
    0.58
    + 0.075 * sin(z * 0.22 + uTime * 0.75)
    + 0.04  * sin(angle * 3.0 + z * 0.42 - uTime * 0.5)
  );
  return length(q) - wallR;
}
```

```glsl
for (int i = 0; i < 72; i++) {
  vec3 p = ro + rd * tRay;
  if (p.z < -uThroat * 2.6 || p.z > uThroat * 2.6) break;

  float sd = tunnelSDF(p);
  if (sd > -0.002) { hit = true; hitP = p; break; }

  volume += /* 稀薄星尘 */;
  tRay += min(max(0.08, -sd * 0.55), 1.35);  // 距离场安全步长
}
```

命中后：

1. 用 6 次 SDF 采样计算法线；
2. 计算管壁的伪光照、Fresnel、紫色/青色能量丝与琥珀色热纹；
3. 未命中（看向轴向出口）时，直接采样对端天球；
4. 叠加出口冷蓝光轮、入口金色光轮、量子闪光和径向蓝移流线。

**为什么这样快？**

- 只有在 `uInside > 0.985` 时才进入管道分支，外面完全不执行；
- 使用一次函数求值的方向距离，而不是固定步长累积；
- 在接近表面时自动采用更小步长，远处直接大跨步；
- 法线只在真正命中后计算，而不是每步都算。

### 3.3 双星系天球切换与世界坐标黑洞

`solSky(d, amount)` 与 `gargantuaSky(d, amount)` 接收方向并返回 HDR 颜色。二者结构相似，但使用不同调色板：

| 太阳系端 | Gargantua 端 |
| --- | --- |
| 深蓝 / 金色星云 | 紫罗兰 / 青绿 / 琥珀星云 |
| 银河盘带 | 异星系尘埃带 + 远处旋涡星系 |
| 稀疏黄白星团 | 更密集、更冷的星群 |

**双星系无缝切换**采用「侧向混合 + 喉部隧道隐藏接缝 + 球面折射显示对端」三层配合：

```glsl
// 世界坐标跨越喉部轴：z=0 附近从 Gargantua 平滑过渡到太阳系
float sideMix = smoothstep(-uThroat * 0.22, uThroat * 0.22, ro.z);

vec3 localSky = mix(
  gargantuaSky(localDir, 1.0),
  solSky(localDir, 1.0),
  sideMix
);

// 对端权重相反：太阳系端透过球体看到 Gargantua，反之亦然
float farMix = 1.0 - sideMix;
vec3 farColor = mix(
  solSky(lensDir, 0.16),
  gargantuaSky(lensDir, 0.16),
  farMix
);
```

- 摄像机在太阳系端时，本地天球权重偏向 `solSky`，而球形虫洞内部通过折射显示 `gargantuaSky`；
- 摄像机在巨人座端时，本地天球偏向 `gargantuaSky`，回望球体时内部显示 `solSky`；
- 穿越瞬间由 `uInside` 平滑混合到 Raymarching 隧道，接缝被高能闪光和管道完全遮蔽；
- 球面内部两次折射产生镜像反转，再加上 `limb` / `Fresnel` 控制边缘拉伸，形成“水晶球”式对端影像。

世界坐标 Gargantua 的积分函数骨架：

```glsl
vec3 traceGargantua(vec3 ro, vec3 rd, vec3 baseColor) {
  vec3 p = (ro - uBhPos) / uBhRs;
  vec3 v = rd;

  vec3 L = cross(p, v);
  float h2 = dot(L, L);
  float tc = -dot(p, v);
  float bImpact = sqrt(max(0.0, dot(p, p) - tc * tc));

  // 射线远离黑洞：直接返回原天球
  if (tc < 0.0 || bImpact > uDiskOuter + 4.0) return baseColor;

  vec3 diskCol = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  for (int i = 0; i < 160; i++) {
    float r2 = dot(p, p);
    float r = sqrt(r2);

    if (r < 1.0) { captured = true; break; }   // 事件视界
    if (r > 55.0 && dot(p, v) > 0.0) break;    // 逃逸

    float dt = clamp(0.065 * r, 0.018, 0.62);
    vec3 acc = -1.5 * h2 * p / (r2 * r2 * max(r, 0.25) + 1e-4);

    vec3 pPrev = p;
    float prevPlane = dot(p, uDiskNormal);
    v += acc * dt;
    p += v * dt;

    // 与吸积盘平面求交
    float curPlane = dot(p, uDiskNormal);
    if (prevPlane * curPlane < 0.0) {
      float f = prevPlane / (prevPlane - curPlane);
      vec3 hit = mix(pPrev, p, f);
      float rh = length(hit);
      if (rh > uDiskInner && rh < uDiskOuter) {
        float opacity = 0.0;
        vec3 light = sampleAccretionDisk(hit, normalize(v), opacity);
        diskCol += trans * light * opacity;
        trans *= 1.0 - opacity * 0.82;
      }
    }
  }

  if (captured) return diskCol;                   // 纯黑阴影 + 前方盘面
  return gargantuaSky(normalize(v), 1.0) * trans + diskCol;
}
```

**事件视界阴影**：

- 积分步进进入 `r < 1` 即视为被捕获，背景天球不再采样；
- 只有吸积盘在视界前方的发光会保留，中心核心因此呈现标志性的纯黑；
- 临界冲击参数附近的光线会多次绕行并多次穿越盘面，自然生成上下两条被引力弯曲的吸积盘像与光子环附近的高亮结构；
- `uBhActive` 在阶段切换时淡入 / 淡出，避免突然出现。

### 3.4 后期处理

场景 RT 之后是一个轻量自定义 Post Pass：

1. **径向色差**：R/B 通道沿屏幕中心径向偏移，偏移量随 `uChroma` 与 `uWarp` 增大；
2. **曲速径向拖尾**：沿径向多采样 7 次，按 `uWarp` 混合；
3. **Bloom**：6 方向、双半径亮部采样，阈值 `0.82–1.75`，避免把星云整体糊掉；
4. **ACES Filmic 色调映射**；
5. **青蓝阴影 / 琥珀高光分级**；
6. **暗角、胶片颗粒、极轻扫描线**；
7. **sRGB 编码**（渲染器使用 LinearSRGBColorSpace，Shader 手动编码）。

---

## 4. Three.js 架构

### 4.1 全屏四边形

```js
const geo = new THREE.PlaneGeometry(2, 2);
const mat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: sceneFragmentShader,
  depthTest: false,
  depthWrite: false,
});
const mesh = new THREE.Mesh(geo, mat);
mesh.frustumCulled = false;
scene.add(mesh);
```

顶点位置直接作为裁剪空间坐标，不需要投影矩阵；这样全屏 pass 与相机无关，只通过 uniform 传相机姿态。

### 4.2 HDR RenderTarget

```js
const rt = new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
});
```

HalfFloat 允许星点、光子环、吸积盘产生大于 1 的 HDR 值，交给 Bloom 与 ACES 处理；普通 8-bit RT 会提前截断高光。

### 4.3 两趟渲染

```js
renderer.setRenderTarget(rt);
renderer.render(fullscreenScene, fullscreenCamera);

renderer.setRenderTarget(null);
renderer.render(postScene, fullscreenCamera);
```

没有使用 `EffectComposer`，原因是：

- 场景本身只有一个全屏 pass，`EffectComposer` 的场景图与 pass 管理收益不大；
- 自定义后期可以精确控制采样数量、色彩空间与 HUD 无关的色调；
- 减少中间 RT 与额外 pass，移动端更稳定。

如果后续要接入更多效果（DoF、运动模糊、光晕），可以平滑迁移到 `EffectComposer + ShaderPass + UnrealBloomPass`。

### 4.4 相机航线与手动驾驶

- 自动航线由 `journey ∈ [0,1]` 参数化，分为 3 个阶段：
  - 阶段一：远距观察 → 加速接近；
  - 阶段二：穿过球体，FOV 从 61° 扩张到 98°，加入滚转与震动；
  - 阶段三：向外漂移并转向 Gargantua。
- 手动模式直接对 `shipQuat` 做局部四元数旋转，并在相机姿态上叠加鼠标自由观察四元数；
- HUD 姿态角通过 `Euler.setFromQuaternion(camera.quaternion, 'YXZ')` 解算。

### 4.5 Web Audio 合成

`src/audio.js` 中构建了：

- 多层正弦 + 布朗噪声的宇宙 drone；
- LFO 调制的引力剪切低频；
- 锯齿振荡器 + 带通噪声的推进器；
- 随机调度的量子撕裂（噪声爆裂 + 金属泛音）；
- 出洞时的 C 大三和弦 + 程序化卷积混响；
- 全局 compressor 与主音量控制。

所有节点在用户点击启动后才初始化；随机音效带冷却时间与短包络，避免爆音。

---

## 5. 参数映射

| UI 参数 | Uniform | 效果 |
| --- | --- | --- |
| 虫洞喉部半径 | `uThroat` | 球体尺度、管道半径、相机航线缩放 |
| 引力透镜强度 | `uLens` | 背景偏折、爱因斯坦环、切向弧 |
| 色差偏折 | `uChroma` | 后期径向色差强度 |
| 粒子密度 | `uDust` | 管道体积星尘与表面细微颗粒 |
| 曝光强度 | `uExposure` | 后期曝光 |
| 主音量 | 主 Gain | Web Audio 总输出 |
| 黑洞世界坐标 | `uBhPos` | Gargantua 在异星系空间中的位置 |
| 黑洞半径（世界单位 / Rs） | `uBhRs` | 曝光面积、视界阴影与盘面尺度 |
| 吸积盘内 / 外半径 | `uDiskInner` / `uDiskOuter` | 以 Rs 为单位的盘面范围 |
| 吸积盘法线 | `uDiskNormal` | 盘面倾角与透镜像方向 |
| 黑洞淡入系数 | `uBhActive` | 阶段三无缝出现 / 消失 |

参数全部是 GPU uniform / AudioParam 热更新，不会重编译 Shader。

### 5.1 Three.js 中的 uniform 每帧更新

```js
const sceneUniforms = {
  uTime:      { value: 0 },
  uCamPos:    { value: new THREE.Vector3() },
  uCamMat:    { value: new THREE.Matrix3() },
  uThroat:    { value: 10.0 },
  uLens:      { value: 1.0 },
  uBhPos:     { value: new THREE.Vector3(0, 34.5, -520) },
  uBhRs:      { value: 18.0 },
  uDiskInner: { value: 3.0 },
  uDiskOuter: { value: 14.0 },
  uDiskNormal:{ value: new THREE.Vector3(0.06, 1.0, 0.12).normalize() },
  uBhActive:  { value: 0.0 },
};

const _vBh = new THREE.Vector3();

function updateUniforms(dt) {
  state.bhActive = THREE.MathUtils.damp(
    state.bhActive,
    state.stage === 3 && state.inside < 0.25 ? 1.0 : 0.0,
    1.6,
    dt
  );

  camera.updateMatrixWorld(true);

  sceneUniforms.uTime.value = state.time;
  sceneUniforms.uCamPos.value.copy(camera.position);
  sceneUniforms.uCamMat.value.setFromMatrix4(camera.matrixWorld);
  sceneUniforms.uBhActive.value = state.bhActive;
  sceneUniforms.uBhPos.value.copy(getBlackHolePos(_vBh));
  sceneUniforms.uBhRs.value = state.params.throat * 1.8;
}

// 每帧：先更新相机与状态，再渲染
requestAnimationFrame(function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateCamera(dt);
  updateUniforms(dt);

  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, quadCamera);

  renderer.setRenderTarget(null);
  renderer.render(postScene, quadCamera);

  requestAnimationFrame(loop);
});
```

> 注意：`uCamMat` 应使用 `camera.matrixWorld` 的旋转部分；若使用 OrbitControls 或父节点，请先 `camera.updateWorldMatrix(true, false)`，避免传入上一帧矩阵。

---

## 6. 性能与实时交互优化

### 6.1 步进预算

| 区域 | 步进 | 说明 |
| --- | --- | --- |
| 球外 · 太阳系端 | 0 | 只有解析射线-球求交与程序化天球 |
| 球面 | 0 | 折射是解析求交，不 raymarch |
| 喉部 | ≤ 72 步 | SDF 球体追踪；接近表面时自动缩小步长 |
| Gargantua 黑洞 | ≤ 160 步 | 仅当 `ro.z < 0`、`uBhActive > 0` 且冲击参数落在盘面附近时执行 |
| 后期 | 固定采样 | 6 方向 Bloom + 径向拖尾 + 色差 |

### 6.2 关键技巧

1. **能解析就解析**：球体求交、折射、透镜方向、天球采样都不需要步进。
2. **只在必要时进入昂贵的管道分支**：`uInside` 从 0 变到 1 的过程中才混入 Tunnel Pass。
3. **SDF 球体追踪**：步长取 `-sd * 0.55` 并限制在 0.08–1.35，避免固定步长的浪费。
4. **命中后才算法线**：法线开销只发生在真正可见的管壁像素。
5. **廉价噪声**：管道内部用三角函数流场，lacunarity 噪声只用于每像素一次的天球 / 晶面焦散。
6. **屏幕空间钉扎星点**：避免高倍率球面重映射把星点放大成巨大光斑，同时不增加额外 3D 采样。
7. **后期节流**：Bloom 只用 6 个方向 × 2 个半径；色差只用 R/B 两个单点偏移，中心通道复用已采样的 base。
8. **动态分辨率**：默认 DPR ≤ 1.5，检测到平均帧时间超过 42ms 时自动降低 `resolutionScale` 并重建 RT。
9. **HUD 降频**：DOM 文本与 SVG 更新约 12.5Hz，渲染保持 60Hz，避免 DOM 成为瓶颈。
10. **音频节点复用**：长音只创建一次；瞬态音效在停止后由 GC 回收；更新用 `setTargetAtTime` 平滑，避免 zipper noise。
11. **黑洞积分早退**：先用直线冲击参数做快速剔除，只有 `bImpact < uDiskOuter + 4` 的光线才进入 160 步积分。
12. **FBM 只发生在盘面穿越点**：3D FBM 不在每个积分步执行，只在 `prevPlane * curPlane < 0` 时对插值交点采样一次。
13. **事件视界提前终止**：`r < 1.0` 立即 break，不再对背景天球采样。

### 6.3 移动端建议

- 把 `resolutionScale` 初始降到 0.75；
- 关闭胶片颗粒与扫描线；
- 减少星云 fbm 到 2 个 octave；
- 降低管道最大步数到 48；
- 将黑洞积分步数从 160 降到 96，并缩小 `uDiskOuter` 的快速剔除范围；
- 若设备支持，使用 `powerPreference: 'high-performance'`；
- 对 `prefers-reduced-motion` 用户减少镜头震动。

### 6.4 调试顺序

1. 先在低分辨率下确认光线与透镜方向正确；
2. 再单独调试球面折射与双宇宙切换；
3. 然后调黑洞 / 吸积盘的色调和环；
4. 最后叠加后期，避免 Bloom 掩盖几何问题；
5. 性能回归时优先降低 `uThroat` 内部步数与后期采样，而不是牺牲星场。

---

## 7. 诚实的技术边界

1. **不是严格的数值相对论**：Gargantua 使用史瓦西零测地线的 Cartesian 近似积分（`a = -1.5h²r/r⁵`），不是完整 Kerr / 测地线求解器；步长是自适应的，阴影边缘存在数值误差。
2. **虫洞模型是视觉拓扑模型**：使用球面折射表示两个宇宙的连接，而不是 Morris–Thorne 度规下的光线传播。
3. **单位归一化**：黑洞半径用 `uBhRs` 映射到世界单位，事件视界判定为 `r < 1 Rs`；吸积盘温度、多普勒因子与 HUD 红移显示值都是风格化指标。
4. **颜色是艺术调色**：ACES、色差、Bloom 与 HUD 调色均为电影观感服务，不代表真实光谱。
5. **性能依设备而异**：HUD 与场景已在 Windows + Chromium 的软件光栅器下完成渲染验证；实际帧率取决于 GPU、分辨率和浏览器。自动降分辨率是兜底策略。

---

## 8. 可继续演进的方向

- 使用 Compute Shader / WebGPU 预计算星表与透镜 LUT；
- 用更高阶积分器（RK4）或完整 Kerr 测地线替换当前近似，得到更严格的 photon ring / 多重像；
- 基于物理的吸积盘温度场、黑体色温与辐射转移；
- TAA / 时域降噪，在低分辨率下恢复细节；
- 支持 VR / 6DoF 与手柄；
- 将 HUD 做成可配置驾驶舱主题。

---

> 完整实现见：
>
> - 场景 Shader：[`src/shaders/scene.js`](src/shaders/scene.js)
> - 后期 Shader：[`src/shaders/post.js`](src/shaders/post.js)
> - Three.js 主程序：[`src/main.js`](src/main.js)
> - 音频引擎：[`src/audio.js`](src/audio.js)
