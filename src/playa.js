// Ambiente: atardecer, mar, orilla, sombras, reflejos y rayos de colores. No afecta las reglas del juego.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const SHORE = -0.8;     // z donde empieza el mar (las letras están en z = 0)
export const WAVE_PERIOD = 7;  // segundos entre olas: ritmo tranquilo
export const MAX_REACH = 3;    // cuánto sube por la arena la ola más grande (pasa las letras y se devuelve)

// Alcance de la ola: sube rápido, se devuelve despacio, y cada ola llega a un punto distinto
export function waveReach(t) {
  const n = Math.floor(t / WAVE_PERIOD), u = t / WAVE_PERIOD - n;
  const size = 0.55 + 0.45 * Math.abs(Math.sin(n * 2.3));
  const up = u < 0.3 ? 1 - (1 - u / 0.3) ** 2 : 1 - THREE.MathUtils.smoothstep(u, 0.3, 1);
  return MAX_REACH * size * up;
}

const NOISE = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float ridge(vec2 p){ return pow(1. - abs(noise(p)*2. - 1.), 6.); } // líneas finas, como cáusticas`;

// Mar + arena en un solo plano espejo: el agua sube por la arena hasta tocar las letras sin taparlas
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uReach: { value: 0 }, uShore: { value: SHORE }, uFront: { value: 0.14 },
    uWord: { value: new THREE.Vector2(-1, 1) }, uLetters: { value: [0, 1, 2, 3].map(() => new THREE.Vector2()) },
    uSunDir: { value: new THREE.Vector3() } }, // tReflect y textureMatrix los pone el Reflector
  vertexShader: `uniform mat4 textureMatrix; varying vec3 vW; varying vec4 vRefl;
    void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vRefl = textureMatrix*vec4(position,1.); gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uTime, uReach, uShore, uFront; uniform vec2 uWord, uLetters[4]; uniform vec3 uSunDir;
    uniform sampler2D tReflect; varying vec3 vW; varying vec4 vRefl;
    ${NOISE}
    vec3 spectrum(float t){ return clamp(abs(fract(t + vec3(0., 2./3., 1./3.))*6. - 3.) - 1., 0., 1.); }
    float H(vec2 p){ float t = uTime;
      return .04*sin(p.y*2.2 + t*1.3 + sin(p.x*.4)) + .025*sin(p.x*1.7 - p.y*1.3 + t*1.7) + .012*noise(p*4. + t*.8) + .006*noise(p*11. - t*1.3); }
    vec3 haze(vec3 r){ return mix(vec3(1., .5, .25), vec3(.2, .32, .6), smoothstep(0., .35, r.y)); }
    vec3 glitter(vec3 r){ float s = max(dot(r, uSunDir), 0.); return vec3(1., .55, .25)*pow(s, 8.)*.5 + vec3(1., .85, .6)*pow(s, 900.)*80.; }
    // lo que el piso refleja (letras, lata, cielo), movido por las olas y borroso donde la arena está apenas mojada
    vec3 mirror(vec3 n, float blur){
      vec4 c = vRefl;
      c.xy += (n.xz*.08 + blur*(vec2(noise(vW.xz*40.), noise(vW.zx*40.)) - .5)) * c.w;
      return texture2DProj(tReflect, c).rgb;
    }
    void main(){
      vec2 p = vW.xz; float z = p.y;
      vec3 V = normalize(cameraPosition - vW);
      float shore = uShore + .15*(noise(vec2(p.x*.5, 0.)) - .5);
      float edge = shore + uReach*(1. + .25*(noise(vec2(p.x*1.1 + floor(uTime/7.)*13., 2.)) - .5));

      vec3 n = normalize(vec3(H(p) - H(p + vec2(.03, 0.)), .03, H(p) - H(p + vec2(0., .03))));
      vec3 R = reflect(-V, n);
      float F = .02 + .98*pow(1. - max(dot(n, V), 0.), 5.);
      vec3 refl = mirror(n, 0.) + glitter(R);

      // mar: más profundo y oscuro hacia el horizonte, con líneas de ola que rompen cerca de la orilla
      vec3 body = mix(vec3(.12, .5, .5), vec3(.02, .12, .2), smoothstep(shore, shore - 14., z));
      vec3 sea = mix(body, refl, F);
      float lines = smoothstep(.9, 1., sin((z - shore)*3.2 + uTime*1.4 + noise(vec2(p.x*.7, z*.5))*2.5)) * smoothstep(shore - 5., shore - .4, z);
      sea = mix(sea, vec3(1.), lines * smoothstep(.3, .8, noise(p*vec2(9., 14.) + uTime*.6)) * (.8 + .2*noise(p*60.)));

      // arena: seca lejos del agua, oscura donde las olas la mojan, con rizos y destellos de cuarzo
      float wet = smoothstep(uShore + MAX_WET, uShore + MAX_WET - 1., z);
      vec3 sand = mix(vec3(.78, .58, .4), vec3(.42, .3, .2), wet) * (1. - noise(p*90.)*.07 - noise(p*6.)*.06);
      sand *= 1. - .05*sin(z*26. + noise(p*2.5)*7.);
      vec3 Rs = reflect(-V, vec3(0, 1, 0));
      sand += step(.996, hash(floor(p*240.))) * vec3(1., .9, .7) * (.4 + 3.*pow(max(dot(Rs, uSunDir), 0.), 20.));
      float Fs = .02 + .98*pow(1. - max(V.y, 0.), 5.);
      sand = mix(sand, mirror(vec3(0, 1, 0), .03), wet * Fs * .35); // la arena mojada es un espejo opaco

      // lámina de agua: deja ver la arena con cáusticas debajo, y refleja todo encima
      float sheet = smoothstep(edge, edge - .3, z);
      float wc = ridge(p*7. + uTime*.5) + .6*ridge(p*11. - uTime*.4);
      vec3 under = sand*vec3(.7, .85, .85) + wc*vec3(1., .9, .7)*.25;
      vec3 col = mix(sand, mix(under, refl, F), sheet);
      float lace = smoothstep(edge - .16, edge - .03, z) * smoothstep(edge + .01, edge - .03, z);
      col = mix(col, vec3(1.), lace * smoothstep(.3, .7, noise(p*vec2(14., 22.) + uTime)) * (.75 + .25*noise(p*70.)));
      // espuma donde el agua choca con las letras
      float ring = step(uWord.x, p.x) * step(p.x, uWord.y) * step(uFront, edge) * smoothstep(uFront + .16, uFront, z) * step(uFront - .02, z);
      col = mix(col, vec3(1.), ring * .85 * smoothstep(.25, .75, noise(p*vec2(18., 30.) - uTime*.5)));

      // el sol está detrás: la luz que atraviesa cada letra de vidrio cae en la arena abierta en arcoíris
      float dz = z - uFront;
      if (dz > 0.) {
        float fade = exp(-dz*.45) * smoothstep(0., .1, dz);
        float caustic = pow(1. - abs(noise(p*vec2(6., 2.5) + vec2(0., -uTime*.35))*2. - 1.), 4.);
        for (int i = 0; i < 4; i++) {
          vec2 L = uLetters[i] + vec2(-.12, .12)*dz;   // la luz se abre a medida que se aleja de la letra
          float t = (p.x - L.x)/(L.y - L.x);
          float inside = smoothstep(-.05, .1, t) * smoothstep(1.05, .9, t);
          col += spectrum(t*.85 + dz*.25 + .04*sin(uTime*.5)) * inside * fade * (.35 + 1.6*caustic) * .9;
        }
      }

      col = mix(sea, col, smoothstep(shore - .25, shore + .05, z));
      col = mix(col, haze(normalize(vec3(-V.x, .01, -V.z))), smoothstep(40., 500., length(vW - cameraPosition)));
      gl_FragColor = vec4(col, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`.replaceAll('MAX_WET', (MAX_REACH + 0.4).toFixed(2)),
});

// Rayos: cada píxel brillante se arrastra hacia el sol. Cada canal de color sale con un ángulo
// un poco distinto, así los bordes de cada rayo se abren en arcoíris como luz que pasa por un prisma.
// Al final, viñeta y grano de película.
const RaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uTime: { value: 0 },
    uIntensity: { value: 1 }, uThreshold: { value: 6 }, uCap: { value: 3 }, uMax: { value: 8 }, uSpread: { value: 0.08 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect, uTime, uIntensity, uThreshold, uCap, uMax, uSpread; varying vec2 vUv;
    vec2 rot(vec2 d, float a){ d.x *= uAspect; d = mat2(cos(a), sin(a), -sin(a), cos(a)) * d; d.x /= uAspect; return d; }
    vec3 bright(vec2 uv){ // umbral por luminancia: conserva el color (por canal, el halo naranja dejaba solo rojo)
      vec3 c = texture2D(tDiffuse, uv).rgb; float l = dot(c, vec3(.2126, .7152, .0722));
      return min(c * max(l - uThreshold, 0.) / max(l, 1e-4), vec3(uCap));
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
    void main(){
      vec3 base = min(texture2D(tDiffuse, vUv).rgb, vec3(uMax)), acc = vec3(0.); // el sol es enorme en HDR: se recorta
      vec2 d = vUv - uSun, dr = rot(d, -uSpread), db = rot(d, uSpread);
      float w = 1., j = hash(vUv) / 32.;
      for (int i = 0; i < 32; i++) {
        float m = 1. - (float(i)/32. + j)*.8;
        acc += vec3(bright(uSun + dr*m).r, bright(uSun + d*m).g, bright(uSun + db*m).b) * w;
        w *= .95;
      }
      vec3 col = base + acc/32.*uIntensity;
      col *= mix(.55, 1., smoothstep(1.1, .3, length((vUv - .5)*vec2(uAspect, 1.))));  // viñeta
      col *= 1. + (hash(vUv*vec2(1733., 911.) + fract(uTime)) - .5) * .06;                // grano
      gl_FragColor = vec4(col, 1.);
    }`,
};

export function createBeach(scene, renderer, camera) {
  const sky = new Sky(); sky.scale.setScalar(1500);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.5; su.rayleigh.value = 3.5; su.mieCoefficient.value = 0.003; su.mieDirectionalG.value = 0.95;
  su.cloudCoverage.value = 0.3; su.cloudDensity.value = 0.35;

  // El piso es un espejo (Reflector) con nuestro shader de mar y arena encima
  const ground = new Reflector(new THREE.PlaneGeometry(1500, 1500), { multisample: 0 });
  groundMat.uniforms.tReflect = ground.material.uniforms.tDiffuse;
  groundMat.uniforms.textureMatrix = ground.material.uniforms.textureMatrix;
  ground.material = groundMat; ground.rotation.x = -Math.PI / 2;
  let frame = 0, reflected = -1;
  const reflect = ground.onBeforeRender; // el pase de transmisión del vidrio también dibuja el piso: reflejar una vez por cuadro
  ground.onBeforeRender = (...a) => { if (reflected !== frame) { reflected = frame; reflect.apply(ground, a); } };
  scene.add(ground);

  // Sombras: una luz desde detrás y más alta que el sol real, para que las sombras lleguen hacia quien mira
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const sunLight = new THREE.DirectionalLight(0xffb36b, 2.2);
  sunLight.position.set(0.8, 3, -7); sunLight.castShadow = true;
  Object.assign(sunLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.shadow.mapSize.set(2048, 2048); sunLight.shadow.radius = 4; sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.02;
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: 0x3a1d06, opacity: 0.5 }));
  catcher.position.y = 0.003; catcher.receiveShadow = true; // sombra ámbar: la luz pasa por vidrio color cerveza
  scene.add(sunLight, catcher);

  const sunDir = new THREE.Vector3();
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2).translate(0, -5, 0),
    new THREE.MeshBasicMaterial({ color: 0x9c7a5a }))); // arena para lo que se refleja abajo
  function setSun(elevation, azimuth = 0) { // radianes; el sol queda detrás de las letras (−z)
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - elevation, Math.PI + azimuth);
    su.sunPosition.value.copy(sunDir); groundMat.uniforms.uSunDir.value.copy(sunDir);
    envScene.add(sky); // el cielo también ilumina y se refleja en el vidrio y la lata
    scene.environment?.dispose();
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 3000).texture;
    scene.add(sky);
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const rays = new ShaderPass(RaysShader); composer.addPass(rays);
  composer.addPass(new OutputPass());
  // ponytail: los rayos se calculan a resolución completa; si va lento en portátiles, pásalos a media resolución.

  const sp = new THREE.Vector3();
  return {
    setSun,
    setWord(letters, front) { // letters: [[x0, x1], ...] de cada letra de vidrio
      const u = groundMat.uniforms;
      letters.forEach(([a, b], i) => u.uLetters.value[i].set(a, b));
      u.uWord.value.set(letters[0][0], letters.at(-1)[1]); u.uFront.value = front;
    },
    setSize(w, h) {
      composer.setSize(w, h); rays.uniforms.uAspect.value = w / h;
      const r = renderer.getPixelRatio() / 2; ground.getRenderTarget().setSize(Math.round(w * r), Math.round(h * r));
    },
    render(t, reach) {
      frame++;
      groundMat.uniforms.uTime.value = t; groundMat.uniforms.uReach.value = reach; su.time.value = t; rays.uniforms.uTime.value = t;
      sp.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      rays.uniforms.uSun.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
      composer.render();
    },
  };
}
