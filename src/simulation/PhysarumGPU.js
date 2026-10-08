import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

/**
 * Physarum on the GPU.
 *
 * What an agent PERCEIVES : the trail map, at three sensors (left / centre / right) ahead of it.
 * How it DECIDES          : turn toward the strongest sensor (classic Physarum), then optionally steer
 *                           toward the local direction of the flow field (F key).
 * What it LEAVES          : a trail whose colour encodes the AXIS of its heading (see headingColor).
 *                           Opposite directions share a colour, so a busy vein keeps one colour.
 */
export class PhysarumGPU {
  constructor(renderer, size, { trailWidth = 1920, trailHeight = 1080 } = {}) {
    this.size = size;
    this.renderer = renderer;
    this.gpuCompute = new GPUComputationRenderer(size, size, renderer);

    const pos0 = this.gpuCompute.createTexture();
    const data = pos0.image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.random();
      data[i + 1] = Math.random();
      data[i + 2] = Math.random() * Math.PI * 2;
      data[i + 3] = Math.random();
    }

    this.posVar = this.gpuCompute.addVariable('texturePosition', this.getComputeShader(), pos0);
    this.gpuCompute.setVariableDependencies(this.posVar, [this.posVar]);

    const U = this.posVar.material.uniforms;
    for (let i = 0; i < 15; i++) U['p' + i] = { value: 0.0 };
    Object.assign(U, {
      uTrail: { value: null },
      uTime: { value: 0 },
      uFlowTime: { value: 0 },       // unwrapped time, so the flow field never jumps
      uFlowForce: { value: 0.0 },      // steering gain toward the flow field (0 = off)
      uScatter: { value: 0.0 },
      uVelocityEffect: { value: 0.0 },
      uImplode: { value: 0.0 },
      uExplode: { value: 0.0 },
      uVortex: { value: 0.0 },
      uSenseScale: { value: 1.0 },     // live multiplier on sensor distance = how far agents "see"
      uA: { value: new THREE.Vector2(1, 1) } // aspect compensation so distances are equal in pixels
    });

    const error = this.gpuCompute.init();
    if (error !== null) console.error(error);

    // Preset parameters morph smoothly instead of snapping.
    this.preset = new Float32Array(15);
    this.presetTarget = new Float32Array(15);

    // --- Agents are drawn as 1px points, coloured by heading axis ---
    const geometry = new THREE.BufferGeometry();
    const uvs = new Float32Array(size * size * 2);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const index = (j * size + i) * 2;
        uvs[index] = i / size;
        uvs[index + 1] = j / size;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * size * 3), 3));

    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: { tPos: { value: null } },
      vertexShader: `
        uniform sampler2D tPos;
        varying vec3 vCol;
        // Colour = which AXIS the agent travels on (period PI, so opposite headings match).
        // The three weights always sum to 3, so total deposit stays constant.
        vec3 headingColor(float h) {
          float a = 2.0 * h;
          return (0.5 + 0.5 * cos(vec3(a, a - 2.0944, a - 4.18879))) * 2.0;
        }
        void main() {
          vec4 posData = texture2D(tPos, uv);
          vCol = headingColor(posData.z);
          gl_Position = vec4(posData.xy * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 0.015); }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });

    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.pointsScene = new THREE.Scene();
    this.pointsScene.add(this.points);
    this.pointsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // --- Trail decay + blur (the "environment" the agents read) ---
    this.decayScene = new THREE.Scene();
    this.decayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tTrail: { value: null },
        uDecay: { value: 0.985 },
        uRes: { value: new THREE.Vector2(trailWidth, trailHeight) }
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tTrail;
        uniform float uDecay;
        uniform vec2 uRes;
        varying vec2 vUv;
        void main() {
          vec2 t = 1.0 / uRes;
          vec4 sum = vec4(0.0);
          sum += texture2D(tTrail, fract(vUv + vec2(-t.x, -t.y)));
          sum += texture2D(tTrail, fract(vUv + vec2(0.0, -t.y)));
          sum += texture2D(tTrail, fract(vUv + vec2( t.x, -t.y)));
          sum += texture2D(tTrail, fract(vUv + vec2(-t.x, 0.0)));
          sum += texture2D(tTrail, vUv) * 4.0;
          sum += texture2D(tTrail, fract(vUv + vec2( t.x, 0.0)));
          sum += texture2D(tTrail, fract(vUv + vec2(-t.x,  t.y)));
          sum += texture2D(tTrail, fract(vUv + vec2(0.0,  t.y)));
          sum += texture2D(tTrail, fract(vUv + vec2( t.x,  t.y)));
          gl_FragColor = max(vec4(0.0), (sum / 12.0) * uDecay);
        }`
    });
    const decayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMaterial);
    decayQuad.frustumCulled = false;
    this.decayScene.add(decayQuad);

    this._makeTrail(trailWidth, trailHeight);
  }

  _makeTrail(w, h) {
    const opts = {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    };
    this.trailWidth = w;
    this.trailHeight = h;
    this.trailRT1 = new THREE.WebGLRenderTarget(w, h, opts);
    this.trailRT2 = new THREE.WebGLRenderTarget(w, h, opts);
    this.outputTexture = this.trailRT1.texture;
    this.decayMaterial.uniforms.uRes.value.set(w, h);

    // Geometric-mean compensation: keeps the overall feel of the presets while making
    // sensing distance and speed equal in X and Y pixels.
    const a = w / h;
    this.posVar.material.uniforms.uA.value.set(1 / Math.sqrt(a), Math.sqrt(a));
  }

  /** Recreate the trail maps when the window aspect changes (clears the trail). */
  resizeTrail(w, h) {
    if (w === this.trailWidth && h === this.trailHeight) return;
    this.trailRT1.dispose();
    this.trailRT2.dispose();
    this._makeTrail(w, h);
  }

  getComputeShader() {
    return `
      uniform sampler2D uTrail;
      uniform float uTime;
      uniform float uFlowTime;
      uniform float uFlowForce;
      uniform float uScatter;
      uniform float uVelocityEffect;
      uniform float uImplode;
      uniform float uExplode;
      uniform float uVortex;
      uniform float uSenseScale;
      uniform vec2 uA;
      uniform float p0; uniform float p1; uniform float p2; uniform float p3; uniform float p4;
      uniform float p5; uniform float p6; uniform float p7; uniform float p8; uniform float p9;
      uniform float p10; uniform float p11; uniform float p12; uniform float p13; uniform float p14;

      #define TAU 6.28318530718

      float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }

      // Trail density = mean of the three channels (channels only carry colour information).
      float sense(vec2 p) { return dot(texture2D(uTrail, fract(p)).rgb, vec3(0.333333)); }

      // THE FIELD: one direction (angle) for every point in space. It tiles seamlessly because the
      // spatial frequencies are whole numbers of cycles, and it slowly evolves over time.
      float flowAngle(vec2 p, float t) {
        float a = sin(TAU * (2.0 * p.x) + t * 0.35)
                + sin(TAU * (3.0 * p.y) - t * 0.27)
                + sin(TAU * (p.x + p.y) + t * 0.20)
                + 0.5 * sin(TAU * (3.0 * p.x - 2.0 * p.y) + t * 0.60);
        return a * 1.2;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 posData = texture2D(texturePosition, uv);
        vec2 pos = posData.xy;
        float heading = posData.z;
        float state = posData.w;

        // R: respawn a fraction of the agents at random places
        if (uScatter > 0.0 && rand(uv + uTime) < uScatter) {
          pos = vec2(rand(uv + uTime * 1.3), rand(uv + 1.0 + uTime * 0.7));
          heading = rand(uv + 2.0 + uTime) * TAU;
        }

        // Q / W / E: forces around the screen centre (computed in pixel-isotropic space)
        vec2 toC = (vec2(0.5) - pos) / uA;
        float dC = length(toC);
        vec2 dirC = dC > 1e-5 ? toC / dC : vec2(1.0, 0.0);
        if (uImplode > 0.0) pos += dirC * min(uImplode * 0.012, dC * 0.6) * uA;
        if (uExplode > 0.0) pos -= dirC * uExplode * 0.016 * (0.4 + exp(-dC * 3.0)) * uA;
        if (uVortex > 0.0) {
          vec2 tang = vec2(-dirC.y, dirC.x);
          pos += tang * uVortex * 0.02 * uA;
          heading += uVortex * 0.1;        // rotating every heading also cycles the trail colours
        }

        // "36 points" parameters.
        // NOTE: p13 is read as a Y offset and p14 as the distance along the heading of the sample used
        // to modulate SD/SA/RA/MD (p12 is unused). Kept as-is because the presets were tuned that way.
        vec2 dir = vec2(cos(heading), sin(heading));
        vec2 samplePos = fract(pos + p14 * dir + vec2(0.0, p13));
        float sensedVal = clamp(sense(samplePos) * 2.0, 0.0001, 1.0);

        float SD = (p0 + p1 * pow(sensedVal, p2)) * uSenseScale;  // sensor distance (wheel scales it)
        float SA = p3 + p4 * pow(sensedVal, p5);                  // sensor angle
        float RA = p6 + p7 * pow(sensedVal, p8);                  // rotation angle
        float MD = p9 + p10 * pow(sensedVal, p11);                // move distance

        if (uVelocityEffect > 0.0) { MD *= 5.0; RA *= 0.01; }

        vec2 dirLeft  = vec2(cos(heading + SA), sin(heading + SA));
        vec2 dirRight = vec2(cos(heading - SA), sin(heading - SA));

        float wC = sense(pos + dir * SD * uA);
        float wL = sense(pos + dirLeft * SD * uA);
        float wR = sense(pos + dirRight * SD * uA);

        if (wC > wL && wC > wR) { }
        else if (wC < wL && wC < wR) {
          if (rand(uv + uTime) > 0.5) heading += RA; else heading -= RA;
        } else if (wL > wR) { heading += RA; }
        else if (wR > wL) { heading -= RA; }

        // F: FLOW FIELD. The field only says "which way here". The RULE is a steering rule:
        // turn toward the field's angle by a fraction (uFlowForce) of the angular error.
        vec2 drift = vec2(0.0);
        if (uFlowForce > 0.0) {
          float fa = flowAngle(pos, uFlowTime);
          float err = atan(sin(fa - heading), cos(fa - heading));
          heading += err * uFlowForce;
          drift = vec2(cos(fa), sin(fa)) * uFlowForce * 0.01 * uA;
        }

        vec2 velocity = vec2(cos(heading), sin(heading)) * MD * uA + drift;
        pos = fract(pos + velocity);
        heading = mod(heading, TAU);

        gl_FragColor = vec4(pos, heading, state);
      }
    `;
  }

  /** Set a 36-points preset. With immediate=false the parameters glide to the new values. */
  setPreset(arr, immediate = false) {
    for (let i = 0; i < 15; i++) this.presetTarget[i] = arr[i] !== undefined ? arr[i] : 0.0;
    if (immediate) {
      this.preset.set(this.presetTarget);
      this._pushPreset();
    }
  }

  _pushPreset() {
    const U = this.posVar.material.uniforms;
    for (let i = 0; i < 15; i++) U['p' + i].value = this.preset[i];
  }

  setDecay(v) { this.decayMaterial.uniforms.uDecay.value = v; }

  set(name, value) { this.posVar.material.uniforms[name].value = value; }

  update(time, dt = 1 / 60) {
    // 1. decay + blur the trail (ping-pong)
    this.decayMaterial.uniforms.tTrail.value = this.trailRT1.texture;
    this.renderer.setRenderTarget(this.trailRT2);
    this.renderer.render(this.decayScene, this.pointsCamera);
    const tmp = this.trailRT1;
    this.trailRT1 = this.trailRT2;
    this.trailRT2 = tmp;
    this.outputTexture = this.trailRT1.texture;

    // 2. glide preset parameters
    const k = 1 - Math.exp(-dt * 7.0);
    for (let i = 0; i < 15; i++) this.preset[i] += (this.presetTarget[i] - this.preset[i]) * k;
    this._pushPreset();

    // 3. agents sense + move
    const U = this.posVar.material.uniforms;
    U.uTrail.value = this.trailRT1.texture;
    U.uTime.value = time % 64.0;
    U.uFlowTime.value = time;
    this.gpuCompute.compute();

    // 4. agents deposit
    this.renderer.autoClear = false;
    this.pointMaterial.uniforms.tPos.value = this.gpuCompute.getCurrentRenderTarget(this.posVar).texture;
    this.renderer.setRenderTarget(this.trailRT1);
    this.renderer.render(this.pointsScene, this.pointsCamera);
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(null);
  }
}