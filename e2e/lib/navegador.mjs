// Arranque del navegador y de cada contexto (auditoría 8, 27-11): idioma
// es-MX y zona de la Ciudad de México FIJOS en todos los contextos, para que
// fechas, horas e importes se vean como los ve el gimnasio en cualquier
// computadora; topes de espera con nombre (lib/entorno.mjs); y cada página
// vigilada (lib/red.mjs) para poder decir qué petición se quedó colgada.
import { chromium } from 'playwright-core';
import { exe } from '../navegador.mjs';
import { IDIOMA, T, ZONA } from './entorno.mjs';
import { vigilarRed } from './red.mjs';

export const TELEFONO = Object.freeze({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
export const ESCRITORIO = Object.freeze({ viewport: { width: 1440, height: 900 } });

/** Chromium sin interfaz de los recorridos (lo baja preparar.sh). */
export function abrirNavegador({ args } = {}) {
  return chromium.launch({ executablePath: exe, ...(args ? { args } : {}) });
}

/**
 * Las opciones de un contexto: escritorio 1440×900 por omisión, `movil: true`
 * para el teléfono (390×844 táctil), o `viewport` a la medida; siempre con
 * idioma y zona del gimnasio. Lo demás (`colorScheme`, `acceptDownloads`,
 * `permissions`, `storageState`…) pasa tal cual.
 */
export function opcionesDeContexto({ movil = false, viewport, ...resto } = {}) {
  const base = movil ? { ...TELEFONO } : { ...ESCRITORIO };
  if (viewport) base.viewport = viewport;
  return { ...base, locale: IDIOMA, timezoneId: ZONA, ...resto };
}

/** Un contexto nuevo con sus topes de espera. */
export async function contexto(browser, opciones = {}) {
  const ctx = await browser.newContext(opcionesDeContexto(opciones));
  // Esperar un elemento que llega con la respuesta de la API puede tardar lo
  // que tarde la API: el tope de una acción es el de una respuesta.
  ctx.setDefaultTimeout(T.respuesta);
  ctx.setDefaultNavigationTimeout(T.navegacion);
  return ctx;
}

/** Una página vigilada: sus errores van a `errores` y sus peticiones lentas a `lenta`. */
export async function pagina(ctx, { errores = [], etiqueta = '', lenta = () => undefined } = {}) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${etiqueta ? `${etiqueta}: ` : ''}${e.message}`));
  vigilarRed(p, lenta);
  return p;
}
