// Ambiente: atardecer, mar, orilla, sombras, reflejos, salpicaduras y posprocesado. No afecta las reglas del juego.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const SHORE = -0.8;     // z donde empieza el mar (las letras están en z = 0)
export const WAVE_PERIOD = 7;  // segundos entre olas: ritmo tranquilo
export const MAX_REACH = 3;    // cuánto sube por la arena la ola más grande (pasa las letras y se devuelve)
// Cómo rodea el agua cada figura que pisa la arena. length: largo de la estela seca, en anchos de la pata.
// curve: forma del borde al cerrarse (1 = recta, como un triángulo; más de 1 = se mantiene ancha y se cierra redonda; menos de 1 = en punta).
// jet: qué tan fuerte sale el agua por debajo de los arcos (el de la A y el travesaño de la H).
export const WAKES = {
  B: { length: 2.2, curve: 1.8, jet: 0 },
  A: { length: 1.4, curve: 0.75, jet: 1 },
  H: { length: 1.9, curve: 1.25, jet: 0.8 },
  lata: { length: 2.8, curve: 2.6, jet: 0 },
};

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

// Mapa de desplazamiento del piso (alturas en unidades de la escena; p = (x, z) del mundo).
// Mar: oleaje que crece mar adentro. Arena: lomas suaves y rizos del viento, plana donde están las letras y donde moja la ola.
const HEIGHT = /* glsl */`
  uniform float uTime, uShore;
  float seaH(vec2 p){ float t = uTime;
    return .04*sin(p.y*2.2 + t*1.3 + sin(p.x*.4)) + .025*sin(p.x*1.7 - p.y*1.3 + t*1.7) + .012*noise(p*4. + t*.8) + .006*noise(p*11. - t*1.3); }
  float sandH(vec2 p){
    float dunes = (noise(p*.35) - .5)*.3 + (noise(p*.9 + 3.) - .5)*.1, ripples = .012*sin(p.y*9. + noise(p*1.3)*5.);
    return (dunes + ripples) * smoothstep(.3, 1.6, abs(p.y));
  }
  float shoreAt(float x){ return uShore + .15*(noise(vec2(x*.5, 0.)) - .5); }
  float groundH(vec2 p){
    float shore = shoreAt(p.x);
    float sand = sandH(p) * smoothstep(shore + .3, shore + 3., p.y);
    float sea = (2.5*seaH(p) + .06*sin(p.y*.8 + uTime*.9 + p.x*.1)) * smoothstep(shore, shore - 2., p.y) * smoothstep(-20., -12., p.y);
    return mix(sand, sea, smoothstep(shore + .05, shore - .25, p.y));
  }`;

// Piso denso cerca de las letras y cada vez más ralo hacia el horizonte: el desplazamiento tiene detalle donde se ve
function groundGeometry(N = 320, near = 16, far = 750) {
  const g = new THREE.PlaneGeometry(2, 2, N, N), p = g.attributes.position;
  const map = u => { const a = Math.abs(u); return Math.sign(u) * (a <= 0.75 ? a / 0.75 * near : near + (far - near) * ((a - 0.75) / 0.25) ** 3); };
  for (let i = 0; i < p.count; i++) p.setXY(i, map(p.getX(i)), map(p.getY(i)));
  g.computeBoundingSphere();
  return g;
}

// Mar + arena en un solo espejo: el agua sube por la arena, choca con las letras y las rodea
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uReach: { value: 0 }, uShore: { value: SHORE }, uFront: { value: 0.14 },
    uLetters: { value: [0, 1, 2, 3].map(() => new THREE.Vector2()) }, uCan: { value: new THREE.Vector4() }, uCanWake: { value: new THREE.Vector2(2.8, 2.6) },
    uFeet: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uGaps: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
    uSunDir: { value: new THREE.Vector3() } }, // tReflect y textureMatrix los pone el Reflector
  vertexShader: `uniform mat4 textureMatrix; varying vec3 vW; varying vec4 vRefl;
    ${NOISE}${HEIGHT}
    void main(){
      vec3 pos = position;
      pos.z += groundH((modelMatrix*vec4(pos,1.)).xz); // el plano está acostado: su z local es la altura
      vec4 w = modelMatrix*vec4(pos,1.); vW = w.xyz; vRefl = textureMatrix*vec4(pos,1.);
      gl_Position = projectionMatrix*viewMatrix*w;
    }`,
  fragmentShader: `uniform float uReach, uFront; uniform vec2 uLetters[4], uCanWake; uniform vec3 uSunDir, uGaps[4]; uniform vec4 uCan, uFeet[8];
    uniform sampler2D tReflect; varying vec3 vW; varying vec4 vRefl;
    ${NOISE}${HEIGHT}
    vec3 spectrum(float t){ return clamp(abs(fract(t + vec3(0., 2./3., 1./3.))*6. - 3.) - 1., 0., 1.); }
    vec3 haze(vec3 r){ return mix(vec3(1., .5, .25), vec3(.2, .32, .6), smoothstep(0., .35, r.y)); }
    vec3 glitter(vec3 r){ float s = max(dot(r, uSunDir), 0.); return vec3(1., .55, .25)*pow(s, 8.)*.5 + vec3(1., .85, .6)*pow(s, 900.)*80.; }
    // lo que el piso refleja (letras, lata, cielo), movido por las olas y borroso donde la arena está apenas mojada
    vec3 mirror(vec3 n, float blur){
      vec4 c = vRefl;
      c.xy += (n.xz*.08 + blur*(vec2(noise(vW.xz*40.), noise(vW.zx*40.)) - .5)) * c.w;
      return texture2DProj(tReflect, c).rgb;
    }
    // Huellas en la arena: cada pata de letra (x0, x1, largo, curva) y la lata redonda (centro, radio, en su sitio)
    float span(float x, vec2 L, float grow){ return smoothstep(L.x - grow - .04, L.x - grow + .04, x) * smoothstep(L.y + grow + .04, L.y + grow - .04, x); }
    float canBack(float x){ float dx = x - uCan.x; return -sqrt(max(uCan.y*uCan.y - dx*dx, 0.)); } // la cara de atrás de la lata es curva
    // estela seca detrás de una pata: se va cerrando según su largo y su curva, con el borde ondulado por el agua que la rodea
    float wake(vec2 p, float c, float hw, float back, float len, float curve){
      float dz = p.y - back, u = dz / (len * 2. * hw + .2);
      if (dz < 0. || u >= 1.) return 0.;
      float w = hw * pow(1. - u, 1. / curve) + .02 * sin(dz*16. - uTime*3.5 + c*9.) * u;
      return smoothstep(w + .035, w - .015, abs(p.x - c));
    }
    float dryness(vec2 p){
      float m = 0.;
      for (int i = 0; i < 8; i++) { vec4 f = uFeet[i]; if (f.y > f.x) m = max(m, wake(p, (f.x + f.y)*.5, (f.y - f.x)*.5, -uFront, f.z, f.w)); }
      if (uCan.z > .5) m = max(m, wake(p, uCan.x, uCan.y, canBack(p.x), uCanWake.x, uCanWake.y));
      return m;
    }
    float behind(vec2 p){ // franja contra la cara de atrás de lo que frena la ola
      float m = 0., k = smoothstep(-uFront - .5, -uFront, p.y) * step(p.y, -uFront + .02);
      for (int i = 0; i < 8; i++) { vec4 f = uFeet[i]; if (f.y > f.x) m = max(m, k * span(p.x, f.xy, .03)); }
      if (uCan.z > .5) { float b = canBack(p.x); m = max(m, step(abs(p.x - uCan.x), uCan.y) * smoothstep(b - .5, b, p.y) * step(p.y, b + .02)); }
      return m;
    }
    float jets(vec2 p){ // el agua que pasa por debajo de un arco sale a chorro y se abre
      float m = 0., dz = p.y + uFront;
      for (int i = 0; i < 4; i++) { vec3 g = uGaps[i]; if (g.y > g.x) {
        float hw = (g.y - g.x)*.5 + max(dz, 0.)*.15;
        m = max(m, g.z * smoothstep(hw + .03, hw - .02, abs(p.x - (g.x + g.y)*.5)) * smoothstep(-.3, 0., dz) * smoothstep(1.5, .2, dz));
      } }
      return m;
    }
    void main(){
      vec2 p = vW.xz; float z = p.y;
      vec3 V = normalize(cameraPosition - vW);
      float shore = shoreAt(p.x);
      float edge0 = shore + uReach*(1. + .25*(noise(vec2(p.x*1.1 + floor(uTime/7.)*13., 2.)) - .5));

      // Las letras no se mueven: el agua las golpea por detrás, y delante de cada una queda una estela seca
      // que se va cerrando porque el agua la rodea por los lados
      float back = -uFront, lee = dryness(p);
      float edge = mix(edge0, min(edge0, back), lee);

      float e = .03, A = 1.6;
      vec3 n = normalize(vec3(A*(seaH(p) - seaH(p + vec2(e, 0.))), e, A*(seaH(p) - seaH(p + vec2(0., e)))));
      vec3 R = reflect(-V, n);
      float F = .02 + .98*pow(1. - max(dot(n, V), 0.), 5.);
      vec3 refl = mirror(n, 0.) + glitter(R);

      // mar: más profundo y oscuro hacia el horizonte, con líneas de ola que rompen cerca de la orilla
      vec3 body = mix(vec3(.12, .5, .5), vec3(.02, .12, .2), smoothstep(shore, shore - 14., z));
      vec3 sea = mix(body, refl, F);
      float lines = smoothstep(.9, 1., sin((z - shore)*3.2 + uTime*1.4 + noise(vec2(p.x*.7, z*.5))*2.5)) * smoothstep(shore - 5., shore - .4, z);
      sea = mix(sea, vec3(1.), lines * smoothstep(.3, .8, noise(p*vec2(9., 14.) + uTime*.6)) * (.8 + .2*noise(p*60.)));

      // arena: seca lejos del agua, oscura donde las olas la mojan, con lomas iluminadas a contraluz, rizos y cuarzo
      float wet = smoothstep(uShore + MAX_WET, uShore + MAX_WET - 1., z);
      vec3 ns = normalize(vec3(groundH(p) - groundH(p + vec2(e, 0.)), e, groundH(p) - groundH(p + vec2(0., e))));
      float lit = .72 + .55*max(dot(ns, normalize(vec3(uSunDir.x, .35, uSunDir.z))), 0.) - .25*(1. - ns.y)*step(0., ns.z);
      vec3 sand = mix(vec3(.78, .58, .4), vec3(.42, .3, .2), wet) * (1. - noise(p*90.)*.07 - noise(p*6.)*.06) * lit;
      sand *= 1. - .05*sin(z*26. + noise(p*2.5)*7.);
      vec3 Rs = reflect(-V, ns);
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
      // choque: espuma revuelta contra la cara de atrás de cada letra, y espuma en los bordes de la estela por donde el agua rodea
      float push = smoothstep(back - .05, back + .3, edge0), hit = push * behind(p);
      col = mix(col, vec3(1.), hit * smoothstep(.25, .65, noise(p*vec2(16., 26.) + vec2(uTime*.7, -uTime*2.))) * .95);
      float jet = push * jets(p) * smoothstep(edge0 + .05, edge0 - .3, z); // vetas de espuma estiradas en la dirección del chorro
      col = mix(col, vec3(1.), jet * smoothstep(.35, .75, noise(vec2(p.x*38., z*5. - uTime*4.))) * .9);
      float rim = lee * (1. - lee) * 4. * smoothstep(edge0 + .05, edge0 - .3, z) * step(back, z);
      col = mix(col, vec3(1.), rim * smoothstep(.2, .6, noise(p*vec2(20., 12.) - uTime*.8)) * .8);

      // el sol está detrás: la luz que atraviesa cada letra de vidrio cae en la arena abierta en arcoíris
      float dzf = z - uFront;
      if (dzf > 0.) {
        float fade = exp(-dzf*.45) * smoothstep(0., .1, dzf);
        float caustic = pow(1. - abs(noise(p*vec2(6., 2.5) + vec2(0., -uTime*.35))*2. - 1.), 4.);
        for (int i = 0; i < 4; i++) {
          vec2 L = uLetters[i] + vec2(-.12, .12)*dzf;   // la luz se abre a medida que se aleja de la letra
          float t = (p.x - L.x)/(L.y - L.x);
          float inside = smoothstep(-.05, .1, t) * smoothstep(1.05, .9, t);
          col += spectrum(t*.85 + dzf*.25 + .04*sin(uTime*.5)) * inside * fade * (.35 + 1.6*caustic) * .9;
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
const RaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 },
    uIntensity: { value: 1 }, uThreshold: { value: 6 }, uCap: { value: 3 }, uMax: { value: 8 }, uSpread: { value: 0.08 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect, uIntensity, uThreshold, uCap, uMax, uSpread; varying vec2 vUv;
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
      gl_FragColor = vec4(base + acc/32.*uIntensity, 1.);
    }`,
};

// Acabado final, ya en colores de pantalla: aberración cromática hacia los bordes, gradación (sombras hacia el azul
// noche de la lata, luces hacia su amarillo), un poco más de contraste y saturación, viñeta y grano de película.
// uDrunk (0..1) sube con cada cerveza que se toman: la imagen ondula, se ve doble, se separan más los colores,
// se satura y la viñeta late.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 }, uDrunk: { value: 0 } },
  vertexShader: RaysShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAspect, uTime, uDrunk; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
    vec3 lens(vec2 uv, float ca){ // aberración cromática: cada canal se corre un poco hacia los bordes
      vec2 off = (uv - .5) * dot(uv - .5, uv - .5) * ca;
      return vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
    }
    void main(){
      float k = uDrunk;
      vec2 uv = vUv + k * .007 * vec2(sin(vUv.y*9. + uTime*1.3), cos(vUv.x*7. + uTime*1.1)); // ondula
      vec2 ghost = k * .014 * vec2(sin(uTime*.8), cos(uTime*.55)) * (.6 + .4*sin(uTime*.3));  // visión doble
      float ca = .014 + .06*k;
      vec3 col = mix(lens(uv, ca), lens(uv + ghost, ca), .45 * k);
      vec2 d = vUv - .5;
      float l = dot(col, vec3(.299, .587, .114));
      col *= mix(vec3(.9, .95, 1.08), vec3(1.06, 1., .9), smoothstep(.15, .85, l));
      col = mix(vec3(l), (col - .5)*1.06 + .5, 1.1 + .35*k);
      col *= mix(.6 - .25*k*(.5 + .5*sin(uTime*1.7)), 1., smoothstep(1.1, .3 - .15*k, length(d*vec2(uAspect, 1.))));
      col += (hash(vUv*vec2(1733., 911.) + fract(uTime)) - .5) * .025;
      gl_FragColor = vec4(col, 1.);
    }`,
};

// Salpicaduras: cuando la ola golpea la cara de atrás de las letras, el agua salta. Son puntos opacos
// (recortados en círculo) para que también se vean a través del vidrio.
const SPRAY = 1500, GRAVITY = 9;
function createSpray(scene) {
  const P = new Float32Array(SPRAY * 3), V = new Float32Array(SPRAY * 3), life = new Float32Array(SPRAY).fill(1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 } },
    vertexShader: `attribute float life; varying float vLife; uniform float uPx;
      void main(){ vLife = life; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        gl_PointSize = life < 1. ? uPx * .034 * (1. - life*life) / -mv.z : 0.; }`,
    fragmentShader: `varying float vLife;
      void main(){ vec2 q = gl_PointCoord*2. - 1.; if (dot(q, q) > 1. || vLife >= 1.) discard;
        gl_FragColor = vec4(vec3(.95, .98, 1.) * (1.3 - .4*dot(q, q)), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.userData.noDepth = true;
  scene.add(points);
  let next = 0;
  return {
    mat,
    burst(spans, strength) { // spans: [[x0, x1, z], ...] de lo que la ola golpea, con la z de su cara de atrás
      for (const [a, b, z] of spans) for (let k = 0; k < 220 * (b - a) * strength; k++, next = (next + 1) % SPRAY) {
        P.set([a + Math.random() * (b - a), Math.random() * 0.05, z - Math.random() * 0.06], next * 3);
        V.set([(Math.random() - 0.5) * 0.8, (1.4 + Math.random() * 3.2) * (0.6 + 0.4 * strength), -Math.random() * 0.6], next * 3);
        life[next] = 0;
      }
    },
    update(dt) {
      for (let i = 0; i < SPRAY; i++) {
        if (life[i] >= 1) continue;
        V[i * 3 + 1] -= GRAVITY * dt;
        for (let c = 0; c < 3; c++) P[i * 3 + c] += V[i * 3 + c] * dt;
        life[i] = P[i * 3 + 1] < 0 ? 1 : Math.min(1, life[i] + dt / 1.1);
      }
      geo.attributes.position.needsUpdate = geo.attributes.life.needsUpdate = true;
    },
  };
}

export function createBeach(scene, renderer, camera) {
  const sky = new Sky(); sky.scale.setScalar(1500);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.5; su.rayleigh.value = 3.5; su.mieCoefficient.value = 0.003; su.mieDirectionalG.value = 0.95;
  su.cloudCoverage.value = 0.3; su.cloudDensity.value = 0.35;

  // El piso es un espejo (Reflector) con nuestro shader de mar y arena encima
  const ground = new Reflector(groundGeometry(), { multisample: 0 });
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
  const catcherMat = new THREE.ShadowMaterial({ color: 0x3a1d06, opacity: 0.5 }); // sombra ámbar: la luz pasa por vidrio color cerveza
  catcherMat.onBeforeCompile = s => { // la sombra sigue las mismas lomas del piso
    Object.assign(s.uniforms, { uTime: groundMat.uniforms.uTime, uShore: groundMat.uniforms.uShore });
    s.vertexShader = s.vertexShader.replace('void main() {', `${NOISE}${HEIGHT}\nvoid main() {`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += groundH((modelMatrix*vec4(transformed, 1.)).xz);');
  };
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 200, 200).rotateX(-Math.PI / 2), catcherMat);
  catcher.position.y = 0.003; catcher.receiveShadow = true;
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

  const spray = createSpray(scene);

  // Posprocesado: escena con antialiasing (MSAA) → profundidad de campo enfocada en la palabra → rayos de sol →
  // resplandor (bloom) → tono de película (OutputPass) → acabado final
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 8, aperture: 0.0012, maxblur: 0.004 });
  const bokehRender = bokeh.render.bind(bokeh), hidden = [];
  bokeh.render = (...a) => { // lo transparente (chorro, salpicaduras) no debe tapar la profundidad de lo que hay detrás
    scene.traverse(o => { if (o.userData.noDepth && o.visible) { o.visible = false; hidden.push(o); } });
    bokehRender(...a);
    while (hidden.length) hidden.pop().visible = true;
  };
  composer.addPass(bokeh);
  const rays = new ShaderPass(RaysShader); composer.addPass(rays);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.12, 0.4, 2.5)); // suave: solo destellos y lo más brillante
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader); composer.addPass(grade);
  // ponytail: los rayos se calculan a resolución completa; si va lento en portátiles, pásalos a media resolución.

  const sp = new THREE.Vector3(), focus = new THREE.Vector3(0, 0.6, 0);
  let feet = [], front = 0.14, lastEdge = -Infinity, lastT = 0;
  const u = groundMat.uniforms, can = u.uCan.value;
  u.uCanWake.value.set(WAKES.lata.length, WAKES.lata.curve);
  return {
    setSun,
    setWord(spans, z) { // spans: [[x0, x1], ...] de cada letra de vidrio (para la luz que las atraviesa); z: su cara de adelante
      spans.forEach(([a, b], i) => u.uLetters.value[i].set(a, b));
      u.uFront.value = front = z;
    },
    // pies: [{ x0, x1, length, curve }] donde cada letra toca la arena; arcos: [{ x0, x1, jet }] por donde pasa el agua
    setFeet(list, arches) {
      feet = list;
      u.uFeet.value.forEach((v, i) => list[i] ? v.set(list[i].x0, list[i].x1, list[i].length, list[i].curve) : v.set(0, 0, 0, 0));
      u.uGaps.value.forEach((v, i) => arches[i] ? v.set(arches[i].x0, arches[i].x1, arches[i].jet) : v.set(0, 0, 0));
    },
    setCan(cx, r, standing) { can.set(cx, r, standing ? 1 : 0, 0); }, // la lata en su sitio también frena el agua
    setDrunk(k) { grade.uniforms.uDrunk.value = k; bokeh.uniforms.aperture.value = 0.0012 * (1 + 3 * k); }, // borracho: también desenfoca más
    setSize(w, h) {
      composer.setSize(w, h); rays.uniforms.uAspect.value = grade.uniforms.uAspect.value = w / h;
      const r = renderer.getPixelRatio() / 2; ground.getRenderTarget().setSize(Math.round(w * r), Math.round(h * r));
      spray.mat.uniforms.uPx.value = h * renderer.getPixelRatio() / 2 * camera.projectionMatrix.elements[5];
    },
    render(t, reach) {
      frame++;
      const dt = Math.min(t - lastT, 1 / 20), edge = SHORE + reach; lastT = t;
      if (lastEdge < -front && edge >= -front) { // la ola llega a la cara de atrás: salta el agua, más si viene rápido
        const strength = THREE.MathUtils.clamp((edge - lastEdge) / Math.max(dt, 1e-3) / 2.5, 0.5, 1);
        const spans = feet.map(f => [f.x0, f.x1, -front - 0.01]);
        if (can.z) spans.push([can.x - can.y * 0.8, can.x + can.y * 0.8, -can.y - 0.01]);
        spray.burst(spans, strength);
      }
      lastEdge = edge;
      spray.update(dt);
      groundMat.uniforms.uTime.value = t; groundMat.uniforms.uReach.value = reach; su.time.value = t; grade.uniforms.uTime.value = t;
      bokeh.uniforms.focus.value = camera.position.distanceTo(focus);
      sp.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      rays.uniforms.uSun.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
      composer.render();
    },
  };
}
