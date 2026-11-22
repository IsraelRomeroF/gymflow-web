// Arranque y cierre de un recorrido (auditoría 8, fase 1.17a, 27-11):
//
//   import { recorrido } from './lib/index.mjs';
//   await recorrido('adeudo', async (r) => {
//     const rec = await r.como('recepcion');
//     r.ok(await …, 'lo que se espera, en palabras');
//   });
//
// El recorrido recibe `r` con lo que lleva estado: `ok`, `nota`, `nueva`
// (contexto + página con idioma y zona del gimnasio), `entrar`, `como`,
// `captura`, `api`, `alFinal` (limpieza que corre pase lo que pase) y `paso`
// (para que un fallo diga en qué parte iba). Si algo se queda esperando, el
// fallo dice QUÉ petición a la API no respondió y cuánto llevaba, o que no
// había ninguna pendiente. Si el recorrido entero pasa de su tope (o
// regresion.sh lo corta), dice lo mismo y limpia antes de salir.
import { abrirNavegador, contexto, pagina } from './navegador.mjs';
import { entrar } from './acceso.mjs';
import { captura, Registro } from './informe.mjs';
import { describirErrores, describirPendientes, describirRecompilaciones, segundos } from './red.mjs';
import { sesionApi } from './api.mjs';

function dondeEn(error) {
  for (const linea of String(error?.stack ?? '').split('\n')) {
    const m = linea.match(/e2e\/([\w.-]+\.mjs):(\d+)/);
    if (m && !linea.includes('/e2e/lib/')) return `${m[1]}:${m[2]}`;
  }
  return null;
}

const conTope = (promesa, ms) => Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error(`la limpieza no terminó en ${segundos(ms)}`)), ms).unref())]);

/**
 * Corre `cuerpo(r)`. Opciones: `erroresDePagina` ('informa' por omisión: se
 * listan; 'falla': además hacen fallar; 'ok': cuentan como una comprobación),
 * `etiquetaFallo` (desborde usa «DESBORDA»), `args` de Chromium y `limite` del
 * recorrido completo (6 minutos; regresion.sh corta a los 400 s).
 */
export async function recorrido(nombre, cuerpo, { erroresDePagina = 'informa', etiquetaFallo, args, limite = 360_000 } = {}) {
  const reg = new Registro(nombre, { etiquetaFallo });
  const browser = await abrirNavegador({ args });
  const paginas = [];
  const limpiezas = [];
  let pasoActual = null;

  const nueva = async ({ etiqueta, ...opciones } = {}) => {
    const ctx = await contexto(browser, opciones);
    const p = await pagina(ctx, { errores: reg.errores, etiqueta, lenta: (x) => reg.lenta(x) });
    paginas.push(p);
    return p;
  };
  const r = {
    nombre,
    navegador: browser,
    errores: reg.errores,
    ok: (c, m) => reg.ok(c, m),
    nota: (m) => reg.nota(m),
    nueva,
    entrar,
    /** Una página nueva con la sesión de ese puesto, ya en su inicio. */
    como: async (quien, opciones = {}) => entrar(await nueva(opciones), quien),
    captura,
    api: sesionApi,
    /** Limpieza que corre al final aunque el recorrido falle (en orden inverso). */
    alFinal: (fn) => { limpiezas.push(fn); },
    paso: (texto) => { pasoActual = texto; },
  };

  let limpiando = null;
  const limpiar = () => {
    limpiando ??= (async () => {
      for (const fn of limpiezas.reverse()) {
        try { await conTope(fn(), 30_000); } catch (e) { reg.ok(false, `limpieza al terminar: ${String(e?.message ?? e).split('\n')[0]}`); }
      }
    })();
    return limpiando;
  };
  // Si el recorrido entero se pasa de su tope, o lo cortan desde fuera, se dice
  // qué esperaba y se limpia antes de salir (una pausa de firmas, un mes cerrado).
  const cortar = async (motivo) => {
    console.log(`FALLÓ: ${motivo}${pasoActual ? ` (iba en «${pasoActual}»)` : ''}`);
    const pend = describirPendientes(paginas);
    for (const l of pend) console.log(`  sin respuesta: ${l}`);
    for (const l of describirErrores(paginas)) console.log(`  la API respondió con error: ${l}`);
    if (!pend.length) console.log('  ninguna petición a la API quedaba pendiente');
    await limpiar().catch(() => undefined);
    await browser.close().catch(() => undefined);
    process.exit(1);
  };
  const vigia = setTimeout(() => { cortar(`el recorrido pasó de ${segundos(limite)}`); }, limite);
  vigia.unref();
  const alCorte = () => { cortar('el recorrido se cortó desde fuera (timeout de regresion.sh)'); };
  process.once('SIGTERM', alCorte);
  process.once('SIGINT', alCorte);

  try {
    await cuerpo(r);
  } catch (e) {
    reg.interrumpido(e, describirPendientes(paginas), pasoActual ? `«${pasoActual}» (${dondeEn(e) ?? '?'})` : dondeEn(e), describirErrores(paginas));
  } finally {
    clearTimeout(vigia);
    await limpiar();
    reg.cerrarErrores(erroresDePagina);
    reg.cerrarLentas();
    if (reg.fallos > 0) for (const l of describirRecompilaciones(paginas)) reg.nota(l);
    process.off('SIGTERM', alCorte);
    process.off('SIGINT', alCorte);
    await browser.close().catch(() => undefined);
  }
  if (reg.fallos > 0) process.exitCode = 1;
  return reg;
}
