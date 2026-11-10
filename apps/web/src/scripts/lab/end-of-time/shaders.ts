// GLSL for 《时间的尽头》. Everything is procedural: no textures are downloaded.

export const NOISE_2D = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03 + 17.31;
    a *= 0.5;
  }
  return v;
}
`;

export const NOISE_3D = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise3(p);
    p = p * 2.04 + vec3(11.7, 3.1, 7.9);
    a *= 0.5;
  }
  return v;
}
`;

export const skyVertex = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragment = /* glsl */ `
${NOISE_3D}

varying vec3 vDir;
uniform float uTime;

void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  float az = atan(d.z, d.x) / 6.2831853 + 0.5;

  float nebula = fbm3(d * 3.1 + vec3(uTime * 0.004, 0.0, 0.0));
  float detail = fbm3(d * 7.4 + vec3(0.0, uTime * 0.003, 2.7));
  float band = smoothstep(0.42, 0.82, nebula * 0.82 + detail * 0.32);

  vec3 col = vec3(0.0018, 0.0036, 0.0088);
  col += vec3(0.0055, 0.024, 0.040) * band * (0.30 + 0.70 * el);
  col += vec3(0.012, 0.0035, 0.012) * pow(max(0.0, detail), 2.4) * 0.30;
  col += vec3(0.004, 0.018, 0.042) * smoothstep(0.52, 1.0, el) * band * 0.68;

  float horizon = exp(-pow((d.y + 0.02) * 4.6, 2.0));
  col += vec3(0.034, 0.015, 0.007) * horizon * 0.62;

  float auroraMask = smoothstep(0.56, 0.79, el) * (1.0 - smoothstep(0.955, 1.0, el));
  float ribbon = sin(az * 14.0 + fbm3(d * 4.6 + vec3(0.0, uTime * 0.012, 0.0)) * 12.0 + uTime * 0.03);
  float ribbon2 = sin(az * 23.0 - fbm3(d * 8.1 + 4.0) * 9.0 - uTime * 0.02);
  col += vec3(0.007, 0.045, 0.056) * pow(max(0.0, ribbon), 3.0) * auroraMask * 0.42;
  col += vec3(0.042, 0.017, 0.006) * pow(max(0.0, ribbon2), 4.0) * auroraMask * 0.20;

  col *= mix(0.18, 1.0, smoothstep(0.16, 0.54, el));
  col += (hash13(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5) * 0.0032;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const starVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  float twinkle = 0.68 + 0.32 * sin(uTime * (0.35 + aPhase * 0.9) + aPhase * 41.0);
  vAlpha = twinkle;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (1.0 + twinkle * 0.25);
  gl_Position = projectionMatrix * mv;
}
`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.02, d);
  float halo = smoothstep(0.5, 0.24, d) * 0.22;
  float alpha = (core * 0.85 + halo) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
}
`;

export const coronaVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const coronaFragment = /* glsl */ `
${NOISE_2D}

varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);

  float ring = exp(-pow((r - 0.5) * 72.0, 2.0));
  float hairline = exp(-pow((r - 0.518) * 168.0, 2.0)) * 0.42;
  float rays = 0.38 + 0.62 * pow(
    max(0.0, 0.5 + 0.5 * sin(a * 46.0 + fbm(vec2(a * 7.0, r * 9.0 - uTime * 0.03)) * 9.0)),
    3.2
  );
  float haze = exp(-max(r - 0.5, 0.0) * 9.5) * (1.0 - smoothstep(0.5, 1.0, r)) * 0.24;
  float doppler = 0.72 + 0.28 * cos(a + 2.1);

  vec3 ember = vec3(1.0, 0.37, 0.09);
  vec3 bone = vec3(1.0, 0.84, 0.58);
  vec3 col = mix(ember, bone, clamp(ring * 0.95 + hairline * 0.5, 0.0, 1.0));

  float alpha = (ring * 0.82 + hairline * 0.7 + haze) * rays * doppler * uIntensity;
  alpha *= smoothstep(0.0, 0.02, r);
  gl_FragColor = vec4(col, alpha);
}
`;

export const haloVertex = coronaVertex;

export const haloFragment = /* glsl */ `
${NOISE_2D}

varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float n = fbm(vec2(a * 5.0, r * 4.0 - uTime * 0.01));

  float aura = exp(-pow(r * 2.15, 1.55)) * 0.17;
  float outerRing = exp(-pow((r - 0.68) * 20.0, 2.0)) * 0.065;
  float fan = pow(max(0.0, 0.5 + 0.5 * sin(a * 18.0 + n * 8.0 + uTime * 0.02)), 5.0) * exp(-r * 1.6) * 0.06;
  float alpha = (aura + outerRing + fan) * uIntensity * smoothstep(0.0, 0.05, r);

  vec3 col = mix(vec3(0.35, 0.60, 0.95), vec3(1.0, 0.58, 0.24), 0.30 + 0.50 * n);
  gl_FragColor = vec4(col, alpha);
}
`;

export const vortexVertex = /* glsl */ `
varying vec2 vP;

void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const vortexFragment = /* glsl */ `
${NOISE_2D}

varying vec2 vP;
uniform float uTime;
uniform float uIntensity;
uniform float uInner;
uniform float uOuter;

void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float t = uTime * 0.115;

  float n = fbm(vec2(a * 2.2 + r * 0.20 - t * 2.0, r * 0.42 + t * 0.55));
  float spiral = 0.5 + 0.5 * sin(a * 3.0 + r * 0.62 - t * 4.1 + n * 5.5);
  float arms = pow(max(0.0, spiral), 5.0);
  float fine = pow(max(0.0, 0.5 + 0.5 * sin(a * 13.0 + r * 1.15 - t * 6.0 + n * 8.0)), 3.0) * 0.35;
  float mask = smoothstep(uInner, uInner + 2.0, r) * (1.0 - smoothstep(uOuter - 9.0, uOuter, r));
  float inner = exp(-pow((r - uInner - 0.25) / 0.85, 2.0));

  vec3 ember = vec3(1.0, 0.24, 0.045);
  vec3 gold = vec3(1.0, 0.66, 0.30);
  vec3 ice = vec3(0.22, 0.52, 0.92);
  vec3 col = mix(ember, gold, arms * 0.62 + inner * 0.32);
  col += ice * pow(max(0.0, 1.0 - smoothstep(uInner + 2.0, uOuter, r)), 2.2) * 0.13;

  float alpha = (arms * 0.34 + fine * 0.24 + n * 0.08 + inner * 0.72) * mask * uIntensity * 0.44;
  gl_FragColor = vec4(col, alpha);
}
`;

export const seaVertex = /* glsl */ `
varying vec2 vP;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vP = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const seaFragment = /* glsl */ `
${NOISE_2D}

varying vec2 vP;
uniform float uTime;
uniform float uPulse;
uniform float uPulseAmp;

void main() {
  float r = length(vP);
  float t = uTime;
  float n = fbm(vP * 0.020 + vec2(t * 0.004, -t * 0.003));
  float ripple = sin(r * 0.46 - t * 0.30 + n * 5.2);
  float line = smoothstep(0.88, 1.0, ripple) * exp(-r * 0.016) * 0.052;
  float glow = exp(-r * 0.040) * 0.085;

  float pulseR = max(uPulse, 0.0001) * 110.0;
  float pulse = exp(-pow((r - pulseR) / (3.0 + uPulse * 2.5), 2.0)) * uPulseAmp;

  float sparkle = step(0.9978, hash12(floor(vP * 1.8)))
    * (0.35 + 0.65 * sin(t * 1.6 + hash12(floor(vP * 1.8)) * 30.0));

  vec3 col = vec3(0.0032, 0.0068, 0.0135);
  col += vec3(0.050, 0.078, 0.115) * n * 0.30;
  col += vec3(0.62, 0.31, 0.11) * (glow + line) * 0.52;
  col += vec3(1.0, 0.56, 0.24) * pulse * 0.68;
  col += vec3(0.50, 0.68, 0.95) * sparkle * 0.34;

  float alpha = 1.0 - smoothstep(120.0, 220.0, r);
  gl_FragColor = vec4(col, alpha * 0.72);
}
`;

export const ringEngraveVertex = /* glsl */ `
varying vec2 vP;

void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringEngraveFragment = /* glsl */ `
${NOISE_2D}

varying vec2 vP;
uniform float uSeed;
uniform float uOpacity;
uniform float uTicks;
uniform float uInner;
uniform float uOuter;

void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float u = (r - uInner) / (uOuter - uInner);

  if (u < 0.0 || u > 1.0) discard;

  float seg = (a / 6.2831853 + 0.5) * uTicks + uSeed;
  float f = fract(seg);
  float idx = floor(seg);
  float tickMask = 1.0 - smoothstep(0.018, 0.085, min(f, 1.0 - f));

  float m = mod(idx, 5.0);
  float major = 1.0 - step(0.5, min(m, 5.0 - m));
  float len = mix(0.30, 0.66, major);
  float ticks = tickMask * smoothstep(1.0 - len - 0.015, 1.0 - len, u) * (1.0 - smoothstep(0.993, 1.0, u));

  float groove = 0.0;
  groove += 1.0 - smoothstep(0.0, 0.018, abs(u - 0.085));
  groove += 1.0 - smoothstep(0.0, 0.014, abs(u - 0.50));
  groove += 1.0 - smoothstep(0.0, 0.014, abs(u - 0.86));

  float damage = step(0.055, hash12(vec2(idx, uSeed * 17.0)));
  float wear = 0.55 + 0.45 * vnoise(vec2(a * 18.0, u * 5.0 + uSeed * 9.0));

  vec3 col = mix(vec3(0.38, 0.55, 0.82), vec3(1.0, 0.80, 0.52), ticks);
  float alpha = (ticks * 0.92 + groove * 0.20) * damage * wear * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

export const inflowVertex = /* glsl */ `
attribute float aSeed;
attribute float aAngle;
attribute float aRadius;
attribute float aZ;
attribute float aSpeed;
attribute float aSize;
attribute float aTint;

uniform float uTime;
uniform float uPixelRatio;
uniform float uCollapse;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float motion = uTime * (0.024 + aSpeed * 0.042) * (1.0 + uCollapse * 4.5);
  float life = fract(aSeed + motion);

  float radius = mix(aRadius, 7.35, pow(life, 1.55));
  float angle = aAngle + (1.0 - life) * (0.45 + aTint * 1.15) + uTime * 0.012;
  float z = aZ * (1.0 - life * 0.9) + sin(uTime * 0.22 + aSeed * 31.0) * 0.22;

  vec3 p = vec3(cos(angle) * radius, sin(angle) * radius, z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  gl_PointSize = aSize * uPixelRatio * (92.0 / max(-mv.z, 1.0));

  float warm = pow(1.0 - life, 2.2);
  vColor = mix(vec3(0.45, 0.72, 1.0), vec3(1.0, 0.45, 0.13), warm);
  vColor += vec3(1.0, 0.86, 0.68) * pow(max(0.0, 1.0 - smoothstep(0.0, 0.18, life)), 2.0) * 0.65;
  vAlpha = smoothstep(0.0, 0.09, life) * (1.0 - smoothstep(0.84, 1.0, life));
  vAlpha *= 0.30 + aTint * 0.28;
  vAlpha *= 1.0 + uCollapse * 0.35;
}
`;

export const inflowFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.02, d);
  float glow = smoothstep(0.5, 0.16, d) * 0.32;
  float alpha = (core + glow) * vAlpha;
  gl_FragColor = vec4(vColor * 1.22, alpha * 0.70);
}
`;

export const moteVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.055 + aPhase * 12.0) * 1.8;
  p.y += cos(uTime * 0.043 + aPhase * 9.0) * 1.4;
  p.z += sin(uTime * 0.037 + aPhase * 17.0) * 1.2;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (72.0 / max(-mv.z, 1.0));

  vColor = aColor;
  vAlpha = 0.30 + 0.70 * pow(0.5 + 0.5 * sin(uTime * 0.32 + aPhase * 20.0), 2.0);
}
`;

export const moteFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, d) * vAlpha;
  gl_FragColor = vec4(vColor, a * 0.52);
}
`;

export const finalPassShader = {
  uniforms: {
    tDiffuse: { value: null as null | unknown },
    uTime: { value: 0 },
    uResolution: { value: [1, 1] },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
${NOISE_2D}

uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uFlash;
varying vec2 vUv;

void main() {
  vec2 fromCenter = vUv - 0.5;
  float d = length(fromCenter);
  float ca = 0.0016 * d * d;

  vec3 col;
  col.r = texture2D(tDiffuse, vUv + fromCenter * ca).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - fromCenter * ca).b;

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.86, 0.95, 1.14), smoothstep(0.30, 0.0, luma) * 0.42);
  col = mix(col, col * vec3(1.06, 1.01, 0.94), smoothstep(0.55, 1.0, luma) * 0.25);

  float grain = hash12(vUv * uResolution + vec2(fract(uTime) * 311.7));
  col += (grain - 0.5) * 0.026;
  col += uFlash * vec3(1.0, 0.76, 0.48) * 0.10;

  float vig = smoothstep(0.92, 0.38, d);
  col *= mix(0.50, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`,
};
