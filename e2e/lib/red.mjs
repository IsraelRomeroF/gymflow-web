// Qué peticiones a la API tiene cada página en curso, y cuáles tardaron.
//
// Sirve para dos cosas (pendiente del cierre de la fase 0, «el cuelgue único de
// adeudo»): distinguir LENTO de COLGADO, y que un recorrido que se queda
// esperando diga QUÉ petición no respondió en vez de solo «Timeout 15000ms».
// Una respuesta que llega tarde se anota como lenta (no falla); una que nunca
// llega aparece, con su método, su ruta y cuánto lleva, en el mensaje del fallo.
import { T } from './entorno.mjs';

/** Una petición de datos (fetch o XHR) del panel o del portal hacia /api. */
export function esDeApi(req) {
  const tipo = req.resourceType();
  if (tipo !== 'fetch' && tipo !== 'xhr') return false;
  try { return new URL(req.url()).pathname.startsWith('/api/'); } catch { return false; }
}

/** «POST /api/memberships/…/debt-decision»: la ruta sin la parte que cambia en cada corrida. */
export function rutaCorta(url) {
  try {
    const u = new URL(url);
    const ruta = u.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '…');
    const q = u.search.length > 60 ? `${u.search.slice(0, 57)}…` : u.search;
    return `${ruta}${q}`;
  } catch { return url; }
}

const segundos = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Vigila las peticiones a la API de una página. `anotar(lenta)` recibe cada
 * respuesta que tardó más de T.lento.
 */
export function vigilarRed(page, anotar) {
  const pendientes = new Map();
  // Las respuestas con error del servidor (5xx) o que nunca llegaron: el fallo
  // las cita, porque «la pantalla no mostró X» casi siempre empieza ahí.
  const conError = [];
  const avisadas = new WeakSet();
  // GYMFLOW_E2E_RED=1 escribe cada petición a la API y su respuesta (para diagnosticar).
  const traza = !!process.env.GYMFLOW_E2E_RED;
  page.on('request', (req) => {
    if (!esDeApi(req)) return;
    pendientes.set(req, Date.now());
    if (traza) console.log(`red: → ${req.method()} ${rutaCorta(req.url())}`);
  });
  // Un documento nuevo (goto, recargar, un enlace a otra página) cancela las
  // peticiones que el anterior tenía en camino, y Playwright no avisa: al
  // cargar el nuevo, lo que salió antes de que se abriera ya no se espera.
  let abierto = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) abierto = Date.now(); });
  page.on('domcontentloaded', () => { for (const [req, t0] of pendientes) if (t0 < abierto) pendientes.delete(req); });
  const terminar = (req, estado) => {
    const t0 = pendientes.get(req);
    if (t0 === undefined) return undefined;
    pendientes.delete(req);
    const ms = Date.now() - t0;
    const x = { metodo: req.method(), ruta: rutaCorta(req.url()), ms, estado, at: Date.now() };
    if (traza) console.log(`red: ← ${estado} ${x.metodo} ${x.ruta} en ${ms} ms`);
    if (ms >= T.lento) anotar(x);
    return x;
  };
  // Un 5xx o una petición que nunca respondió siempre se cita; un 4xx, cuando
  // la página intentó CAMBIAR algo (POST, PUT, PATCH, DELETE): es el «no» del
  // servidor que la pantalla quizá solo mostró en un aviso que se fue.
  const guardar = (x) => { conError.push(x); if (conError.length > 20) conError.shift(); };
  page.on('requestfinished', (req) => {
    req.response().then(async (r) => {
      const x = terminar(req, r?.status() ?? '?');
      if (!x) return;
      const cambia = req.method() !== 'GET' && req.method() !== 'HEAD';
      if (typeof x.estado !== 'number' || x.estado >= 500 || (cambia && x.estado >= 400)) {
        let motivo = '';
        try { const t = await r.text(); try { const j = JSON.parse(t); motivo = j.message ?? j.detail ?? ''; } catch { motivo = t.slice(0, 120); } } catch { /* sin cuerpo */ }
        guardar({ ...x, motivo: String(motivo).slice(0, 160) });
      }
    }, () => { const x = terminar(req, '?'); if (x) guardar(x); });
  });
  page.on('requestfailed', (req) => { const x = terminar(req, req.failure()?.errorText ?? 'falló'); if (x) guardar(x); });
  // Al cerrar la página nada queda pendiente.
  page.on('close', () => pendientes.clear());
  // `next dev` recompila y refresca la página cuando otro bloque guarda un
  // archivo del panel o del portal (Fast Refresh): si un recorrido falla justo
  // entonces, el fallo lo dice.
  const recompilaciones = [];
  page.on('console', (m) => {
    const t = m.text();
    // «[HMR] connected» sale en cada carga: no cuenta. Sí «rebuilding» y la recarga completa.
    if (/\[Fast Refresh\] rebuilding|full reload/i.test(t)) recompilaciones.push({ at: Date.now(), texto: t.slice(0, 80) });
  });
  const red = {
    /** Las que siguen sin respuesta, la más vieja primero. */
    pendientes() {
      const ahora = Date.now();
      return [...pendientes].map(([req, t0]) => ({ metodo: req.method(), ruta: rutaCorta(req.url()), ms: ahora - t0 }))
        .sort((a, b) => b.ms - a.ms);
    },
    cuantas: () => pendientes.size,
    /** Cuántas siguen en camino sin haber cumplido `ms` (las más viejas ya se dan por colgadas). */
    enCamino: (ms = T.respuesta) => { const ahora = Date.now(); let n = 0; for (const t0 of pendientes.values()) if (ahora - t0 < ms) n++; return n; },
    /** Las que pasaron de T.respuesta sin respuesta y todavía no se avisaron (se avisa una vez por petición). */
    colgadasSinAviso() {
      const ahora = Date.now(); const nuevas = [];
      for (const [req, t0] of pendientes) {
        if (ahora - t0 >= T.respuesta && !avisadas.has(req)) { avisadas.add(req); nuevas.push({ metodo: req.method(), ruta: rutaCorta(req.url()), ms: ahora - t0 }); }
      }
      return nuevas;
    },
    /** Las últimas respuestas 5xx o fallidas (ECONNREFUSED, abortadas). */
    conError: () => [...conError],
    /** Cuántas veces `next dev` recompiló o recargó esta página. */
    recompilaciones: () => [...recompilaciones],
  };
  page.__red = red;
  return red;
}

/** Las peticiones sin respuesta de varias páginas, dichas en una línea por petición. */
export function describirPendientes(paginas) {
  const lineas = [];
  for (const p of paginas) {
    if (!p.__red || p.isClosed()) continue;
    for (const x of p.__red.pendientes()) {
      const cual = x.ms >= T.respuesta ? 'COLGADA' : x.ms >= T.lento ? 'lenta' : 'en camino';
      lineas.push(`${x.metodo} ${x.ruta} · ${cual}: lleva ${segundos(x.ms)} sin respuesta`);
    }
  }
  return lineas;
}

export { segundos };

/** Las respuestas con error (5xx o sin respuesta) de varias páginas, la más reciente al final. */
export function describirErrores(paginas, { desde = 0 } = {}) {
  const todas = [];
  for (const p of paginas) if (p.__red) todas.push(...p.__red.conError().filter((x) => x.at >= desde));
  return todas.sort((a, b) => a.at - b.at).slice(-6)
    .map((x) => `${x.metodo} ${x.ruta} → ${x.estado} en ${segundos(x.ms)}${x.motivo ? `: «${x.motivo}»` : ''}`);
}

/** «el panel se recompiló 2 veces durante el recorrido (Fast Refresh)», si pasó. */
export function describirRecompilaciones(paginas) {
  const todas = paginas.flatMap((p) => (p.__red ? p.__red.recompilaciones() : []));
  const n = todas.length;
  return n ? [`next dev recompiló o recargó la página ${n} ${n === 1 ? 'vez' : 'veces'} durante el recorrido (otro bloque guardó un archivo del panel o del portal)`] : [];
}
