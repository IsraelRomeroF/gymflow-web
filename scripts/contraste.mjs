// Prueba de contraste de los tokens de color (UI2-01, UI2-02, UI3-02, UI3-03).
//
// Lee app/globals.css (y los archivos de app/estilos/ que importa: desde el bloque 2.12 globals.css es
// solo el índice y los tokens derivados viven en estilos/base.css), resuelve los tokens del tema claro y del oscuro, y
// exige AA: 4.5:1 en los pares que llevan texto y 3:1 en los contornos que
// identifican un control. Corre en CI: un token que alguien "aclara un poco"
// ya no pasa sin que nadie lo note.
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  .replace(/@import '\.\/(estilos\/[\w-]+\.css)';/g, (_, archivo) => readFileSync(new URL(`../app/${archivo}`, import.meta.url), 'utf8'));

/** Todas las propiedades `--x: valor;` del bloque que abre en `selector {`. */
function bloque(selector) {
  const ini = css.indexOf(selector);
  if (ini < 0) return null;
  const out = {};
  for (const m of css.slice(ini, css.indexOf('}', ini)).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}
const soloColores = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => /^#[0-9a-f]{6}$/.test(v)));

let fallos = 0;
const falla = (msg) => { fallos++; console.log(`FALLA ${msg}`); };

const base = bloque(':root {');
// El oscuro está escrito DOS veces: para quien lo elige con el selector y
// para quien lo trae del sistema, que es casi todo el mundo. CSS no deja
// compartir la lista, así que aquí se exige que sean la misma.
const elegido = bloque(':root[data-theme="dark"]');
const delSistema = bloque(':root:not([data-theme="light"])');
if (!base || !elegido || !delSistema) {
  console.log('FALLA: no se encontraron los tres bloques de tokens (claro, oscuro elegido y oscuro del sistema)');
  process.exit(1);
}
for (const k of new Set([...Object.keys(elegido), ...Object.keys(delSistema)])) {
  if (elegido[k] !== delSistema[k]) falla(`oscuro: --${k} vale ${elegido[k] ?? '(nada)'} con el selector y ${delSistema[k] ?? '(nada)'} con el tema del sistema`);
}

// Los tokens compartidos (app/tokens.css, idéntico en panel y portal) ganan a los de globals.css.
const compartidos = readFileSync(new URL('../app/tokens.css', import.meta.url), 'utf8');
const bloqueDe = (texto, selector) => {
  const ini = texto.indexOf(selector);
  if (ini < 0) return {};
  const out = {};
  for (const m of texto.slice(ini, texto.indexOf('}', ini)).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
};
const claro = { ...soloColores(base), ...soloColores(bloqueDe(compartidos, ':root:root {')) };
const oscuro = { ...claro, ...soloColores(elegido), ...soloColores(bloqueDe(compartidos, ':root:root[data-theme="dark"]')) };

const lum = (h) => {
  const c = h.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Pares que solo existen si el repositorio define ese token (panel o portal). */
const si = (token, pares) => (claro[token] ? pares : []);

// [color, fondo, mínimo]
const PARES = [
  // Texto: 4.5:1.
  ['fg', 'bg', 4.5], ['fg', 'surface', 4.5], ['fg-2', 'surface', 4.5],
  ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5], ['muted', 'bg', 4.5],
  ['faint', 'surface', 4.5],
  ['primary-fg', 'primary', 4.5],
  ['ok', 'surface', 4.5], ['warn', 'surface', 4.5], ['danger', 'surface', 4.5], ['info', 'surface', 4.5],
  ...si('surface-sunken', [['muted', 'surface-sunken', 4.5]]),
  ...si('danger-solid', [['danger-solid-fg', 'danger-solid', 4.5]]),
  // Texto sobre tinta: la tarjeta destacada y la barra lateral del panel, la
  // credencial y el encabezado del portal.
  ...si('feature-bg', [['feature-fg', 'feature-bg', 4.5], ['feature-muted', 'feature-bg', 4.5]]),
  ...si('side-bg', [['side-fg', 'side-bg', 4.5], ['side-muted', 'side-bg', 4.5]]),
  ...si('ink', [['on-ink', 'ink', 4.5], ['on-ink-muted', 'ink', 4.5]]),
  ...si('av0-fg', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`av${i}-fg`, `av${i}-bg`, 4.5])),
  // Lo que no es texto (WCAG 1.4.11): el contorno de un campo se tiene que
  // ver sobre la tarjeta y sobre el fondo. El foco se dibuja con --fg.
  ['field-line', 'surface', 3], ['field-line', 'bg', 3],
];

for (const [tema, t] of [['claro', claro], ['oscuro', oscuro]]) {
  for (const [a, b, min] of PARES) {
    // Un token renombrado o borrado no puede dejar la prueba en verde.
    if (!t[a] || !t[b]) { falla(`${tema}: falta el token --${t[a] ? b : a} del par --${a} sobre --${b}`); continue; }
    const r = contraste(t[a], t[b]);
    if (r < min) falla(`${tema}: --${a} ${t[a]} sobre --${b} ${t[b]} = ${r.toFixed(2)}:1 (mínimo ${min})`);
  }
  // La tarjeta destacada no puede confundirse con el fondo.
  if (t['feature-bg'] && contraste(t['feature-bg'], t.bg) < 1.15 && contraste(t['feature-line'] ?? t['feature-bg'], t.bg) < 1.3) {
    falla(`${tema}: la tarjeta destacada no se distingue del fondo`);
  }
}
console.log(fallos ? `${fallos} problemas de contraste` : 'Contraste AA en texto y contornos de control, en claro y oscuro');
process.exit(fallos ? 1 : 0);
