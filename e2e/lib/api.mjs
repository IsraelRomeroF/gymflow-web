// La API de pruebas desde Node, con la sesión de una cuenta sembrada. Sirve
// para PREPARAR lo que el recorrido necesita (un socio suyo, una clase suya)
// y para COMPROBAR lo que la pantalla no muestra, sin depender de lo que otro
// recorrido dejó. Lo que el recorrido quiere probar se hace en la pantalla.
//
//   const g = await sesionApi('gerencia');
//   const socio = await g.post('/members', { … });
//
// Cada petición tiene su tope (T.respuesta): si la API no contesta, el error
// dice cuál fue y cuánto se esperó. Un 4xx/5xx lanza con el mensaje de la API,
// salvo los estados que se pidan en `{ acepta: [409] }`.
import { API, CLAVE_PRUEBAS, T, correoDe } from './entorno.mjs';
import { segundos } from './red.mjs';

const sesiones = new Map();

// La API de pruebas corre con `tsx watch`: se reinicia cada vez que otro bloque
// guarda un archivo del backend o recompila el núcleo. Una conexión RECHAZADA
// nunca llegó al servidor, así que repetirla no duplica nada: se reintenta
// hasta T.respuesta y se avisa. Cualquier otro error no se repite.
let avisado = false;
async function conectar(url, init, t0) {
  for (;;) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1000, T.respuesta - (Date.now() - t0))) });
      // 503 mientras se apaga (Fastify no atiende lo nuevo al cerrar): tampoco se procesó.
      if (r.status === 503 && Date.now() - t0 < T.respuesta) {
        if (!avisado) { console.log('nota: la API de pruebas responde 503 (se está apagando o arrancando); se reintenta'); avisado = true; }
        await r.arrayBuffer().catch(() => undefined);
        await new Promise((res) => setTimeout(res, 500));
        continue;
      }
      return r;
    } catch (e) {
      const rechazada = e.cause?.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNRESET' && init.method === 'GET';
      if (!rechazada || Date.now() - t0 > T.respuesta) throw e;
      if (!avisado) { console.log(`nota: la API de pruebas no acepta conexiones (${e.cause.code}); se reintenta: ¿se está reiniciando?`); avisado = true; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function pedir(metodo, ruta, { cookie, cuerpo, acepta = [] } = {}) {
  const t0 = Date.now();
  let r;
  try {
    r = await conectar(`${API}${ruta}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    }, t0);
  } catch (e) {
    const cuanto = segundos(Date.now() - t0);
    if (e.name === 'TimeoutError') throw new Error(`COLGADA: ${metodo} ${ruta} no respondió en ${cuanto}`);
    throw new Error(`${metodo} ${ruta}: la API no contestó (${e.cause?.code ?? e.message}) tras ${cuanto}`);
  }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* no era JSON */ }
  if (r.status >= 400 && acepta !== true && !acepta.includes(r.status)) {
    const motivo = json?.message ?? json?.detail ?? texto.slice(0, 200);
    throw new Error(`${metodo} ${ruta} → ${r.status}: ${motivo}`);
  }
  return { status: r.status, body: json, cabeceras: r.headers };
}

/** Inicia sesión en la API con esa cuenta (o la reutiliza) y da sus métodos. */
export async function sesionApi(quien, { clave = CLAVE_PRUEBAS } = {}) {
  const email = correoDe(quien);
  if (sesiones.has(email)) return sesiones.get(email);
  const r = await pedir('POST', '/auth/login', { cuerpo: { email, password: clave } });
  const cookie = r.cabeceras.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (!cookie.includes('gf_session=')) throw new Error(`La API no dio sesión a ${email}`);
  const llamar = (metodo) => async (ruta, cuerpo, opciones = {}) => (await pedir(metodo, ruta, { cookie, cuerpo, ...opciones })).body;
  const s = {
    email,
    get: (ruta, opciones = {}) => pedir('GET', ruta, { cookie, ...opciones }).then((x) => x.body),
    post: llamar('POST'),
    patch: llamar('PATCH'),
    put: llamar('PUT'),
    /** La respuesta completa ({ status, body }), sin lanzar por el estado. */
    crudo: (metodo, ruta, cuerpo) => pedir(metodo, ruta, { cookie, cuerpo, acepta: true }),
  };
  sesiones.set(email, s);
  return s;
}
