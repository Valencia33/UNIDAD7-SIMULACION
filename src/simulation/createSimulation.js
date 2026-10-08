import * as THREE from 'three';
import { PhysarumGPU } from './PhysarumGPU.js';

// ---- Look tuning (the three numbers you will most likely touch) -------------------------------
const LOOK = {
  gain: 3.0,   // overall brightness of the trail
  tint: 0.7,   // 0..1  how strongly heading-axis colours replace the base ramp
  bump: 14.0   // strength of the glossy highlight on vein edges
};

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// ramp = density low -> high (background, shadow, body, glow, hot core)
// acc  = three accent colours, picked by the AXIS an agent is travelling on (0°, 60°, 120°)
const PALETTES = [
  { name: 'Gecs pink',      ramp: ['#05000a', '#3a0066', '#ff1f9c', '#ffd23f', '#fff6e0'], acc: ['#ff2bd6', '#00e5ff', '#c8ff00'] },
  { name: 'Blood and gold', ramp: ['#000000', '#3b0059', '#e63946', '#f5cb5c', '#fff3d6'], acc: ['#e63946', '#8a2be2', '#f5cb5c'] },
  { name: 'Ice abyss',      ramp: ['#00050b', '#063c5e', '#1fb5c9', '#a7f3ff', '#ffffff'], acc: ['#00e5ff', '#4d5bff', '#ff4fd8'] },
  { name: 'Toxic glitch',   ramp: ['#000000', '#220022', '#ff00ff', '#aaffaa', '#ffffff'], acc: ['#ff00ff', '#39ff14', '#00ffff'] },
  { name: 'Candy chrome',   ramp: ['#08001a', '#4b1fff', '#ff6ad5', '#7df9ff', '#ffffff'], acc: ['#ff6ad5', '#7df9ff', '#fff200'] },
  { name: 'Orange crush',   ramp: ['#00010f', '#0b1a8a', '#ff5a00', '#ffe500', '#fffbe0'], acc: ['#ff5a00', '#1f6bff', '#ffe500'] },
  { name: 'UV laser',       ramp: ['#000000', '#14003d', '#7a00ff', '#00ffa3', '#f0fff8'], acc: ['#7a00ff', '#00ffa3', '#ff0066'] },
  { name: 'Bone and ash',   ramp: ['#050404', '#1f1e1c', '#857c7b', '#e0af36', '#fff4c2'], acc: ['#e0af36', '#c4c0bd', '#ff4d2e'] }
].map((p) => ({ name: p.name, ramp: p.ramp.map(hex), acc: p.acc.map(hex) }));

// 36-points presets: SD_b, SD_m, SD_p, SA_b, SA_m, SA_p, RA_b, RA_m, RA_p, MD_b, MD_m, MD_p, p12, p13, p14
const POINT_PRESETS = [
  [0.015, 0.0, 1.0,  0.4, 0.0, 1.0,   0.2, 0.0, 1.0,   0.002, 0.0, 1.0,    0.0, 0.0, 1.0],     // Networks
  [0.02, 0.05, 0.5,  0.1, 0.5, 2.0,   0.1, 0.5, 2.0,   0.001, 0.008, 0.5,  0.001, 0.005, 1.5], // Crystalline
  [0.005, 0.05, 2.0, 0.5, -0.4, 1.0,  0.5, -0.4, 1.0,  0.005, -0.004, 1.0, 0.0, 0.0, 0.8],     // Spirals
  [0.03, -0.02, 1.0, 0.2, 0.8, 0.5,   0.8, -0.6, 2.0,  0.004, 0.002, 0.5,  0.0, 0.01, 1.2]     // Aggressive
];

// Forces that can be tapped (pulse) or held (sustain)
const FORCES = {
  implode: { uniform: 'uImplode', decay: 3.0, peak: 1.0 },
  explode: { uniform: 'uExplode', decay: 3.0, peak: 1.0 },
  vortex:  { uniform: 'uVortex',  decay: 2.5, peak: 1.0 },
  scatter: { uniform: 'uScatter', decay: 5.0, peak: 0.85 }
};

const trailSizeFor = (w, h) => ({
  tw: 1920,
  th: Math.max(480, Math.min(1400, Math.round((1920 * h) / w / 2) * 2))
});

// Same direction-axis colour code the agents use, so the boids paint in the same language.
const axisWeights = (h) => [0, 1, 2].map((i) => (1 + Math.cos(2 * h - i * 2.0944)));

export function createSimulation({ scene, renderer, width = window.innerWidth, height = window.innerHeight }) {
  const { tw, th } = trailSizeFor(width, height);
  const physarum = new PhysarumGPU(renderer, 1024, { trailWidth: tw, trailHeight: th }); // 1,048,576 agents
  physarum.setPreset(POINT_PRESETS[0], true);

  // ---- Palette state (crossfades toward the target) ----------------------------------------
  let palIndex = 0;
  const cur = { ramp: PALETTES[0].ramp.map((v) => v.clone()), acc: PALETTES[0].acc.map((v) => v.clone()) };

  // ---- Display: trail -> colour -------------------------------------------------------------
  const displayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tTrail: { value: physarum.outputTexture },
      uTexel: { value: new THREE.Vector2(1 / tw, 1 / th) },
      uR0: { value: cur.ramp[0] }, uR1: { value: cur.ramp[1] }, uR2: { value: cur.ramp[2] },
      uR3: { value: cur.ramp[3] }, uR4: { value: cur.ramp[4] },
      uA0: { value: cur.acc[0] }, uA1: { value: cur.acc[1] }, uA2: { value: cur.acc[2] },
      uGain: { value: LOOK.gain },
      uTint: { value: LOOK.tint },
      uBump: { value: LOOK.bump }
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tTrail;
      uniform vec2 uTexel;
      uniform vec3 uR0; uniform vec3 uR1; uniform vec3 uR2; uniform vec3 uR3; uniform vec3 uR4;
      uniform vec3 uA0; uniform vec3 uA1; uniform vec3 uA2;
      uniform float uGain;
      uniform float uTint;
      uniform float uBump;
      varying vec2 vUv;

      float dens(vec2 p) { return dot(texture2D(tTrail, p).rgb, vec3(0.333333)); }

      vec3 ramp(float t) {
        t = clamp(t, 0.0, 1.0) * 4.0;
        vec3 c = mix(uR0, uR1, smoothstep(0.0, 1.0, t));
        c = mix(c, uR2, smoothstep(1.0, 2.0, t));
        c = mix(c, uR3, smoothstep(2.0, 3.0, t));
        return mix(c, uR4, smoothstep(3.0, 4.0, t));
      }

      void main() {
        vec3 tex = texture2D(tTrail, vUv).rgb;
        float sum = tex.r + tex.g + tex.b;
        float d = sum * 0.333333 * uGain;

        // Chromaticity of the trail = which axes passed through here -> blend of three accents
        vec3 w = pow(max(tex / max(sum, 1e-4), vec3(1e-4)), vec3(2.5));
        w /= (w.r + w.g + w.b);
        vec3 accent = uA0 * w.r + uA1 * w.g + uA2 * w.b;

        vec3 col = ramp(1.0 - exp(-d * 1.1));
        float k = smoothstep(0.03, 0.6, d) * uTint;
        col = mix(col, accent * (0.3 + smoothstep(0.0, 1.4, d)), k);

        // Over-exposed cores (values above 1 are what the bloom picks up)
        col += uR4 * pow(max(d - 1.2, 0.0), 1.1) * 0.55;

        // Glossy edge light on the veins
        vec2 e = uTexel * 1.5;
        vec2 grad = vec2(dens(vUv + vec2(e.x, 0.0)) - dens(vUv - vec2(e.x, 0.0)),
                         dens(vUv + vec2(0.0, e.y)) - dens(vUv - vec2(0.0, e.y)));
        float lit = clamp(-dot(grad, vec2(-0.45, 0.8)) * uBump, 0.0, 1.2);
        col += mix(uR3, uR4, 0.5) * lit * smoothstep(0.05, 0.5, d);

        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false,
    depthWrite: false
  });
  const trailMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial);
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  // ---- Director boids (flocking) ------------------------------------------------------------
  // Perceive: neighbours within 0.5 (alignment, cohesion) / 0.2 (separation), plus the pointer.
  // Act: steering = desired velocity - current velocity, limited by maxForce.
  // They stamp soft coloured blobs into the trail: scent that the Physarum agents follow.
  const NUM_BOIDS = 30;
  const boidScene = new THREE.Scene();
  const spriteGeo = new THREE.PlaneGeometry(1, 1);
  const spriteVert = `varying vec2 vP; void main() { vP = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const spriteFrag = `
    uniform vec3 uCol; uniform float uStrength; varying vec2 vP;
    void main() {
      float f = 1.0 - smoothstep(0.0, 1.0, length(vP));
      f *= f;
      gl_FragColor = vec4(uCol * f * uStrength, 1.0);
    }`;
  const boids = [];
  for (let i = 0; i < NUM_BOIDS; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3(1, 1, 1) }, uStrength: { value: 0.8 } },
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      transparent: true,
      blending: THREE.CustomBlending,       // keep the brightest value instead of piling up
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(spriteGeo, mat);
    mesh.frustumCulled = false;
    mesh.position.z = -0.5;
    boidScene.add(mesh);
    boids.push({
      id: i,
      mesh,
      pos: new THREE.Vector2((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
      vel: new THREE.Vector2((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
      acc: new THREE.Vector2(),
      maxSpeed: 0.8,
      maxForce: 0.05
    });
  }

  const pointer = new THREE.Vector2(0, 0);
  let leader = false;

  function noise(x, y, t) { return Math.sin(x * 5.0 + t) * Math.cos(y * 5.0 - t); }

  function stepBoids(elapsed, dt) {
    const aspect = physarum.trailWidth / physarum.trailHeight;
    for (const boid of boids) {
      const align = new THREE.Vector2();
      const cohesion = new THREE.Vector2();
      const separate = new THREE.Vector2();
      let nA = 0, nC = 0, nS = 0;

      for (const other of boids) {
        if (other.id === boid.id) continue;
        const d = boid.pos.distanceTo(other.pos);
        if (d < 0.5) { align.add(other.vel); nA++; cohesion.add(other.pos); nC++; }
        if (d < 0.2 && d > 1e-5) { separate.add(boid.pos.clone().sub(other.pos).normalize().divideScalar(d)); nS++; }
      }

      boid.maxSpeed = leader ? 1.3 : 0.8;
      const steer = (v) => v.normalize().multiplyScalar(boid.maxSpeed).sub(boid.vel).clampLength(0, boid.maxForce);
      if (nA > 0) steer(align.divideScalar(nA));
      if (nC > 0) steer(cohesion.divideScalar(nC).sub(boid.pos));
      if (nS > 0) steer(separate.divideScalar(nS));

      // Flow-field wander (a field of angles the boid steers along)
      const angle = noise(boid.pos.x, boid.pos.y, elapsed) * Math.PI * 2;
      const flow = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(boid.maxForce * 1.5);

      boid.acc.add(align).add(cohesion).add(separate.multiplyScalar(1.5)).add(flow);

      // Hold the mouse button: SEEK + ARRIVE toward the pointer. The flock becomes your brush.
      if (leader) {
        const to = pointer.clone().sub(boid.pos);
        const dist = to.length();
        to.setLength(boid.maxSpeed * Math.min(1, dist / 0.4)).sub(boid.vel).clampLength(0, boid.maxForce * 2);
        boid.acc.add(to.multiplyScalar(2.0));
      }

      boid.vel.add(boid.acc).clampLength(0, boid.maxSpeed);
      boid.pos.add(boid.vel.clone().multiplyScalar(dt));
      boid.acc.set(0, 0);

      if (boid.pos.x > 1 || boid.pos.x < -1) { boid.vel.x *= -1; boid.pos.x = Math.max(-1, Math.min(1, boid.pos.x)); }
      if (boid.pos.y > 1 || boid.pos.y < -1) { boid.vel.y *= -1; boid.pos.y = Math.max(-1, Math.min(1, boid.pos.y)); }

      // Draw: soft circle, coloured by the axis it is flying along
      const size = leader ? 0.06 : 0.03;
      boid.mesh.position.set(boid.pos.x, boid.pos.y, -0.5);
      boid.mesh.scale.set(size / aspect, size, 1);
      const w = axisWeights(Math.atan2(boid.vel.y, boid.vel.x * aspect));
      boid.mesh.material.uniforms.uCol.value.set(w[0], w[1], w[2]);
      boid.mesh.material.uniforms.uStrength.value = leader ? 1.0 : 0.8;
    }
  }

  // ---- Live state, all driven by the performer ----------------------------------------------
  const fstate = {};
  for (const k of Object.keys(FORCES)) fstate[k] = { v: 0, held: false };
  let flowTarget = 0, flowCur = 0;
  let senseTarget = 1, senseCur = 1;
  let decayTarget = 0.985, decayCur = 0.985;

  function stepSimulation(deltaTime, elapsedTime) {
    const dt = Math.min(deltaTime, 0.05);

    // palette crossfade
    const kp = 1 - Math.exp(-dt * 5);
    const p = PALETTES[palIndex];
    for (let i = 0; i < 5; i++) cur.ramp[i].lerp(p.ramp[i], kp);
    for (let i = 0; i < 3; i++) cur.acc[i].lerp(p.acc[i], kp);

    // pulses / holds
    for (const [name, f] of Object.entries(FORCES)) {
      const s = fstate[name];
      s.v = s.held ? 1 : Math.max(0, s.v - dt * f.decay);
      physarum.set(f.uniform, s.v);
    }

    // smoothed continuous controls
    flowCur += (flowTarget - flowCur) * (1 - Math.exp(-dt * (flowTarget > flowCur ? 6 : 2.5)));
    senseCur += (senseTarget - senseCur) * (1 - Math.exp(-dt * 8));
    decayCur += (decayTarget - decayCur) * (1 - Math.exp(-dt * 8));
    physarum.set('uFlowForce', flowCur * 0.1);
    physarum.set('uSenseScale', senseCur);
    physarum.setDecay(decayCur);
    // keep brightness roughly constant when trail memory changes
    displayMaterial.uniforms.uGain.value = LOOK.gain * Math.pow((1 - decayCur) / 0.015, 0.85);

    stepBoids(elapsedTime, dt);

    renderer.autoClear = false;
    renderer.setRenderTarget(physarum.trailRT1);
    renderer.render(boidScene, physarum.pointsCamera);
    renderer.autoClear = true;

    physarum.update(elapsedTime, dt);
    displayMaterial.uniforms.tTrail.value = physarum.outputTexture;
  }

  return {
    stepSimulation,
    paletteCount: PALETTES.length,
    setPoint: (i) => physarum.setPreset(POINT_PRESETS[((i % POINT_PRESETS.length) + POINT_PRESETS.length) % POINT_PRESETS.length]),
    setPalette: (i) => {
      palIndex = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
      return PALETTES[palIndex].name;
    },
    pulse: (name) => { fstate[name].v = FORCES[name].peak; },
    hold: (name, on) => { fstate[name].held = on; },
    setFlow: (on) => { flowTarget = on ? 1 : 0; },
    setInertia: (on) => physarum.set('uVelocityEffect', on ? 1.0 : 0.0),
    setPointer: (nx, ny) => pointer.set(nx, ny),
    setLeader: (on) => { leader = on; },
    // amount is in "wheel notches"
    nudgeSense: (amount) => { senseTarget = Math.max(0.5, Math.min(2.6, senseTarget * Math.pow(1.12, amount))); return senseTarget; },
    nudgeMemory: (amount) => { decayTarget = Math.max(0.95, Math.min(0.992, decayTarget + amount * 0.003)); return decayTarget; },
    resize: (w, h) => {
      const s = trailSizeFor(w, h);
      physarum.resizeTrail(s.tw, s.th);
      displayMaterial.uniforms.uTexel.value.set(1 / s.tw, 1 / s.th);
    }
  };
}