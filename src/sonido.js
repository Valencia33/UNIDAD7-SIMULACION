// Sonido hecho a mano con Web Audio, sin archivos. Ruido filtrado para el mar, el viento, el chorro y la espuma;
// osciladores para el vidrio, las burbujas, el metal de la lata, las gaviotas y una cumbia que entra con la borrachera.
// El navegador solo deja sonar después del primer toque, así que todo arranca con start(). La tecla M silencia.

const midi = n => 440 * 2 ** ((n - 69) / 12);

// ---- Cumbia (original, sintetizada): 98 BPM, La menor, alterna La menor y Mi7 cada compás ----
// Cada capa entra cuando la borrachera pasa su umbral: guacharaca y tambora, luego bajo, acordeón y gaita.
const BPM = 98, SIX = 60 / BPM / 4; // duración de una semicorchea
const CHORDS = [[57, 60, 64], [56, 59, 62, 64]];   // La menor, Mi7 (acordeón a contratiempo)
const BASS = [[45, 52], [40, 47]];                  // tónica y quinta de cada acorde
const MELODY = [ // gaita, en corcheas: 4 compases (null = silencio)
  76, 76, 74, 72, 74, 72, 71, 69,
  68, null, 71, 74, 76, null, 74, 71,
  69, 72, 76, 81, 79, 77, 76, 74,
  76, 74, 72, 71, 68, null, 69, null,
];
const LAYERS = { guacharaca: 0.12, tambora: 0.12, bajo: 0.3, acordeon: 0.45, gaita: 0.6 }; // borrachera a la que entra cada una

export function createSound() {
  let ctx = null, master, noise, crackle, muted = false, gurgleAt = 0, lastUpdate = 0, bubbles = 0;
  let music = null, drunk = 0, nextStep = 0, step = 0;
  const layers = {};
  const now = () => ctx.currentTime;
  const set = (param, v, tc = 0.1) => param.setTargetAtTime(v, now(), tc);
  const buffer = fn => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = fn(); return b; };
  const filter = (type, f, Q = 0.7) => ctx && Object.assign(ctx.createBiquadFilter(), { type }, { _f: f, _Q: Q }); // sin audio todavía: nada
  function chain(src, filters, vol, pan = 0, dest = master) { // fuente → filtros → volumen → paneo → salida
    const g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.value = vol; p.pan.value = pan;
    let node = src;
    for (const f of filters) { f.frequency.value = f._f; f.Q.value = f._Q; node.connect(f); node = f; }
    node.connect(g); g.connect(p); p.connect(dest);
    return { g, p, f: filters };
  }
  function loop(buf, filters, vol) { // capa continua
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random();
    const c = chain(s, filters, vol); s.start(); return c;
  }
  const env = (g, t, vol, attack, dur) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(1e-4, t + dur); };
  // golpe de ruido: el filtro barre de f0 a f1
  function burst(type, f0, f1, dur, vol, { pan = 0, delay = 0, attack = 0.005, Q = 0.8, at = null, dest } = {}) {
    if (!ctx || muted) return;
    const s = ctx.createBufferSource(); s.buffer = noise; const t = at ?? now() + delay;
    const c = chain(s, [filter(type, f0, Q)], 0, pan, dest);
    c.f[0].frequency.setValueAtTime(f0, t); c.f[0].frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c.g, t, vol, attack, dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // tono: la frecuencia va de f0 a f1
  function tone(f0, f1, dur, vol, { type = 'sine', pan = 0, delay = 0, attack = 0.005, at = null, dest, filters = [] } = {}) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), t = at ?? now() + delay; o.type = type;
    const c = chain(o, filters, 0, pan, dest);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c.g, t, vol, attack, dur);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // vidrio: parciales inarmónicos que se apagan a distinto ritmo
  function clink(f, { pan = 0, delay = 0, vol = 0.06 } = {}) {
    [[1, 1, 1.1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.3], [8.9, 0.12, 0.15]].forEach(([k, a, d]) => tone(f * k, f * k * 0.998, d, vol * a, { pan, delay }));
  }
  // burbuja: un tono cortito que sube (así suena el líquido de verdad)
  const bubble = (f, pan) => tone(f, f * (1.4 + Math.random() * 0.4), 0.03 + Math.random() * 0.05, 0.03 + Math.random() * 0.05, { pan, attack: 0.002 });
  function gull() { // dos o tres graznidos de gaviota a lo lejos, de un lado
    const pan = Math.random() * 1.6 - 0.8, n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), t = now() + i * 0.32; o.type = 'sawtooth';
      const c = chain(o, [filter('bandpass', 1700, 3)], 0, pan);
      o.frequency.setValueAtTime(1250, t); o.frequency.linearRampToValueAtTime(1900, t + 0.07); o.frequency.exponentialRampToValueAtTime(1050, t + 0.26);
      env(c.g, t, muted ? 0 : 0.022, 0.03, 0.28);
      o.start(t); o.stop(t + 0.3);
    }
    setTimeout(gull, 9000 + Math.random() * 14000);
  }

  // ---- la cumbia ----
  function playStep(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16, beat = Math.floor(s / 4), sub = s % 4, chord = bar % 2;
    const out = 0.01 * drunk, f = n => midi(n) * (1 + (Math.random() - 0.5) * out); // borracho: un poquito desafinado
    const L = music;
    // guacharaca: "chi-chi-cháa" en cada tiempo
    if (sub < 3) burst('bandpass', 5200, 3800, sub === 2 ? 0.13 : 0.04, sub === 2 ? 0.5 : 0.3, { at: t, Q: 1.4, attack: sub === 2 ? 0.03 : 0.004, dest: L.guacharaca });
    // tambora en el 1 y el 3 (con un golpecito antes del 3), alegre en el 2 y el 4
    if (s === 0 || s === 8) tone(120, 45, 0.28, 0.9, { at: t, dest: L.tambora });
    if (s === 7) tone(110, 50, 0.18, 0.45, { at: t, dest: L.tambora });
    if (s === 4 || s === 12) { tone(240, 170, 0.14, 0.5, { at: t, dest: L.tambora }); burst('bandpass', 1800, 900, 0.06, 0.25, { at: t, dest: L.tambora }); }
    // bajo: tónica en el 1 y el 3, quinta a contratiempo
    if (s === 0 || s === 8) tone(f(BASS[chord][0]), f(BASS[chord][0]), SIX * 3, 0.5, { at: t, type: 'triangle', dest: L.bajo });
    if (s === 6 || s === 14) tone(f(BASS[chord][1]), f(BASS[chord][1]), SIX * 2, 0.4, { at: t, type: 'triangle', dest: L.bajo });
    // acordeón: el acorde a contratiempo
    if (sub === 2) for (const n of CHORDS[chord]) for (const d of [-0.004, 0.004])
      tone(f(n) * (1 + d), f(n) * (1 + d), SIX * 1.6, 0.06, { at: t, type: 'sawtooth', attack: 0.01, dest: L.acordeon, filters: [filter('lowpass', 1800)] });
    // gaita: la melodía en corcheas
    const m = MELODY[bar * 8 + Math.floor(s / 2)];
    if (sub % 2 === 0 && m) {
      const o = tone(f(m), f(m), SIX * 1.8, 0.22, { at: t, type: 'triangle', attack: 0.02, dest: L.gaita, filters: [filter('bandpass', 1400, 0.8)] });
      if (o) { // vibrato de soplo
        const vib = ctx.createOscillator(), depth = ctx.createGain();
        vib.frequency.value = 5.5; depth.gain.value = f(m) * 0.008; vib.connect(depth); depth.connect(o.frequency);
        vib.start(t); vib.stop(t + SIX * 1.9);
      }
    }
  }
  function schedule() { // programa con 1.5 s de anticipación: aguanta aunque la pestaña ande lenta
    if (!music || drunk < LAYERS.guacharaca) { if (ctx) nextStep = now() + 0.1; return; }
    while (nextStep < now() + 1.5) { playStep(step, nextStep); nextStep += SIX; step = (step + 1) % 64; }
  }

  return {
    start() {
      if (ctx) return void ctx.resume();
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
      noise = buffer(() => Math.random() * 2 - 1);
      crackle = buffer(() => (Math.random() < 0.003 ? Math.random() * 2 - 1 : 0)); // chasquidos sueltos: burbujas que revientan
      layers.sea = loop(noise, [filter('lowpass', 400)], 0.1);          // el mar de fondo
      layers.surf = loop(noise, [filter('bandpass', 2600, 0.6)], 0);    // la espuma que se devuelve
      layers.wind = loop(noise, [filter('bandpass', 650, 0.5)], 0.025);
      layers.pour = loop(noise, [filter('bandpass', 800, 1.4)], 0);     // el chorro
      layers.fizz = loop(crackle, [filter('highpass', 3000)], 0);       // la espuma burbujeando
      music = { bus: ctx.createGain() }; music.bus.gain.value = 0; music.bus.connect(master);
      for (const k in LAYERS) { music[k] = ctx.createGain(); music[k].gain.value = 0; music[k].connect(music.bus); }
      setInterval(schedule, 200);
      setTimeout(gull, 4000);
      lastUpdate = now();
      addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') { muted = !muted; set(master.gain, muted ? 0 : 0.9, 0.05); } });
    },
    // cada cuadro. s: { reach (0..3), rising (la ola sube), pour (0..1), fill (0..1 o null si cae fuera), x (paneo), fizz (0..1) }
    update(s) {
      if (!ctx) return;
      const r = s.reach / 3, L = layers, dt = Math.min(now() - lastUpdate, 0.1); lastUpdate = now();
      set(L.sea.g.gain, 0.08 + (s.rising ? 0.22 * r : 0.05 * r), 0.4); set(L.sea.f[0].frequency, 300 + 900 * r, 0.4);
      set(L.surf.g.gain, s.rising ? 0 : 0.09 * r, 0.5);
      const pan = Math.max(-1, Math.min(1, s.x / 2));
      set(L.pour.g.gain, 0.12 * s.pour, 0.05); set(L.pour.p.pan, pan);
      if (now() > gurgleAt) { gurgleAt = now() + 0.05 + Math.random() * 0.05; set(L.pour.f[0].frequency, s.fill === null ? 250 + Math.random() * 200 : 550 + Math.random() * 550, 0.02); }
      // la cerveza entrando al vaso: burbujas, y su tono sube a medida que el vaso se llena
      if (s.pour && s.fill !== null) for (bubbles += dt * 34; bubbles >= 1; bubbles--) bubble((380 + 1300 * s.fill) * (0.8 + Math.random() * 0.6), pan);
      set(L.fizz.g.gain, 0.5 * s.fizz, 0.2);
    },
    // borrachera 0..1: sube la cumbia capa por capa
    setDrunk(d) {
      drunk = d;
      if (!music) return;
      set(music.bus.gain, d > LAYERS.guacharaca ? 0.25 + 0.35 * Math.min(1, (d - LAYERS.guacharaca) / 0.5) : 0, 1);
      for (const k in LAYERS) set(music[k].gain, d > LAYERS[k] ? Math.min(1, (d - LAYERS[k]) / 0.08) : 0, 0.8);
    },
    canOpen(x) { // clic de la anilla, el "psst" del gas y el tintineo de la tapa al hundirse
      const pan = x / 2;
      tone(3200, 2600, 0.025, 0.08, { type: 'square', pan });
      burst('highpass', 5000, 2200, 0.55, 0.3, { pan, delay: 0.02, attack: 0.008 });
      tone(2400, 2350, 0.18, 0.05, { pan, delay: 0.09 });
    },
    waveHit(strength) { // la ola contra el vidrio: golpe sordo, salpicadura y el vidrio que resuena
      burst('lowpass', 2400, 280, 1, 0.32 * strength, { attack: 0.03 });
      burst('bandpass', 3200, 1400, 0.7, 0.12 * strength, { delay: 0.08, Q: 0.6 });
      tone(610, 590, 0.4, 0.05 * strength, { delay: 0.02 }); tone(1830, 1800, 0.3, 0.025 * strength, { delay: 0.02 });
    },
    // la letra se llena: la espuma se asienta y suena el vidrio; servido perfecto: "¡salud!" (dos copas) y una marimba que sube
    done(perfect, x) {
      const pan = x / 2;
      tone(420, 210, 0.09, 0.08, { pan }); // "plop" de la espuma al asentarse
      clink(1850, { pan, delay: 0.04 });
      if (perfect) {
        clink(2230, { pan: -pan, delay: 0.13, vol: 0.05 });
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { tone(f, f, 0.45, 0.07, { pan, delay: 0.24 + i * 0.075 }); tone(f * 4, f * 4, 0.12, 0.015, { pan, delay: 0.24 + i * 0.075 }); });
      }
    },
    // tomársela: un sorbo para empezar, tragos y un "aaah" al final
    sip(x) { burst('bandpass', 1200, 3200, 0.4, 0.07, { pan: x / 2, attack: 0.05, Q: 2 }); },
    gulp(x) {
      const pan = x / 2;
      burst('lowpass', 900, 200, 0.08, 0.06, { pan });                // la garganta
      tone(330, 110, 0.15, 0.22, { pan, delay: 0.01 });                 // el trago
      tone(260, 140, 0.1, 0.1, { pan, delay: 0.1 });                    // y su eco más chico
    },
    ahh() { // vocal "aaah" con dos formantes, de satisfacción
      if (!ctx || muted) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = now(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(175, t); o.frequency.exponentialRampToValueAtTime(118, t + 1);
      for (const [f, q, a] of [[780, 6, 1], [1180, 7, 0.6], [2600, 8, 0.2]]) { const b = filter('bandpass', f, q), h = ctx.createGain(); b.frequency.value = f; b.Q.value = q; h.gain.value = a; o.connect(b); b.connect(h); h.connect(g); }
      g.connect(master); env(g, t, 0.35, 0.1, 1.1);
      o.start(t); o.stop(t + 1.15);
      burst('bandpass', 1500, 900, 1, 0.03, { attack: 0.1 });         // el aire
    },
    splat(n, x) { if (n) burst('lowpass', 900, 250, 0.12, Math.min(0.12, 0.012 * n), { pan: x / 2 }); },
    slosh() { burst('lowpass', 700, 240, 0.45, 0.08, { attack: 0.05 }); },
    // la voz de la lata
    boing() { tone(280, 700, 0.16, 0.07, { type: 'triangle' }); },
    tink() { tone(2200, 2150, 0.12, 0.05); tone(3350, 3300, 0.08, 0.025); },
    whoosh() { burst('bandpass', 400, 1700, 0.35, 0.08, { attack: 0.08, Q: 1.2 }); },
    squeak() { tone(850, 1500, 0.28, 0.035, { attack: 0.05 }); },
    boop() { tone(520, 440, 0.12, 0.06, { type: 'triangle' }); },
    tick() { tone(3000, 2900, 0.025, 0.025, { type: 'square' }); },
    hic() { tone(330, 620, 0.09, 0.08, { type: 'sawtooth', filters: [filter('bandpass', 1300, 2)] }); burst('highpass', 3000, 2000, 0.03, 0.05); },
  };
}
