// Lo que comparten todos los recorridos: a dónde apuntan, en qué idioma y zona
// corren, y cuánto se espera cada cosa (auditoría 8, fase 1.17a, 27-11).
//
// - Destino: el perfil de PRUEBAS (API 4001, portal 4002, panel 4003). Lo
//   decide ../destino.mjs, que se niega a los puertos del uso real (3001-3003).
// - Idioma y zona: los de un gimnasio de la Ciudad de México, fijos. El
//   navegador los recibe en cada contexto (lib/navegador.mjs) y el propio
//   Node también, para que «hoy» y «este mes» del recorrido sean los del
//   gimnasio aunque la computadora esté en otra zona.
// - Esperas: con nombre y explícitas. Ningún recorrido espera «un rato»: espera
//   a que pase algo, con uno de estos topes. Si la computadora es lenta,
//   GYMFLOW_E2E_LENTITUD=2 los duplica (salvo el umbral de «lento»).
export { PANEL, PORTAL, API } from '../destino.mjs';

export const IDIOMA = 'es-MX';
export const ZONA = 'America/Mexico_City';
// Node toma el cambio de TZ en caliente: las fechas que arme el recorrido
// (el mes que viene, hace 8 días) son las del gimnasio.
process.env.TZ = ZONA;

const lentitud = Math.max(1, Number(process.env.GYMFLOW_E2E_LENTITUD ?? 1) || 1);
export const T = Object.freeze({
  /** La pantalla reacciona a algo que ya pasó: un clic local o una respuesta que ya llegó. */
  ui: 10_000 * lentitud,
  /** Una petición a la API. Pasado este tope, se da por COLGADA y se dice cuál era. */
  respuesta: 30_000 * lentitud,
  /** A partir de aquí una respuesta se anota como LENTA (no falla: se informa al final). */
  lento: 5_000,
  /** Abrir una pantalla: `next dev` compila cada ruta la primera vez que se pide. */
  navegacion: 60_000 * lentitud,
});

/** Carpeta de capturas de todos los recorridos. */
export const SHOTS = new URL('../shots/', import.meta.url).pathname;
/** Contraseña de las cuentas sembradas en gymflow_pruebas (la del seed). */
export const CLAVE_PRUEBAS = 'GymFlow.dev.2026';

/** Las cuentas sembradas, por su puesto: `entrar(p, 'recepcion')`. */
export const CUENTAS = Object.freeze({
  plataforma: 'plataforma@gymflow.mx',
  duena: 'owner@demo.mx',
  gerencia: 'gerencia@demo.mx',
  gerente: 'gerente@demo.mx',
  recepcion: 'recepcion@demo.mx',
  coach: 'coach@demo.mx',
});
/** El correo de un puesto («recepcion») o el correo tal cual. */
export function correoDe(quien) {
  if (quien.includes('@')) return quien;
  const correo = CUENTAS[quien];
  if (!correo) throw new Error(`No hay cuenta sembrada para «${quien}»: usa ${Object.keys(CUENTAS).join(', ')} o un correo`);
  return correo;
}
