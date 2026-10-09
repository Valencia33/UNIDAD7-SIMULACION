// La lata tiene personalidad: mientras nadie la agarra hace cosas para que la agarren, sin decir nada.
// Cada acción es una coreografía corta: una curva en el tiempo (u de 0 a 1) que mueve
//   y: salto · sq: estirón (+) o aplastón (−) · lean: inclinación de lado · fwd: inclinación hacia quien mira
//   spin: giro · tab: la anilla · bend: curva del rig
// y lanza sonidos en momentos precisos (cues).

const bump = (u, a, b) => (u > a && u < b ? Math.sin(Math.PI * (u - a) / (b - a)) : 0); // pulso suave entre a y b
const hop = (u, a, b, h) => { const t = (u - a) / (b - a); return t > 0 && t < 1 ? 4 * h * t * (1 - t) : 0; }; // salto parabólico
const hold = (u, k = 0.18) => Math.min(1, u / k, (1 - u) / k); // entra, se sostiene y sale

export const ACTIONS = {
  // "¡aquí, aquí!": dos saltitos con aplastón al despegar y al caer
  saltitos: { dur: 1.2, weight: 3, cues: [[0.15, 'boing'], [0.45, 'tink'], [0.55, 'boing'], [0.85, 'tink']],
    f: u => ({ y: hop(u, 0.15, 0.45, 0.16) + hop(u, 0.55, 0.85, 0.12), lean: 0.06 * Math.sin(u * Math.PI * 2),
      sq: -0.14 * bump(u, 0.04, 0.17) + 0.1 * bump(u, 0.17, 0.3) - 0.12 * bump(u, 0.42, 0.56) + 0.08 * bump(u, 0.56, 0.66) - 0.1 * bump(u, 0.82, 0.96) }) },
  // se estira como quien bosteza y se sacude
  estirarse: { dur: 2.2, weight: 1, cues: [[0.22, 'squeak'], [0.78, 'tink']],
    f: u => ({ sq: -0.12 * bump(u, 0, 0.22) + 0.2 * bump(u, 0.18, 0.78) + (u > 0.78 ? 0.06 * Math.sin(u * 60) * (1 - u) * 4 : 0),
      lean: 0.1 * Math.sin(u * Math.PI * 3) * bump(u, 0.2, 0.78) }) },
  // se asoma hacia quien mira, como diciendo "¿y tú qué esperas?", y levanta un poco la anilla
  asomarse: { dur: 2.4, weight: 3, cues: [[0.18, 'boop'], [0.5, 'tick']],
    f: u => ({ fwd: 0.38 * hold(u, 0.2), sq: 0.05 * hold(u, 0.2), y: 0.03 * bump(u, 0.4, 0.6), tab: 0.25 * bump(u, 0.3, 0.85) }) },
  // salta y da una vuelta completa
  pirueta: { dur: 1.3, weight: 1, cues: [[0.25, 'boing'], [0.36, 'whoosh'], [0.75, 'tink']],
    f: u => { const s = Math.min(1, Math.max(0, (u - 0.27) / 0.46));
      return { y: hop(u, 0.25, 0.75, 0.38), spin: (s * s * (3 - 2 * s)) * Math.PI * 2,
        sq: -0.18 * bump(u, 0, 0.26) + 0.15 * bump(u, 0.25, 0.42) - 0.16 * bump(u, 0.72, 0.9) }; } },
  // se inclina hacia una letra vacía y asiente dos veces: "ahí, ahí"
  señalar: { dur: 2.4, weight: 2, cues: [[0.42, 'boop'], [0.62, 'boop']],
    f: (u, dir) => { const e = hold(u, 0.2);
      return { lean: -dir * 0.3 * e, bend: -dir * 0.22 * e, y: 0.05 * bump(u, 0.35, 0.5) + 0.05 * bump(u, 0.55, 0.7) }; } },
  // saluda moviendo la anilla
  saludar: { dur: 1.6, weight: 2, cues: [[0.15, 'tick'], [0.35, 'tick'], [0.55, 'tick'], [0.75, 'tick']],
    f: u => ({ tab: 0.45 * Math.abs(Math.sin(u * Math.PI * 5)) * hold(u, 0.1), lean: 0.08 * Math.sin(u * Math.PI * 2), sq: 0.04 * hold(u) }) },
  // golpecitos de impaciencia (solo si la ignoran un buen rato)
  impaciente: { dur: 2, weight: 0, cues: [0.08, 0.25, 0.42, 0.58, 0.75, 0.92].map(u => [u, 'tick']),
    f: u => ({ y: 0.025 * Math.abs(Math.sin(u * Math.PI * 6)), lean: 0.05 * Math.sin(u * Math.PI * 3), sq: -0.03 * Math.abs(Math.sin(u * Math.PI * 6)) }) },
  // con unas cervezas encima, le da hipo
  hipo: { dur: 0.7, weight: 0, cues: [[0.04, 'hic']],
    f: u => ({ y: hop(u, 0, 0.35, 0.08), sq: 0.12 * bump(u, 0, 0.15) - 0.08 * bump(u, 0.33, 0.5), lean: 0.08 * bump(u, 0, 0.6) }) },
  // la ola la asusta: brinca hacia arriba
  susto: { dur: 0.9, weight: 0, cues: [[0, 'boing'], [0.6, 'tink']],
    f: u => ({ y: hop(u, 0, 0.6, 0.22), sq: 0.15 * bump(u, 0, 0.2) - 0.12 * bump(u, 0.55, 0.78), spin: 0.25 * bump(u, 0, 0.6), tab: 0.3 * bump(u, 0, 0.6) }) },
  // servido perfecto: pirueta con la anilla agitándose
  celebrar: { dur: 1.4, weight: 0, cues: [[0.2, 'boing'], [0.32, 'whoosh'], [0.78, 'tink']],
    f: u => ({ ...ACTIONS.pirueta.f(u), tab: 0.4 * Math.abs(Math.sin(u * Math.PI * 7)) }) },
};

export function createActor(sound) {
  let act = null, name = '', start = 0, next = 2, idleSince = 0, w = 0, perk = 0, queued = null, last = '';
  const out = { y: 0, sq: 0, lean: 0, fwd: 0, spin: 0, tab: 0, bend: 0 };
  const play = (n, t) => { act = ACTIONS[n]; name = n; start = t; };
  const weightOf = (n, a, c) => n === 'impaciente' ? (c.t - idleSince > 14 ? 2 : 0)
    : n === 'hipo' ? (c.drunk > 0.25 ? 4 * c.drunk : 0)
    : n === 'señalar' ? (c.opened && c.dir ? a.weight : 0)
    : n === 'saludar' && !c.opened ? a.weight * 2 : a.weight;
  return {
    trigger(n) { queued = n; }, // susto o celebración: suena en cuanto la lata esté libre
    // ctx: { t, dt, idle (nadie la toca), opened, served, dir (hacia la letra vacía: -1 izquierda, 1 derecha, 0 ninguna),
    //        near (el puntero está cerca: 0..1), toward (hacia dónde está el puntero: -1..1), drunk (0..1) }
    update(c) {
      if (!c.idle) { idleSince = c.t; if (!act) next = c.t + 2.5; }
      if (c.idle && !act && queued) { play(queued, c.t); queued = null; }
      if (c.idle && !act && c.t > next) {
        const bag = Object.entries(ACTIONS).map(([n, a]) => [n, n === last ? 0 : weightOf(n, a, c)]).filter(([, wt]) => wt > 0);
        let r = Math.random() * bag.reduce((s, [, wt]) => s + wt, 0);
        for (const [n, wt] of bag) if ((r -= wt) <= 0) { play(n, c.t); last = n; break; }
      }
      for (const k in out) out[k] = 0;
      if (act) {
        const u0 = (c.t - c.dt - start) / act.dur, u = (c.t - start) / act.dur;
        if (u >= 1) { act = null; next = c.t + (c.served ? 5 + Math.random() * 4 : 1.6 + Math.random() * 2); }
        else {
          Object.assign(out, act.f(Math.max(0, u), c.dir || 1));
          for (const [cu, s] of act.cues) if (u0 < cu && u >= cu) sound[s]?.();
        }
      }
      // si el puntero se acerca, se endereza atenta, mira hacia él y levanta un poco la anilla
      perk += ((c.idle ? c.near : 0) - perk) * Math.min(1, 6 * c.dt);
      out.sq += 0.07 * perk; out.lean += -0.18 * c.toward * perk; out.fwd += 0.15 * perk; out.tab += 0.2 * perk;
      // borracha se tambalea: más cuanto más ha tomado
      out.lean += c.drunk * 0.12 * Math.sin(c.t * 1.3); out.fwd += c.drunk * 0.06 * Math.sin(c.t * 0.9 + 1);
      // cuando la agarran, la actuación se apaga suave en vez de cortarse
      w += ((c.idle ? 1 : 0) - w) * Math.min(1, 6 * c.dt);
      for (const k in out) out[k] *= w;
      return out;
    },
  };
}
