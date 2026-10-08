import * as THREE from 'three';

/**
 * Post-processing pipeline:
 *   scene (HDR) -> bright-pass + 5-level downsample -> upsample chain (bloom) -> composite to screen
 * The composite does zoom / spin / shake, glitch, chromatic aberration, tonemap, invert, CRT and grain.
 * Nothing here listens to the audio: every value in `params` is set by the performer in main.js.
 */

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN_FRAG = `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uPrefilter;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;
    if (uPrefilter > 0.5) {
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      c *= max(soft, br - uThreshold) / max(br, 1e-4);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

const UP_FRAG = `
  uniform sampler2D tLow;
  uniform sampler2D tHigh;
  uniform vec2 uTexel;
  uniform float uWeight;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 s = texture2D(tLow, vUv).rgb * 4.0;
    s += (texture2D(tLow, vUv + vec2(-o.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb
        + texture2D(tLow, vUv + vec2(0.0, -o.y)).rgb + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb) * 2.0;
    s += texture2D(tLow, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb
       + texture2D(tLow, vUv + vec2(-o.x,  o.y)).rgb + texture2D(tLow, vUv + vec2(o.x,  o.y)).rgb;
    gl_FragColor = vec4(s / 16.0 * uWeight + texture2D(tHigh, vUv).rgb, 1.0);
  }`;

const COMPOSITE_FRAG = `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uBloom;
  uniform float uGlitch;
  uniform float uZoom;
  uniform float uRot;
  uniform float uAberration;
  uniform float uInvert;
  uniform float uFlash;
  uniform vec2 uShake;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Linear up to 0.75, then a soft shoulder toward 1.0 (hot cores glow instead of clipping flat)
  vec3 shoulder(vec3 x) {
    vec3 t = max(x - 0.75, 0.0);
    return min(x, vec3(0.75)) + 0.25 * (1.0 - exp(-4.0 * t));
  }

  void main() {
    // --- camera: spin, zoom punch, barrel lens, shake ---
    float asp = uRes.x / uRes.y;
    vec2 c = vUv - 0.5;
    c.x *= asp;
    float sr = sin(uRot), cr = cos(uRot);
    c = mat2(cr, -sr, sr, cr) * c;
    c.x /= asp;
    c *= uZoom;
    c *= 1.0 + 0.25 * dot(c, c);
    vec2 uv = c + 0.5 + uShake;

    // --- glitch: row tearing, displaced blocks, occasional roll ---
    float swapMask = 0.0;
    if (uGlitch > 0.001) {
      float g = uGlitch;
      float t = floor(uTime * 16.0);
      float band = floor(uv.y * 30.0);
      float tear = step(1.0 - 0.4 * g, hash(vec2(band, t)));
      uv.x += (hash(vec2(band + 11.0, t)) - 0.5) * 0.3 * tear * g;
      swapMask = tear * step(0.6, g);

      vec2 cell = floor(uv * vec2(16.0, 9.0));
      float blk = step(1.0 - 0.10 * g, hash(cell + vec2(t * 1.7, 5.0)));
      uv += (vec2(hash(cell + vec2(2.0, t)), hash(cell + vec2(7.0, t))) - 0.5) * 0.18 * blk * g;

      uv.y += step(0.97, hash(vec2(t, 3.0))) * 0.08 * g;
    }

    // --- chromatic aberration: grows toward the edges, plus a small horizontal split ---
    vec2 dir = uv - 0.5;
    float ca = 0.0015 + uAberration + uGlitch * 0.012;
    vec2 off = dir * ca * 2.0 + vec2(ca * 0.3, 0.0);

    vec3 col;
    col.r = texture2D(tScene, uv + off).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - off).b;

    vec3 bl;
    bl.r = texture2D(tBloom, uv + off).r;
    bl.g = texture2D(tBloom, uv).g;
    bl.b = texture2D(tBloom, uv - off).b;
    col += bl * uBloom;

    // --- punch brightness (palette change, respawn) ---
    col = col * (1.0 + uFlash * 1.2) + uFlash * 0.1;

    col = shoulder(max(col, 0.0));
    if (swapMask > 0.5) col = col.gbr;

    // --- invert: hard flip for ~0.2 s, then it falls back ---
    col = mix(col, 1.0 - col, smoothstep(0.35, 0.65, uInvert));

    // --- finish: slight saturation lift, soft CRT rows, vignette, grain ---
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, 1.15);
    col *= 1.0 - 0.2 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.5));
    vec2 q = vUv;
    float vig = pow(max(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.0), 0.2);
    col *= mix(0.40, 1.0, vig);
    col += (hash(gl_FragCoord.xy + fract(uTime) * 71.0) - 0.5) * 0.09;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export class PostFX {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.levels = 5;
    this.threshold = 0.9;   // brightness where bloom starts (max channel)
    this.knee = 0.5;

    // everything main.js can drive
    this.params = {
      bloom: 0.38, glitch: 0, zoom: 1, rot: 0, aberration: 0,
      invert: 0, flash: 0, time: 0, shake: new THREE.Vector2()
    };

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();

    this.downMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
        uPrefilter: { value: 0 }, uThreshold: { value: this.threshold }, uKnee: { value: this.knee }
      },
      vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: {
        tLow: { value: null }, tHigh: { value: null },
        uTexel: { value: new THREE.Vector2() }, uWeight: { value: 0.7 }
      },
      vertexShader: VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(width, height) },
        uTime: { value: 0 }, uBloom: { value: 0 }, uGlitch: { value: 0 }, uZoom: { value: 1 },
        uRot: { value: 0 }, uAberration: { value: 0 }, uInvert: { value: 0 }, uFlash: { value: 0 },
        uShake: { value: new THREE.Vector2() }
      },
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.rts = [];
    this.setSize(width, height);
  }

  _rt(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    // Mirrored edges: zooming out shows a reflection instead of a black border
    rt.texture.wrapS = rt.texture.wrapT = THREE.MirroredRepeatWrapping;
    this.rts.push(rt);
    return rt;
  }

  setSize(width, height) {
    this.rts.forEach((rt) => rt.dispose());
    this.rts = [];
    this.rtScene = this._rt(width, height);
    this.down = [];
    this.up = [];
    for (let i = 0; i < this.levels; i++) {
      const w = Math.max(2, Math.floor(width / 2 ** (i + 1)));
      const h = Math.max(2, Math.floor(height / 2 ** (i + 1)));
      this.down.push(this._rt(w, h));
      this.up.push(i < this.levels - 1 ? this._rt(w, h) : null);
    }
    this.compMat.uniforms.uRes.value.set(width, height);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera) {
    const r = this.renderer;
    const L = this.levels;

    r.autoClear = true;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);

    // bright-pass + downsample
    const d = this.downMat.uniforms;
    let src = this.rtScene;
    for (let i = 0; i < L; i++) {
      d.tSrc.value = src.texture;
      d.uTexel.value.set(1 / src.width, 1 / src.height);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      this._pass(this.downMat, this.down[i]);
      src = this.down[i];
    }

    // upsample, adding each level back
    const u = this.upMat.uniforms;
    let low = this.down[L - 1];
    for (let i = L - 2; i >= 0; i--) {
      u.tLow.value = low.texture;
      u.tHigh.value = this.down[i].texture;
      u.uTexel.value.set(1 / low.width, 1 / low.height);
      this._pass(this.upMat, this.up[i]);
      low = this.up[i];
    }

    // composite
    const p = this.params;
    const c = this.compMat.uniforms;
    c.tScene.value = this.rtScene.texture;
    c.tBloom.value = low.texture;
    c.uTime.value = p.time % 1000.0;
    c.uBloom.value = p.bloom;
    c.uGlitch.value = p.glitch;
    c.uZoom.value = p.zoom;
    c.uRot.value = p.rot;
    c.uAberration.value = p.aberration;
    c.uInvert.value = p.invert;
    c.uFlash.value = p.flash;
    c.uShake.value.copy(p.shake);
    this._pass(this.compMat, null);
  }
}