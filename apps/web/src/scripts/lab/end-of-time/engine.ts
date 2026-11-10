import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  coronaFragment,
  coronaVertex,
  finalPassShader,
  haloFragment,
  inflowFragment,
  inflowVertex,
  moteFragment,
  moteVertex,
  ringEngraveFragment,
  ringEngraveVertex,
  seaFragment,
  seaVertex,
  skyFragment,
  skyVertex,
  starFragment,
  starVertex,
  vortexFragment,
  vortexVertex,
} from "./shaders";

const TAU = Math.PI * 2;

export interface EndOfTimeTelemetry {
  dilation: number;
  distance: number;
  energy: number;
  paused: boolean;
  fps: number;
}

export interface EndOfTimeOptions {
  reducedMotion?: boolean;
  onReady?: () => void;
  onTelemetry?: (telemetry: EndOfTimeTelemetry) => void;
  onError?: (message: string) => void;
}

export interface EndOfTimeHandle {
  collapse: () => void;
  setPaused: (paused: boolean) => void;
  resetView: () => void;
  dispose: () => void;
}

interface ShardDatum {
  r: number;
  a: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  phase: number;
  drift: number;
}

interface RingHandle {
  group: THREE.Group;
  speed: number;
}

interface ShardSystem {
  mesh: THREE.InstancedMesh;
  data: ShardDatum[];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建环境贴图画布");

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, "#030817");
  vertical.addColorStop(0.38, "#07152c");
  vertical.addColorStop(0.53, "#07101f");
  vertical.addColorStop(0.62, "#150a05");
  vertical.addColorStop(1, "#010205");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const horizon = ctx.createLinearGradient(0, 238, 0, 342);
  horizon.addColorStop(0, "rgba(68,42,20,0)");
  horizon.addColorStop(0.52, "rgba(152,83,30,0.55)");
  horizon.addColorStop(1, "rgba(20,8,3,0)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 220, canvas.width, 140);

  const warm = ctx.createRadialGradient(230, 185, 4, 230, 185, 250);
  warm.addColorStop(0, "rgba(255,220,164,0.62)");
  warm.addColorStop(0.18, "rgba(255,164,78,0.32)");
  warm.addColorStop(0.62, "rgba(118,52,12,0.10)");
  warm.addColorStop(1, "rgba(8,4,2,0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, 620, 512);

  const cool = ctx.createRadialGradient(820, 320, 8, 820, 320, 280);
  cool.addColorStop(0, "rgba(140,198,255,0.36)");
  cool.addColorStop(0.42, "rgba(36,98,170,0.14)");
  cool.addColorStop(1, "rgba(2,8,18,0)");
  ctx.fillStyle = cool;
  ctx.fillRect(420, 0, 604, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  texture.dispose();
  return target.texture;
}

function makeClockFaceTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建表盘画布");
  const c = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "butt";

  ctx.strokeStyle = "rgba(224,210,182,0.22)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c - 28, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "rgba(224,210,182,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 318, 0, TAU);
  ctx.stroke();

  for (let i = 0; i < 60; i++) {
    const angle = -Math.PI / 2 + (i / 60) * TAU;
    const major = i % 5 === 0;
    const inner = c - (major ? 108 : 68);
    const outer = c - 40;
    ctx.strokeStyle = major ? "rgba(240,224,192,0.46)" : "rgba(210,198,176,0.22)";
    ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
    ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(242,229,203,0.52)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '500 116px "Times New Roman", "Songti SC", serif';
  const numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  numerals.forEach((numeral, index) => {
    const angle = -Math.PI / 2 + (index / 12) * TAU;
    const radius = c - 205;
    ctx.fillText(numeral, c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
  });

  ctx.strokeStyle = "rgba(132,170,210,0.12)";
  ctx.lineWidth = 2;
  const cracks = [
    { angle: -0.62, length: 780 },
    { angle: 1.44, length: 640 },
    { angle: 3.72, length: 820 },
  ];
  for (const crack of cracks) {
    ctx.beginPath();
    let x = c + Math.cos(crack.angle) * 300;
    let y = c + Math.sin(crack.angle) * 300;
    ctx.moveTo(x, y);
    for (let step = 1; step <= 9; step++) {
      const radius = 300 + (crack.length * step) / 9;
      const wobble = Math.sin(step * 4.7 + crack.angle * 5) * 25;
      x = c + Math.cos(crack.angle) * radius - Math.sin(crack.angle) * wobble;
      y = c + Math.sin(crack.angle) * radius + Math.cos(crack.angle) * wobble;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeGlowMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: coronaVertex,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function buildStarField(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const palette = [
    new THREE.Color("#cfe4ff"),
    new THREE.Color("#9fc4f2"),
    new THREE.Color("#ffe2b8"),
    new THREE.Color("#f4f7ff"),
  ];

  for (let i = 0; i < count; i++) {
    const radius = randomBetween(250, 390);
    const theta = Math.random() * TAU;
    const cosPhi = randomBetween(-0.75, 1);
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    positions[i * 3] = Math.cos(theta) * sinPhi * radius;
    positions[i * 3 + 1] = cosPhi * radius * 0.72 - 15;
    positions[i * 3 + 2] = Math.sin(theta) * sinPhi * radius;
    sizes[i] = Math.random() < 0.03 ? randomBetween(1.9, 2.9) : randomBetween(0.5, 1.35);
    phases[i] = Math.random();
    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return points;
}

function buildMotes(count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const palette = [
    new THREE.Color("#8fc4ef"),
    new THREE.Color("#f4e4c8"),
    new THREE.Color("#f0a66a"),
    new THREE.Color("#d6ecff"),
  ];

  for (let i = 0; i < count; i++) {
    positions[i * 3] = randomBetween(-110, 110);
    positions[i * 3 + 1] = randomBetween(-38, 82);
    positions[i * 3 + 2] = randomBetween(-90, 90);
    sizes[i] = randomBetween(0.35, 1.2);
    phases[i] = Math.random();
    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 12;
  return points;
}

function buildInflow(count: number): THREE.Points {
  const seeds = new Float32Array(count);
  const angles = new Float32Array(count);
  const radii = new Float32Array(count);
  const heights = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count);
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random();
    const clustered = Math.random() < 0.72;
    angles[i] = clustered
      ? (Math.floor(Math.random() * 3) / 3) * TAU + randomBetween(-0.24, 0.24)
      : Math.random() * TAU;
    radii[i] = 8.4 + Math.pow(Math.random(), 0.62) * 30;
    heights[i] = randomBetween(-1, 1) * (0.9 + (radii[i] - 8) * 0.14);
    speeds[i] = randomBetween(0.55, 1.5);
    sizes[i] = Math.random() < 0.025 ? randomBetween(1.8, 2.6) : randomBetween(0.45, 1.35);
    tints[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute("aZ", new THREE.BufferAttribute(heights, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aTint", new THREE.BufferAttribute(tints, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: inflowVertex,
    fragmentShader: inflowFragment,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uCollapse: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;
  return points;
}

function makeShardSystem(
  count: number,
  material: THREE.Material,
): ShardSystem {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const data: ShardDatum[] = [];
  for (let i = 0; i < count; i++) {
    data.push({
      r: randomBetween(10.5, 40),
      a: Math.random() * TAU,
      z: randomBetween(-13, 12),
      sx: randomBetween(0.055, 0.22),
      sy: randomBetween(0.025, 0.08),
      sz: randomBetween(0.45, 2.55),
      rx: Math.random() * TAU,
      ry: Math.random() * TAU,
      rz: Math.random() * TAU,
      vx: randomBetween(-0.11, 0.11),
      vy: randomBetween(-0.14, 0.14),
      vz: randomBetween(-0.09, 0.09),
      speed: randomBetween(-0.014, 0.014),
      phase: Math.random() * TAU,
      drift: randomBetween(0.15, 0.9),
    });
  }

  return { mesh, data };
}

function setShardMatrices(system: ShardSystem, time: number, energy: number): void {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < system.data.length; i++) {
    const d = system.data[i];
    const angle = d.a + time * d.speed;
    const radius = d.r + Math.sin(time * 0.16 + d.phase) * d.drift;
    dummy.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      d.z + Math.cos(time * 0.12 + d.phase) * 0.45,
    );
    dummy.rotation.set(
      d.rx + time * d.vx,
      d.ry + time * d.vy,
      d.rz + time * d.vz,
    );
    const scale = 1 + energy * 0.08;
    dummy.scale.set(d.sx * scale, d.sy * scale, d.sz * scale);
    dummy.updateMatrix();
    system.mesh.setMatrixAt(i, dummy.matrix);
  }
  system.mesh.instanceMatrix.needsUpdate = true;
}

function makeHandGeometry(length: number, width: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width, 0);
  shape.lineTo(-width * 0.78, length * 0.82);
  shape.lineTo(-width * 0.16, length * 0.96);
  shape.lineTo(0, length);
  shape.lineTo(width * 0.16, length * 0.96);
  shape.lineTo(width * 0.78, length * 0.82);
  shape.lineTo(width, 0);
  shape.lineTo(width * 0.22, -width * 2.2);
  shape.lineTo(-width * 0.22, -width * 2.2);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.035,
    bevelSegments: 2,
    steps: 1,
  });
}

export function createEndOfTime(
  canvas: HTMLCanvasElement,
  options: EndOfTimeOptions = {},
): EndOfTimeHandle {
  const parent = canvas.parentElement ?? canvas;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const reducedMotion = options.reducedMotion ?? false;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setClearColor(0x02040a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02040a, 0.0015);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  const clockGroup = new THREE.Group();
  clockGroup.position.set(0, 6, 0);
  scene.add(clockGroup);

  const envTexture = makeEnvironmentMap(renderer);
  scene.environment = envTexture;
  scene.environmentIntensity = 1.05;

  const disposables: Array<{ dispose: () => void }> = [envTexture];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Material>(material: T): T => {
    materials.push(material);
    return material;
  };
  const trackGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };

  // ---------- sky ----------
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: { uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(420, 48, 32)), skyMaterial);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);
  track(skyMaterial);

  const starCount = coarsePointer ? 2000 : 3200;
  const stars = buildStarField(starCount);
  const starMaterial = stars.material as THREE.ShaderMaterial;
  trackGeometry(stars.geometry);
  track(starMaterial);
  scene.add(stars);

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight(0x27486f, 0x040202, 0.62));

  const keyLight = new THREE.DirectionalLight(0xffc08a, 3.1);
  keyLight.position.set(28, 42, 46);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x5f9fdf, 2.8);
  rimLight.position.set(-55, 26, 34);
  scene.add(rimLight);

  const coreLight = new THREE.PointLight(0xff7a30, 210, 110, 2);
  coreLight.position.set(0, 0, 0);
  clockGroup.add(coreLight);

  // ---------- the black sun ----------
  const sunMaterial = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = clamp(1.0 - abs(dot(vNormal, vView)), 0.0, 1.0);
        float rim = pow(facing, 4.2);
        vec3 col = vec3(0.0);
        col += vec3(1.0, 0.34, 0.08) * rim * 0.24;
        col += vec3(0.20, 0.42, 0.78) * pow(facing, 8.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    fog: false,
  });
  const sun = new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(7, 64, 48)), sunMaterial);
  sun.renderOrder = 2;
  clockGroup.add(sun);
  track(sunMaterial);

  const coronaMaterial = makeGlowMaterial(coronaFragment, {
    uTime: { value: 0 },
    uIntensity: { value: 0.9 },
  });
  const corona = new THREE.Mesh(
    trackGeometry(new THREE.PlaneGeometry(34, 34)),
    coronaMaterial,
  );
  corona.renderOrder = 4;
  clockGroup.add(corona);
  track(coronaMaterial);

  const haloMaterial = makeGlowMaterial(haloFragment, {
    uTime: { value: 0 },
    uIntensity: { value: 0.52 },
  });
  const halo = new THREE.Mesh(
    trackGeometry(new THREE.PlaneGeometry(82, 82)),
    haloMaterial,
  );
  halo.renderOrder = 1;
  clockGroup.add(halo);
  track(haloMaterial);

  // ---------- the ghost clock face ----------
  const clockFaceTexture = makeClockFaceTexture(renderer);
  disposables.push(clockFaceTexture);
  const clockFaceMaterial = new THREE.MeshBasicMaterial({
    map: clockFaceTexture,
    transparent: true,
    opacity: 0.33,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const clockFace = new THREE.Mesh(
    trackGeometry(new THREE.PlaneGeometry(66, 66)),
    clockFaceMaterial,
  );
  clockFace.position.z = -1.4;
  clockFace.renderOrder = 1;
  clockGroup.add(clockFace);
  track(clockFaceMaterial);

  // ---------- the chronal vortex ----------
  const vortexMaterial = new THREE.ShaderMaterial({
    vertexShader: vortexVertex,
    fragmentShader: vortexFragment,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uInner: { value: 8.35 },
      uOuter: { value: 27.5 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const vortex = new THREE.Mesh(
    trackGeometry(new THREE.RingGeometry(8.35, 27.5, 256, 1)),
    vortexMaterial,
  );
  vortex.rotation.x = -Math.PI / 2 + 0.24;
  vortex.rotation.z = 0.1;
  vortex.renderOrder = 3;
  clockGroup.add(vortex);
  track(vortexMaterial);

  const vortexEchoMaterial = new THREE.ShaderMaterial({
    vertexShader: vortexVertex,
    fragmentShader: vortexFragment,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.22 },
      uInner: { value: 9.2 },
      uOuter: { value: 34 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const vortexEcho = new THREE.Mesh(
    trackGeometry(new THREE.RingGeometry(9.2, 34, 256, 1)),
    vortexEchoMaterial,
  );
  vortexEcho.rotation.x = -Math.PI / 2 - 0.42;
  vortexEcho.rotation.y = 0.3;
  vortexEcho.renderOrder = 2;
  clockGroup.add(vortexEcho);
  track(vortexEchoMaterial);

  // ---------- rings ----------
  const ringMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x46351f,
    metalness: 1,
    roughness: 0.23,
    envMapIntensity: 1.5,
    emissive: 0x070301,
    emissiveIntensity: 1,
  }));
  const ringMaterialPale = track(new THREE.MeshStandardMaterial({
    color: 0x55422a,
    metalness: 1,
    roughness: 0.28,
    envMapIntensity: 1.15,
    emissive: 0x090502,
    emissiveIntensity: 1,
  }));
  const darkMetalMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x17110a,
    metalness: 1,
    roughness: 0.24,
    envMapIntensity: 1.45,
    emissive: 0x050301,
    emissiveIntensity: 1,
  }));

  const tickMaterial = track(new THREE.MeshStandardMaterial({
    color: 0xb08a4e,
    metalness: 1,
    roughness: 0.28,
    envMapIntensity: 1.8,
    emissive: 0x3b2108,
    emissiveIntensity: 1.15,
  }));

  const rings: RingHandle[] = [];

  function addRing(config: {
    radius: number;
    tube: number;
    arcs: Array<[number, number]>;
    z: number;
    speed: number;
    ticks: number;
    seed: number;
    pale?: boolean;
    tiltX?: number;
    tiltY?: number;
  }): void {
    const group = new THREE.Group();
    group.position.z = config.z;
    group.rotation.x = config.tiltX ?? 0;
    group.rotation.y = config.tiltY ?? 0;

    const material = config.pale ? ringMaterialPale : ringMaterial;
    for (const [start, length] of config.arcs) {
      const torus = new THREE.Mesh(
        trackGeometry(new THREE.TorusGeometry(config.radius, config.tube, 10, 260, length)),
        material,
      );
      torus.rotation.z = start;
      group.add(torus);

      const overlayMaterial = new THREE.ShaderMaterial({
        vertexShader: ringEngraveVertex,
        fragmentShader: ringEngraveFragment,
        uniforms: {
          uSeed: { value: config.seed },
          uOpacity: { value: config.pale ? 0.38 : 0.68 },
          uTicks: { value: config.ticks },
          uInner: { value: config.radius - config.tube - 0.48 },
          uOuter: { value: config.radius + config.tube + 0.48 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const overlay = new THREE.Mesh(
        trackGeometry(new THREE.RingGeometry(
          config.radius - config.tube - 0.48,
          config.radius + config.tube + 0.48,
          260,
          1,
          start,
          length,
        )),
        overlayMaterial,
      );
      overlay.position.z = config.tube + 0.06;
      overlay.rotation.z = 0;
      group.add(overlay);
      track(overlayMaterial);
    }

    const tickCounts = config.arcs.map(([, length]) => Math.round((config.ticks * length) / TAU));
    const tickCount = Math.max(1, tickCounts.reduce((sum, count) => sum + count, 0));
    const tickGeo = trackGeometry(new THREE.BoxGeometry(0.06, 0.72, 0.12));
    const ticks = new THREE.InstancedMesh(tickGeo, tickMaterial, tickCount);
    ticks.frustumCulled = false;
    const dummy = new THREE.Object3D();
    let index = 0;
    config.arcs.forEach(([start, length], arcIndex) => {
      const count = Math.max(1, tickCounts[arcIndex]);
      for (let i = 0; i < count; i++) {
        const angle = start + ((i + 0.5) / count) * length;
        const major = i % 5 === 0;
        dummy.position.set(
          Math.cos(angle) * config.radius,
          Math.sin(angle) * config.radius,
          config.tube + 0.09,
        );
        dummy.rotation.set(0, 0, angle - Math.PI / 2);
        dummy.scale.set(1, major ? 1.8 : 1, 1);
        if (Math.random() < 0.028) dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        ticks.setMatrixAt(index++, dummy.matrix);
      }
    });
    ticks.count = index;
    group.add(ticks);

    clockGroup.add(group);
    rings.push({ group, speed: config.speed });
  }

  addRing({
    radius: 12.4,
    tube: 0.22,
    arcs: [[0.22, TAU * 0.97]],
    z: 0.5,
    speed: -0.035,
    ticks: 60,
    seed: 0.17,
    pale: true,
  });
  addRing({
    radius: 18.6,
    tube: 0.36,
    arcs: [[0.7, TAU * 0.58], [2.85, TAU * 0.26]],
    z: -1.1,
    speed: 0.022,
    ticks: 60,
    seed: 0.53,
    tiltX: 0.09,
    tiltY: -0.08,
  });
  addRing({
    radius: 25.7,
    tube: 0.20,
    arcs: [[2.35, TAU * 0.88]],
    z: -2.4,
    speed: -0.014,
    ticks: 72,
    seed: 0.81,
    pale: true,
    tiltX: -0.06,
    tiltY: 0.05,
  });
  addRing({
    radius: 32.6,
    tube: 0.09,
    arcs: [[0.35, TAU * 0.43], [3.4, TAU * 0.38]],
    z: -3.4,
    speed: 0.008,
    ticks: 96,
    seed: 0.34,
    pale: true,
    tiltX: 0.14,
    tiltY: -0.1,
  });

  // A second celestial axis, almost edge-on.
  const armillary = new THREE.Group();
  const armillaryMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x4d3a22,
    metalness: 1,
    roughness: 0.3,
    envMapIntensity: 1.2,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  }));
  const armA = new THREE.Mesh(
    trackGeometry(new THREE.TorusGeometry(29.5, 0.065, 6, 280)),
    armillaryMaterial,
  );
  armA.rotation.x = 1.18;
  armA.rotation.y = 0.38;
  armillary.add(armA);
  const armB = new THREE.Mesh(
    trackGeometry(new THREE.TorusGeometry(22.8, 0.05, 6, 240)),
    armillaryMaterial,
  );
  armB.rotation.y = Math.PI / 2 + 0.22;
  armB.rotation.x = 0.24;
  armillary.add(armB);
  clockGroup.add(armillary);

  // ---------- hands ----------
  const handMaterial = darkMetalMaterial;

  const longHand = new THREE.Group();
  longHand.position.z = 2.1;
  const longHandMesh = new THREE.Mesh(makeHandGeometry(21.5, 0.62), handMaterial);
  (longHandMesh.geometry as THREE.BufferGeometry).computeVertexNormals();
  trackGeometry(longHandMesh.geometry);
  longHand.add(longHandMesh);
  const longEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(longHandMesh.geometry, 25),
    new THREE.LineBasicMaterial({
      color: 0xf0c987,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  longHand.add(longEdge);
  const handFragments: THREE.Mesh[] = [];
  const fragmentMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x50391c,
    metalness: 1,
    roughness: 0.22,
    envMapIntensity: 1.8,
    emissive: 0x150a02,
  }));
  for (let i = 0; i < 7; i++) {
    const fragment = new THREE.Mesh(
      trackGeometry(new THREE.OctahedronGeometry(1, 0)),
      fragmentMaterial,
    );
    const distance = 22.7 + i * 1.02 + Math.random() * 0.3;
    fragment.position.set((Math.random() - 0.5) * 0.3, distance, (Math.random() - 0.5) * 0.4);
    fragment.scale.set(0.09, 0.028, randomBetween(0.55, 1.7) * (1 - i * 0.07));
    fragment.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    fragment.userData.spin = randomBetween(-0.2, 0.2);
    longHand.add(fragment);
    handFragments.push(fragment);
  }
  clockGroup.add(longHand);

  const shortHand = new THREE.Group();
  shortHand.position.z = 2.55;
  const shortHandMesh = new THREE.Mesh(makeHandGeometry(13.2, 0.78), handMaterial);
  trackGeometry(shortHandMesh.geometry);
  shortHand.add(shortHandMesh);
  const shortEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(shortHandMesh.geometry, 25),
    new THREE.LineBasicMaterial({
      color: 0xe8c68c,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  shortHand.add(shortEdge);
  clockGroup.add(shortHand);

  // ---------- shards ----------
  const goldShardMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x5a4220,
    metalness: 1,
    roughness: 0.17,
    envMapIntensity: 2.2,
    emissive: 0x140a02,
    flatShading: true,
  }));
  const iceShardMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x2b435a,
    metalness: 0.92,
    roughness: 0.1,
    envMapIntensity: 2.1,
    emissive: 0x03101c,
    flatShading: true,
  }));
  const shardSystems: ShardSystem[] = [];
  const shardTotal = coarsePointer ? 170 : 280;
  shardSystems.push(makeShardSystem(Math.round(shardTotal * 0.62), goldShardMaterial));
  shardSystems.push(makeShardSystem(Math.round(shardTotal * 0.38), iceShardMaterial));
  for (const system of shardSystems) {
    trackGeometry(system.mesh.geometry);
    system.mesh.renderOrder = 6;
    clockGroup.add(system.mesh);
    setShardMatrices(system, 0, 0);
  }

  // ---------- distant sentinels ----------
  const sentinelGroup = new THREE.Group();
  const sentinelMaterial = darkMetalMaterial;
  const sentinelGeometry = trackGeometry(new THREE.BoxGeometry(0.42, 1, 0.42));
  const sentinelCount = coarsePointer ? 5 : 7;
  const sentinels = new THREE.InstancedMesh(sentinelGeometry, sentinelMaterial, sentinelCount);
  sentinels.frustumCulled = false;
  const tipMaterial = track(new THREE.MeshStandardMaterial({
    color: 0x1a1207,
    metalness: 0.2,
    roughness: 0.5,
    emissive: 0xff9a4a,
    emissiveIntensity: 2.4,
  }));
  const sentinelTips = new THREE.InstancedMesh(
    trackGeometry(new THREE.BoxGeometry(0.075, 0.075, 0.075)),
    tipMaterial,
    sentinelCount,
  );
  sentinelTips.frustumCulled = false;
  const sentinelDummy = new THREE.Object3D();
  for (let i = 0; i < sentinelCount; i++) {
    const angle = (i / sentinelCount) * TAU + 0.3;
    const radius = randomBetween(51, 59);
    const height = randomBetween(3.2, 7.4);
    const y = randomBetween(-1.2, 2.2);
    sentinelDummy.position.set(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius * 0.82,
    );
    sentinelDummy.rotation.set(0.04, -angle, randomBetween(-0.05, 0.05));
    sentinelDummy.scale.set(randomBetween(0.5, 1.2), height, randomBetween(0.5, 1.2));
    sentinelDummy.updateMatrix();
    sentinels.setMatrixAt(i, sentinelDummy.matrix);

    sentinelDummy.position.y = y + height / 2;
    sentinelDummy.rotation.set(0, 0, 0);
    sentinelDummy.scale.setScalar(1);
    sentinelDummy.updateMatrix();
    sentinelTips.setMatrixAt(i, sentinelDummy.matrix);
  }
  sentinelGroup.add(sentinels);
  sentinelGroup.add(sentinelTips);
  clockGroup.add(sentinelGroup);

  // ---------- the sea of spent time ----------
  const seaMaterial = new THREE.ShaderMaterial({
    vertexShader: seaVertex,
    fragmentShader: seaFragment,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPulseAmp: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const sea = new THREE.Mesh(
    trackGeometry(new THREE.PlaneGeometry(540, 540)),
    seaMaterial,
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -29;
  sea.renderOrder = 0;
  scene.add(sea);
  track(seaMaterial);

  // ---------- particles ----------
  const inflow = buildInflow(coarsePointer ? 3600 : 7200);
  const inflowMaterial = inflow.material as THREE.ShaderMaterial;
  clockGroup.add(inflow);
  trackGeometry(inflow.geometry);
  track(inflowMaterial);

  const motes = buildMotes(coarsePointer ? 420 : 800);
  const moteMaterial = motes.material as THREE.ShaderMaterial;
  scene.add(motes);
  trackGeometry(motes.geometry);
  track(moteMaterial);

  // ---------- post ----------
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: coarsePointer ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.72, 0.87);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const finalPass = new ShaderPass(finalPassShader as unknown as THREE.ShaderMaterialParameters);
  composer.addPass(finalPass);

  // ---------- camera / interaction ----------
  const lookTarget = new THREE.Vector3();
  let baseRadius = 96;
  let targetTheta = 0;
  let theta = 0;
  let targetPhi = 1.33;
  let phi = 1.33;
  let targetRadius = 104;
  let radius = 104;
  let userZoomed = false;
  let intro = reducedMotion ? 1 : 0;
  let paused = reducedMotion;
  let collapseEnergy = 0;
  let flash = 0;
  let elapsed = 0;
  let pulseStarted = -10;
  let pulseAmp = 0;
  let dragging = false;
  let moved = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let tapStartedAt = 0;
  let activePointer: number | null = null;
  const touchPoints = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let disposed = false;

  let width = 1;
  let height = 1;
  let dpr = 1;
  let qualityCap = coarsePointer ? 1.5 : 1.75;
  let lowFpsChecks = 0;

  function idealRadius(): number {
    const aspect = width / Math.max(height, 1);
    if (aspect < 0.7) return 132;
    if (aspect < 1.0) return 118;
    return 104;
  }

  function resize(): void {
    const rect = parent.getBoundingClientRect();
    width = Math.max(1, rect.width || window.innerWidth);
    height = Math.max(1, rect.height || window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, qualityCap);

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloomPass.setSize(width * dpr, height * dpr);

    const pixelRatio = renderer.getPixelRatio();
    (finalPass.uniforms.uResolution.value as number[])[0] = width * pixelRatio;
    (finalPass.uniforms.uResolution.value as number[])[1] = height * pixelRatio;

    const aspect = width / height;
    lookTarget.set(aspect >= 1.05 ? -17.5 : 0, 5.5, 0);
    baseRadius = idealRadius();
    if (!userZoomed) targetRadius = baseRadius;
    if (intro >= 1) radius = targetRadius;

    const pixel = renderer.getPixelRatio();
    starMaterial.uniforms.uPixelRatio.value = pixel;
    inflowMaterial.uniforms.uPixelRatio.value = pixel;
    moteMaterial.uniforms.uPixelRatio.value = pixel;
  }

  function collapse(): void {
    if (paused) paused = false;
    collapseEnergy = Math.min(1.35, collapseEnergy + 1.0);
    flash = 1;
    pulseStarted = elapsed;
    pulseAmp = Math.min(1.0, pulseAmp + 0.9);
    targetRadius = Math.max(58, targetRadius * 0.988);
  }

  function setPaused(value: boolean): void {
    paused = value;
  }

  function resetView(): void {
    targetTheta = 0;
    targetPhi = 1.33;
    targetRadius = baseRadius;
    userZoomed = false;
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2) {
      const points = [...touchPoints.values()];
      pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      dragging = true;
      moved = true;
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    activePointer = event.pointerId;
    dragging = true;
    moved = false;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    tapStartedAt = performance.now();
    parent.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!touchPoints.has(event.pointerId)) return;
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (touchPoints.size === 2) {
      const points = [...touchPoints.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchDistance > 0) {
        targetRadius *= pinchDistance / Math.max(distance, 1);
        targetRadius = THREE.MathUtils.clamp(targetRadius, 54, 185);
        userZoomed = true;
      }
      pinchDistance = distance;
      return;
    }

    if (!dragging || event.pointerId !== activePointer) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;

    targetTheta -= dx * 0.0042;
    targetPhi = THREE.MathUtils.clamp(targetPhi + dy * 0.0028, 0.40, 1.50);
  };

  const releasePointer = (event: PointerEvent): void => {
    touchPoints.delete(event.pointerId);
    if (touchPoints.size === 1) {
      const remaining = [...touchPoints.entries()][0];
      activePointer = remaining[0];
      lastPointerX = remaining[1].x;
      lastPointerY = remaining[1].y;
      pinchDistance = 0;
      return;
    }
    if (touchPoints.size === 0) {
      const wasClick = dragging && !moved
        && (event.pointerType !== "touch" || performance.now() - tapStartedAt < 400);
      dragging = false;
      activePointer = null;
      pinchDistance = 0;
      parent.classList.remove("is-dragging");
      if (wasClick) collapse();
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    targetRadius *= Math.exp(event.deltaY * 0.0009);
    targetRadius = THREE.MathUtils.clamp(targetRadius, 54, 185);
    userZoomed = true;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select")) return;
    if (event.key === "ArrowLeft") {
      targetTheta += 0.14;
    } else if (event.key === "ArrowRight") {
      targetTheta -= 0.14;
    } else if (event.key === "ArrowUp") {
      targetPhi = THREE.MathUtils.clamp(targetPhi - 0.07, 0.40, 1.50);
    } else if (event.key === "ArrowDown") {
      targetPhi = THREE.MathUtils.clamp(targetPhi + 0.07, 0.40, 1.50);
    } else if (event.key === "+" || event.key === "=") {
      targetRadius = THREE.MathUtils.clamp(targetRadius * 0.9, 54, 185);
      userZoomed = true;
    } else if (event.key === "-" || event.key === "_") {
      targetRadius = THREE.MathUtils.clamp(targetRadius * 1.1, 54, 185);
      userZoomed = true;
    } else {
      return;
    }
    event.preventDefault();
  };

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    paused = true;
    options.onError?.("图形上下文已丢失。刷新页面可以重新进入视界。");
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);
  window.addEventListener("keydown", onKeyDown);

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(parent);
  resize();

  // ---------- loop ----------
  let raf = 0;
  let lastTime = performance.now();
  let telemetryClock = 0;
  let fpsTime = 0;
  let fpsFrames = 0;
  let fps = 60;
  let readyCalled = false;

  const tick = (now: number): void => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (document.hidden) return;

    if (!paused) elapsed += dt;
    intro = Math.min(1, intro + dt / 4.6);
    const introEase = 1 - Math.pow(1 - intro, 3);

    collapseEnergy *= Math.exp(-dt * 0.86);
    flash *= Math.exp(-dt * 2.8);
    pulseAmp *= Math.exp(-dt * 0.62);

    theta += (targetTheta - theta) * (1 - Math.exp(-dt * 6.5));
    phi += (targetPhi - phi) * (1 - Math.exp(-dt * 6.5));
    radius += (targetRadius - radius) * (1 - Math.exp(-dt * 4.2));

    const sway = reducedMotion ? 0 : 1;
    const viewTheta = theta
      + Math.sin(elapsed * 0.071) * 0.12 * sway
      + (1 - introEase) * -0.34;
    const viewPhi = THREE.MathUtils.clamp(
      phi + Math.sin(elapsed * 0.052 + 1.4) * 0.011 * sway + (1 - introEase) * 0.12,
      0.36,
      1.52,
    );
    const viewRadius = radius + (1 - introEase) * baseRadius * 0.52;
    const shake = collapseEnergy * 0.35;
    const shakeX = Math.sin(elapsed * 63.0 + 2.1) * shake;
    const shakeY = Math.cos(elapsed * 71.0 + 0.7) * shake * 0.6;

    camera.position.set(
      lookTarget.x + viewRadius * Math.sin(viewPhi) * Math.sin(viewTheta) + shakeX,
      lookTarget.y + viewRadius * Math.cos(viewPhi) + shakeY,
      lookTarget.z + viewRadius * Math.sin(viewPhi) * Math.cos(viewTheta),
    );
    camera.lookAt(lookTarget);

    sky.position.copy(camera.position);

    // billboards must face the camera
    corona.quaternion.copy(camera.quaternion);
    halo.quaternion.copy(camera.quaternion);

    const time = elapsed;
    const energy = collapseEnergy;

    skyMaterial.uniforms.uTime.value = time;
    starMaterial.uniforms.uTime.value = time;
    starMaterial.uniforms.uPixelRatio.value = dpr;
    coronaMaterial.uniforms.uTime.value = time;
    coronaMaterial.uniforms.uIntensity.value = 0.9 + energy * 0.7;
    haloMaterial.uniforms.uTime.value = time;
    haloMaterial.uniforms.uIntensity.value = 0.52 + energy * 0.4;
    vortexMaterial.uniforms.uTime.value = time;
    vortexMaterial.uniforms.uIntensity.value = 0.82 + energy * 0.75;
    vortexEchoMaterial.uniforms.uTime.value = time;
    vortexEchoMaterial.uniforms.uIntensity.value = 0.12 + energy * 0.22;
    seaMaterial.uniforms.uTime.value = time;
    seaMaterial.uniforms.uPulse.value = THREE.MathUtils.clamp((time - pulseStarted) / 2.6, 0, 1);
    seaMaterial.uniforms.uPulseAmp.value = pulseAmp;
    inflowMaterial.uniforms.uTime.value = time;
    inflowMaterial.uniforms.uPixelRatio.value = dpr;
    inflowMaterial.uniforms.uCollapse.value = energy;
    moteMaterial.uniforms.uTime.value = time;
    moteMaterial.uniforms.uPixelRatio.value = dpr;
    finalPass.uniforms.uTime.value = time;
    finalPass.uniforms.uFlash.value = flash;

    bloomPass.strength = 0.46 + energy * 0.58;

    if (!paused) {
      const speed = 1 + energy * 6.5;
      for (const ring of rings) ring.group.rotation.z += ring.speed * speed * dt;
      longHand.rotation.z = -0.95 - time * 0.028 * speed;
      shortHand.rotation.z = 0.82 + time * 0.0105 * speed;
      for (const fragment of handFragments) {
        fragment.rotation.z += (fragment.userData.spin as number) * dt * speed;
        fragment.rotation.x += 0.12 * dt * speed;
      }
      for (const system of shardSystems) setShardMatrices(system, time, energy);
      sentinelGroup.rotation.y = time * 0.005;
      armillary.rotation.y = time * 0.008;
      armillary.rotation.z = Math.sin(time * 0.04) * 0.05;
      clockFace.rotation.z = Math.sin(time * 0.011) * 0.015;
      vortex.rotation.z = 0.1 + time * 0.006;
      vortexEcho.rotation.z = -time * 0.004;
    } else {
      for (const system of shardSystems) setShardMatrices(system, time, 0);
    }

    composer.render();

    fpsTime += dt;
    fpsFrames += 1;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsTime = 0;
      fpsFrames = 0;
    }
    telemetryClock += dt;
    if (elapsed > 5 && !paused && fps < 42) {
      lowFpsChecks += dt;
    } else {
      lowFpsChecks = 0;
    }
    if (lowFpsChecks > 2.4) {
      lowFpsChecks = 0;
      if (qualityCap > 1.2) {
        qualityCap = 1.2;
        resize();
      } else if (qualityCap > 1.0) {
        qualityCap = 1.0;
        resize();
      }
    }
    if (telemetryClock >= 0.2) {
      telemetryClock = 0;
      options.onTelemetry?.({
        dilation: 1 + energy * 5.5,
        distance: camera.position.distanceTo(lookTarget),
        energy,
        paused,
        fps,
      });
    }

    if (!readyCalled) {
      readyCalled = true;
      options.onReady?.();
    }
  };

  raf = requestAnimationFrame(tick);

  function dispose(): void {
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", releasePointer);
    canvas.removeEventListener("pointercancel", releasePointer);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    window.removeEventListener("keydown", onKeyDown);
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const item of disposables) item.dispose();
    composer.dispose();
    renderer.dispose();
  }

  return { collapse, setPaused, resetView, dispose };
}
