// Modelo del servido. Una sola regla: la altura desde la que sirves decide cuánta espuma hay.
// Cambia un parámetro, predice qué pasa y compruébalo con: node verificar.mjs

export const POUR_RATE = 0.3;      // fracción del vaso que entra por segundo
export const FOAM_EXPANSION = 2.2; // la espuma ocupa más volumen que el líquido
export const H_FOAMY = 3;          // altura sobre el borde del vaso a la que el chorro es 50 % espuma
export const FULL = 0.95;          // el vaso se da por servido al llegar a este nivel
export const FINGER = 0.09;        // 1 dedo de espuma = 9 % de la altura del vaso
export const PERFECT = [1.4, 3];   // dedos de espuma que cuentan como servido perfecto

// Parte del chorro que se vuelve espuma según la altura h (en alturas de vaso ≈ unidades de la escena)
export const foamShare = h => Math.min(Math.max(h / H_FOAMY, 0), 1) * 0.5;

// Un paso de servido: suma líquido y espuma. Devuelve true cuando el vaso está lleno.
export function pour(g, h, dt) {
  const s = foamShare(h), dv = POUR_RATE * dt;
  g.level += dv * (1 - s);
  g.foam += dv * s * FOAM_EXPANSION;
  return g.level + g.foam >= FULL;
}

export function grade(foam) {
  const fingers = foam / FINGER;
  return fingers < PERFECT[0] ? 'plana' : fingers > PERFECT[1] ? 'espumosa' : 'perfecta';
}
