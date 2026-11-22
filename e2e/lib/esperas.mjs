// Esperas por condición (auditoría 8, 27-11): ningún recorrido «espera un
// rato». Espera la respuesta de la API que su acción provoca, a que la página
// se asiente (sin peticiones en camino y con la pantalla pintada) o a que se
// cumpla una condición, cada una con un tope de lib/entorno.mjs. Si el tope se
// agota, el error dice si la petición se quedó COLGADA, si ni siquiera salió,
// o si la red estaba quieta y lo que faltó fue la pantalla.
import { T } from './entorno.mjs';
import { describirPendientes, rutaCorta, segundos } from './red.mjs';

export class EsperaAgotada extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'EsperaAgotada'; }
}

function quePeticion(patron, metodo) {
  const m = metodo ? `${metodo} ` : '';
  if (typeof patron === 'string') return `${m}${patron}`;
  if (patron instanceof RegExp) return `${m}${patron.source}`;
  return `${m}(la petición esperada)`;
}

function coincide(patron, metodo, req) {
  if (metodo && req.method() !== metodo) return false;
  const url = req.url();
  if (typeof patron === 'function') return !!patron(url, req);
  let ruta;
  try { const u = new URL(url); ruta = `${u.pathname}${u.search}`; } catch { ruta = url; }
  if (patron instanceof RegExp) return patron.test(ruta);
  // Cadena: la ruta empieza con ella (con o sin la consulta), o termina en ella.
  const sinConsulta = ruta.split('?')[0];
  return ruta.startsWith(patron) || sinConsulta === patron || sinConsulta.endsWith(patron);
}

/**
 * La respuesta a una petición que coincide con `patron` (cadena de ruta, RegExp
 * o función). Se pide ANTES de la acción que la provoca. Si no llega en
 * `timeout`, falla diciendo si la petición salió y se quedó sin respuesta
 * (colgada) o si nunca salió.
 */
export function respuesta(page, patron, { metodo, que, timeout = T.respuesta } = {}) {
  let salida = null;
  const alSalir = (req) => { if (!salida && coincide(patron, metodo, req)) salida = { req, t0: Date.now() }; };
  page.on('request', alSalir);
  const desc = que ?? quePeticion(patron, metodo);
  return page.waitForResponse((r) => coincide(patron, metodo, r.request()), { timeout })
    .catch((e) => {
      if (page.isClosed()) throw e;
      if (salida) {
        throw new EsperaAgotada(`COLGADA: ${salida.req.method()} ${rutaCorta(salida.req.url())} salió hace ${segundos(Date.now() - salida.t0)} y no respondió (tope ${segundos(timeout)}) · ${desc}`);
      }
      throw new EsperaAgotada(`No salió ninguna petición ${quePeticion(patron, metodo)} en ${segundos(timeout)} · ${desc}`);
    })
    .finally(() => page.off('request', alSalir));
}

/** Hace algo y espera la respuesta que provoca: `await accion(p, () => boton.click(), '/api/x', { metodo: 'POST' })`. */
export async function accion(page, hacer, patron, opciones = {}) {
  const r = respuesta(page, patron, opciones);
  r.catch(() => undefined);
  await hacer();
  return r;
}

/** Espera `n` respuestas que coinciden (un sondeo que se repite, por ejemplo). Devuelve las respuestas. */
export async function respuestas(page, patron, n, { metodo, que, timeout = T.respuesta } = {}) {
  const vistas = [];
  const desc = que ?? quePeticion(patron, metodo);
  await new Promise((resolver, rechazar) => {
    const alLlegar = (r) => {
      if (!coincide(patron, metodo, r.request())) return;
      vistas.push(r);
      if (vistas.length >= n) { page.off('response', alLlegar); clearTimeout(tope); resolver(); }
    };
    const tope = setTimeout(() => {
      page.off('response', alLlegar);
      rechazar(new EsperaAgotada(`Llegaron ${vistas.length} de ${n} respuestas de ${desc} en ${segundos(timeout)}`));
    }, timeout);
    page.on('response', alLlegar);
  });
  return vistas;
}

/** Espera `n` cuadros de pintura: lo que un clic o una tecla iban a cambiar ya está en la pantalla. */
export function cuadros(page, n = 2) {
  return page.evaluate((k) => new Promise((listo) => {
    let faltan = k;
    const paso = () => (--faltan <= 0 ? listo() : requestAnimationFrame(paso));
    requestAnimationFrame(paso);
  }), n);
}

/**
 * La página se asentó: ninguna petición a la API en camino durante `quietud`
 * ms seguidos, y la pantalla ya pintó lo que llegó. Una petición que pasa de
 * T.respuesta sin respuesta ya no se espera: se da por COLGADA, se anota y se
 * sigue (la API de pruebas se reinicia a media corrida y deja peticiones así).
 * Con `estricto: true`, en vez de seguir, falla diciendo cuáles eran.
 */
export async function asentado(page, { que, quietud = 150, estricto = false } = {}) {
  const red = page.__red;
  const t0 = Date.now();
  let quietaDesde = null;
  for (;;) {
    const ocupada = red ? red.enCamino(T.respuesta) > 0 : false;
    if (!ocupada) {
      quietaDesde ??= Date.now();
      if (Date.now() - quietaDesde >= quietud) break;
    } else quietaDesde = null;
    // Una página que no deja de pedir (un sondeo cada pocos ms) no se asienta nunca.
    if (Date.now() - t0 > 2 * T.respuesta) throw new EsperaAgotada(`${que ?? 'La página'} no dejó de pedir datos en ${segundos(2 * T.respuesta)}: ${describirPendientes([page]).join(' | ')}`);
    await new Promise((r) => setTimeout(r, 40));
  }
  const colgadas = red ? red.colgadasSinAviso() : [];
  if (colgadas.length) {
    const lista = colgadas.map((x) => `${x.metodo} ${x.ruta} (${segundos(x.ms)})`).join(', ');
    if (estricto) throw new EsperaAgotada(`${que ?? 'La página'} no se asentó: COLGADAS ${lista}`);
    console.log(`nota: sin respuesta tras ${segundos(T.respuesta)} (COLGADAS), se sigue sin ellas: ${lista}`);
  }
  await cuadros(page);
}

/** Espera a que una función de la página devuelva algo verdadero. */
export async function hasta(page, fn, arg, { timeout = T.ui, que } = {}) {
  try {
    return await page.waitForFunction(fn, arg, { timeout, polling: 'raf' });
  } catch (e) {
    if (page.isClosed()) throw e;
    const pend = describirPendientes([page]);
    throw new EsperaAgotada(`${que ?? 'La condición'} no se cumplió en ${segundos(timeout)}${pend.length ? ` · en camino: ${pend.join(' | ')}` : ' · la red estaba quieta'}`);
  }
}

/** ¿Aparece? true/false sin lanzar (para usarlo dentro de ok()). */
export const aparece = (loc, timeout = T.ui) => loc.waitFor({ timeout }).then(() => true, () => false);
/** ¿Se va? true/false sin lanzar. */
export const desaparece = (loc, timeout = T.ui) => loc.waitFor({ state: 'hidden', timeout }).then(() => true, () => false);

/**
 * Las animaciones y transiciones de la página terminaron (un menú que se
 * encoge, un cajón que se abre). Las infinitas (un indicador de carga) no
 * cuentan. Primero deja pasar dos cuadros: la transición nace en el siguiente.
 */
export async function sinAnimaciones(page, { timeout = T.ui } = {}) {
  await cuadros(page);
  await hasta(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity),
    null, { timeout, que: 'Las animaciones de la página' });
}
