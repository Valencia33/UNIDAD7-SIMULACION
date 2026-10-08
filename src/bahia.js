// BAHÍA — Servida como se merece. Escena, interacción y física de la lata.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { pour, grade, FINGER } from './modelo.js';
import { createBeach, waveReach, SHORE } from './playa.js';

const POUR_TILT = 2.0; // inclinación de la lata al servir (rad)
const GAP = 0.06;      // aire a cada lado de la lata dentro de la palabra
const $ = id => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 3000);
const fill = new THREE.DirectionalLight(0xffe2c0, 1.5); fill.position.set(1, 2, 5); scene.add(fill); // luz suave de frente: el sol está detrás
const beach = createBeach(scene, renderer, camera);

const [gltf, logo, canTex] = await Promise.all([
  new GLTFLoader().loadAsync('models/lata.glb'),
  new FBXLoader().loadAsync('models/logo-bahia.fbx'),
  new THREE.TextureLoader().loadAsync('textures/lata-bahia.webp'),
]);

// Gotas de condensación: un mapa de normales hecho a mano (medias esferas) para el vidrio y la lata
function condensation(size = 512, count = 1400) {
  const h = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    const r = 1.5 + Math.random() ** 3 * 10, cx = Math.random() * size, cy = Math.random() * size;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = (x * x + y * y) / (r * r);
      if (d > 1) continue;
      const k = ((Math.floor(cy + y) + size) % size) * size + (Math.floor(cx + x) + size) % size;
      h[k] = Math.max(h[k], Math.sqrt(1 - d) * r);
    }
  }
  const at = (x, y) => h[((y + size) % size) * size + (x + size) % size];
  const img = new ImageData(size, size), n = new THREE.Vector3();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    n.set(at(x - 1, y) - at(x + 1, y), at(x, y - 1) - at(x, y + 1), 2).normalize();
    img.data.set([(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255], (y * size + x) * 4);
  }
  const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const drops = condensation();

// ---- Logo: cada isla de la malla es una letra (B, A, H, I, A) ----
function islands(geo) {
  const p = geo.attributes.position, ids = new Map(), parent = [];
  const find = a => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const vid = i => {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!ids.has(k)) { ids.set(k, parent.length); parent.push(parent.length); }
    return ids.get(k);
  };
  const tris = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = vid(i);
    parent[find(vid(i + 1))] = find(a); parent[find(vid(i + 2))] = find(a);
    tris.push(a);
  }
  const groups = new Map();
  tris.forEach((a, t) => { const r = find(a); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); });
  return [...groups.values()].map(ts => {
    const pos = new Float32Array(ts.length * 9);
    ts.forEach((t, j) => pos.set(p.array.subarray(t * 9, t * 9 + 9), j * 9));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals(); g.computeBoundingBox();
    const n = g.attributes.normal, uv = new Float32Array(n.count * 2);
    for (let i = 0; i < n.count; i++) { // UV por proyección de caja, para las gotas del vidrio
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), [x, y, z] = pos.subarray(i * 3, i * 3 + 3);
      uv.set(az >= ax && az >= ay ? [x, y] : ax >= ay ? [z, y] : [x, z], i * 2);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  });
}
// El líquido es la misma letra encogida un poco hacia adentro, para que quede dentro del vidrio
function inset(geo, d) {
  const g = geo.clone(), p = g.attributes.position, nrm = g.attributes.normal, dirs = new Map();
  const key = i => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i), nk = `${nrm.getX(i).toFixed(2)},${nrm.getY(i).toFixed(2)},${nrm.getZ(i).toFixed(2)}`;
    if (!dirs.has(k)) dirs.set(k, new Map());
    dirs.get(k).set(nk, new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
  }
  const off = new Map([...dirs].map(([k, m]) => [k, [...m.values()].reduce((a, b) => a.add(b), new THREE.Vector3()).normalize().multiplyScalar(d)]));
  const moved = [];
  for (let i = 0; i < p.count; i++) { const o = off.get(key(i)); moved.push([p.getX(i) - o.x, p.getY(i) - o.y, p.getZ(i) - o.z]); }
  moved.forEach((v, i) => p.setXYZ(i, ...v));
  return g;
}

logo.updateMatrixWorld(true);
let logoGeo; logo.traverse(n => { if (n.isMesh) logoGeo = n.geometry.clone().applyMatrix4(n.matrixWorld); });
logoGeo.deleteAttribute('uv'); logoGeo.deleteAttribute('normal');
logoGeo.computeBoundingBox();
{ const { min, max } = logoGeo.boundingBox; logoGeo.translate(0, -min.y, -(min.z + max.z) / 2).scale(...Array(3).fill(1 / (max.y - min.y))); }
const pieces = islands(logoGeo).sort((a, b) => a.boundingBox.min.x - b.boundingBox.min.x);
const iIdx = pieces.reduce((m, g, i) => (g.boundingBox.max.x - g.boundingBox.min.x < pieces[m].boundingBox.max.x - pieces[m].boundingBox.min.x ? i : m), 0);

// ---- Vidrio con dispersión: separa la luz del sol en colores ----
const dropsGlass = drops.clone(); dropsGlass.repeat.set(3, 3);
const glassMat = new THREE.MeshPhysicalMaterial({ roughness: 0.02, transmission: 1, thickness: 0.3, ior: 1.5, dispersion: 8,
  attenuationColor: 0xffb347, attenuationDistance: 0.6, clearcoat: 1, iridescence: 0.3, iridescenceIOR: 1.3,
  normalMap: dropsGlass, normalScale: new THREE.Vector2(0.2, 0.2) }); // vidrio frío: gotas que desvían la luz
const liquidMat = () => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uBottom: { value: 0 }, uHeight: { value: 1 }, uLevel: { value: 0 }, uFoam: { value: 0 }, uTilt: { value: 0 }, uCx: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uBottom,uHeight,uLevel,uFoam,uTilt,uCx,uTime; varying vec3 vW; varying vec3 vN;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    void main(){
      float y = (vW.y-uBottom)/uHeight + uTilt*(vW.x-uCx);
      float top = uLevel + uFoam;
      if (top < .001 || y > top) discard;
      vec3 col = mix(vec3(.85,.42,.03), vec3(1.,.72,.16), smoothstep(-.1,1.,y));
      vec2 q = vec2(vW.x*30., vW.y*30. - uTime*2.5), id = floor(q), f = fract(q)-.5;  // burbuja fina que sube
      float r = hash(id); f.x += (r-.5)*.6;
      col += (r > .82 ? smoothstep(.12,.05,length(f)) : 0.) * vec3(1.,.9,.6) * .9;
      if (y > uLevel) col = vec3(1.,.96,.88) * (.88 + .12*hash(floor(vW.xy*60.)));
      if (!gl_FrontFacing) col *= .9;
      gl_FragColor = vec4(col*(.8 + .2*max(vN.y,0.))*1.6, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

// ---- La lata (tu rig) es la Í; la anilla abierta hace de tilde ----
const can = new THREE.Group(); can.add(gltf.scene);
gltf.scene.rotation.x = -Math.PI / 2; // el GLB viene con Z hacia arriba
can.rotation.y = Math.PI / 2;         // así la anilla abierta se ve de perfil, inclinada como una tilde
can.updateMatrixWorld(true);
// Una sola textura: la etiqueta a la izquierda y el gris del aluminio (tapa, anilla) a la derecha
canTex.flipY = false; canTex.colorSpace = THREE.SRGBColorSpace; canTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const dropsCan = drops.clone(); dropsCan.repeat.set(3, 4);
const label = new THREE.MeshPhysicalMaterial({ map: canTex, metalness: 0.15, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08,
  normalMap: dropsCan, normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }); // tinta sobre metal: el brillo lo da el barniz, no el color
const alu = new THREE.MeshPhysicalMaterial({ map: canTex, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
can.traverse(n => {
  if (!n.isMesh) return;
  n.frustumCulled = false; n.castShadow = true;
  n.material = n.material.name === 'Cerveza' ? label : alu;
});
const canBox = new THREE.Box3().setFromObject(can), canSize = canBox.getSize(new THREE.Vector3());
const CAN_H = 1, s = CAN_H / canSize.y, CAN_W = canSize.x * s;
can.scale.setScalar(s);
can.position.set(-(canBox.min.x + canBox.max.x) / 2 * s, -canBox.min.y * s - CAN_H / 2, -(canBox.min.z + canBox.max.z) / 2 * s);
const pivot = new THREE.Group(); pivot.add(can); scene.add(pivot);
const hit = new THREE.Mesh(new THREE.BoxGeometry(CAN_W, CAN_H, CAN_W), new THREE.MeshBasicMaterial({ visible: false }));
pivot.add(hit);
const mouthLocal = new THREE.Vector3(0, CAN_H / 2, 0);

const bone = n => can.getObjectByName(n);
const DEF = ['DEF_01', 'DEF_02', 'DEF_03', 'DEF_04', 'DEF_05'].map(bone);
const defBase = DEF[0].position.clone(), SEG = DEF[1].position.y - DEF[0].position.y;
function bend(a) { // curva total "a" repartida en los 5 segmentos del rig
  const p = defBase.clone();
  DEF.forEach((b, i) => {
    const th = a * (i + 1) / DEF.length;
    b.position.copy(p); b.rotation.set(th, 0, 0);
    p.z += Math.sin(th) * SEG; p.y += Math.cos(th) * SEG;
  });
}
const opener = bone('DEF_opener'), openerRest = opener.rotation.x, OPEN_ANGLE = -0.9;

// ---- Composición: B A H [lata] A, la última A se corre para darle espacio a la lata ----
const prev = pieces[iIdx - 1].boundingBox, next = pieces[iIdx + 1].boundingBox;
const shift = CAN_W + 2 * GAP - (next.min.x - prev.max.x);
const x0 = pieces[0].boundingBox.min.x, x1 = pieces.at(-1).boundingBox.max.x + shift, center = -(x0 + x1) / 2;
const home = new THREE.Vector3(prev.max.x + GAP + CAN_W / 2 + center, CAN_H / 2, 0);
pivot.position.copy(home);

const glasses = [];
pieces.forEach((geo, i) => {
  if (i === iIdx) return;
  const { min, max } = geo.boundingBox, group = new THREE.Group(), liquid = new THREE.Mesh(inset(geo, 0.02), liquidMat());
  group.position.x = center + (i > iIdx ? shift : 0);
  const glass = new THREE.Mesh(geo, glassMat); glass.castShadow = true;
  group.add(liquid, glass); scene.add(group);
  const g = { u: liquid.material.uniforms, w: max.x - min.x, h: max.y - min.y, cx: group.position.x + (min.x + max.x) / 2,
    level: 0, foam: 0, done: false, slosh: 0, sloshV: 0 };
  g.u.uCx.value = g.cx; g.u.uHeight.value = g.h;
  g.x0 = group.position.x + min.x; g.x1 = group.position.x + max.x;
  glasses.push(g);
});
const front = pieces[0].boundingBox.max.z;
beach.setWord(glasses.map(g => [g.x0, g.x1]), front);

function fit() {
  const aspect = innerWidth / innerHeight, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(1.6 / tan, (x1 - x0) * 1.3 / 2 / (tan * aspect));
  camera.aspect = aspect; camera.position.set(0, 0.7, dist); camera.lookAt(0, 0.95, 0);
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); beach.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fit); fit();
{ // el sol asoma justo detrás de la H: su luz atraviesa el vidrio y se abre en colores
  const d = camera.position.z, h = glasses[2];
  beach.setSun(Math.atan(0.15 / d) + 0.01, Math.atan(-h.cx / d));
}

// ---- Interacción ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p = new THREE.Vector3();
const target = new THREE.Vector3(), grab = new THREE.Vector3();
let opened = false, open = 0, drag = false;
function setRay(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); ray.setFromCamera(ndc, camera); }
canvas.addEventListener('pointerdown', e => {
  setRay(e);
  if (!ray.intersectObject(hit).length) return;
  if (!opened) { opened = true; return; }
  drag = true; canvas.setPointerCapture(e.pointerId);
  ray.ray.intersectPlane(plane, p); grab.copy(pivot.position).sub(p); target.copy(pivot.position);
});
canvas.addEventListener('pointermove', e => {
  setRay(e);
  if (drag) { ray.ray.intersectPlane(plane, p); target.copy(p).add(grab); target.y = Math.max(target.y, CAN_H / 2); }
  canvas.style.cursor = drag ? 'grabbing' : ray.intersectObject(hit).length ? (opened ? 'grab' : 'pointer') : '';
});
canvas.addEventListener('pointerup', () => drag = false);

const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1, 10).translate(0, -0.5, 0),
  new THREE.MeshStandardMaterial({ color: 0xf0a020, emissive: 0x7a3a00, roughness: 0.15 }));
stream.visible = false; scene.add(stream);

// ---- Física: resortes (cap. 3) para posición, inclinación y flexión de la lata ----
const vel = new THREE.Vector3();
let tilt = 0, tiltV = 0, bendA = 0, bendV = 0, perfect = 0, served = 0, endAt = 0, lastReach = 0;
const glassAt = (gx, gy) => glasses.find(g => !g.done && Math.abs(gx - g.cx) < g.w * 0.3 && gy > g.h + 0.02);
const spring = (x, v, goal, k, c, dt) => v + (k * (goal - x) - c * v) * dt;

function evaluate(g) {
  g.done = true; served++;
  const verdict = grade(g.foam), fingers = (g.foam / FINGER).toLocaleString('es-CO', { maximumFractionDigits: 1 });
  if (verdict === 'perfecta') perfect++;
  $('note').innerHTML = '<b>Dorado brillante · burbuja fina</b>' + {
    plana: 'Casi sin espuma. Sirve desde más arriba.',
    espumosa: `${fingers} dedos de espuma. Acércate más al vaso.`,
    perfecta: `${fingers} dedos de espuma. Servido perfecto.`,
  }[verdict];
  $('note').style.opacity = 1;
  if (served === glasses.length) endAt = clock.getElapsed() + 2;
}
$('again').onclick = () => {
  glasses.forEach(g => Object.assign(g, { level: 0, foam: 0, done: false }));
  $('note').style.opacity = 0;
  perfect = served = endAt = 0; $('end').classList.remove('on');
};

const clock = new THREE.Timer(), v2 = new THREE.Vector3();
renderer.setAnimationLoop(time => {
  clock.update(time);
  const dt = Math.min(clock.getDelta(), 1 / 30), t = clock.getElapsed();
  const goal = drag ? target : home;

  vel.addScaledVector(v2.subVectors(goal, pivot.position), 140 * dt).multiplyScalar(1 - 16 * dt);
  pivot.position.addScaledVector(vel, dt);

  const mx = goal.x - Math.sin(POUR_TILT) * CAN_H / 2, my = goal.y + Math.cos(POUR_TILT) * CAN_H / 2;
  tiltV = spring(tilt, tiltV, drag && opened && glassAt(mx, my) ? POUR_TILT : 0, 60, 11, dt); tilt += tiltV * dt;
  pivot.rotation.z = tilt;
  bendV = spring(bendA, bendV, THREE.MathUtils.clamp(-vel.x * 0.12, -0.5, 0.5), 90, 7, dt); bendA += bendV * dt;
  bend(bendA);
  open += ((opened ? 1 : 0) - open) * Math.min(1, 8 * dt);
  opener.rotation.x = openerRest + open * OPEN_ANGLE;
  opener.scale.setScalar(1 + 0.8 * open); // tilde exagerada para que se lea

  stream.visible = false;
  if (opened && tilt > 1.6) {
    pivot.updateMatrixWorld();
    const m = pivot.localToWorld(mouthLocal.clone());
    const g = glassAt(m.x, m.y);
    let floorY = 0;
    if (g) {
      if (pour(g, m.y - g.h, dt)) evaluate(g); // lleno: la lata se endereza sola
      g.sloshV += (Math.random() - 0.5) * 40 * dt;
      floorY = (g.level + g.foam) * g.h;
    }
    stream.visible = true; stream.position.copy(m); stream.scale.y = Math.max(m.y - floorY, 0.01);
  }

  // cuando la ola alcanza las letras, la cerveza de adentro se mece
  const reach = waveReach(t), edge = SHORE + reach;
  if (lastReach + SHORE < front && edge >= front) glasses.forEach(g => g.sloshV += 0.6);
  lastReach = reach;

  for (const g of glasses) {
    g.sloshV = spring(g.slosh, g.sloshV, 0, 40, 2.5, dt); g.slosh += g.sloshV * dt;
    g.u.uLevel.value = g.level; g.u.uFoam.value = g.foam; g.u.uTilt.value = g.slosh; g.u.uTime.value = t;
  }
  v2.set(0, -0.1, front + 0.4).project(camera);
  $('note').style.left = (v2.x + 1) / 2 * innerWidth + 'px'; $('note').style.top = (1 - v2.y) / 2 * innerHeight + 'px';

  $('hint').textContent = !opened ? 'Toca la lata para abrirla' : 'Arrastra la lata sobre una letra para servir';
  $('hint').style.opacity = served ? 0 : 0.85;
  if (endAt && t > endAt) { $('score').textContent = `Servidos perfectos: ${perfect} de ${glasses.length}`; $('end').classList.add('on'); $('note').style.opacity = 0; endAt = 0; }

  beach.render(t, reach);
});
