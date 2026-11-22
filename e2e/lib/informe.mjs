// Lo que cada recorrido escribe en su bitácora (e2e/out-<nombre>.log), con el
// formato que cuenta regresion.sh: «ok: …» por cada comprobación que pasa,
// «FALLÓ: …» por cada una que no, y «nota: …» para lo que se informa sin
// juzgar. Al final: los errores de página y las peticiones lentas.
import { SHOTS, T } from './entorno.mjs';
import { asentado, cuadros } from './esperas.mjs';
import { segundos } from './red.mjs';

export class Registro {
  constructor(nombre, { etiquetaFallo = 'FALLÓ:' } = {}) {
    this.nombre = nombre;
    this.etiquetaFallo = etiquetaFallo;
    this.oks = 0;
    this.fallos = 0;
    this.errores = [];
    this.lentas = [];
  }

  /** Una comprobación: `ok(condición, 'lo que se espera, en palabras')`. */
  ok(cond, mensaje) {
    if (cond) { this.oks++; console.log('ok:', mensaje); } else { this.fallos++; console.log(this.etiquetaFallo, mensaje); }
    return !!cond;
  }

  nota(mensaje) { console.log('nota:', mensaje); }

  lenta(x) { this.lentas.push(x); }

  /** Un fallo que interrumpió el recorrido (una espera agotada, una excepción). */
  interrumpido(error, pendientes, donde, conError = []) {
    this.fallos++;
    const primera = String(error?.message ?? error).split('\n').filter((l) => l.trim()).slice(0, 4).join(' · ');
    console.log(`FALLÓ: el recorrido se detuvo${donde ? ` en ${donde}` : ''}: ${primera}`);
    for (const l of pendientes) console.log(`  sin respuesta: ${l}`);
    for (const l of conError) console.log(`  la API respondió con error: ${l}`);
    const espera = /Timeout|EsperaAgotada/.test(`${error?.name} ${error?.message}`);
    if (espera && !pendientes.length && !conError.length) console.log('  ninguna petición a la API quedaba pendiente ni falló: lo que no llegó fue la pantalla');
  }

  /** Los errores de página: según el recorrido, fallan, se cuentan como comprobación o solo se informan. */
  cerrarErrores(modo) {
    const hay = this.errores.length > 0;
    if (modo === 'ok') { this.ok(!hay, hay ? `errores de página: ${this.errores.join(' | ')}` : 'sin errores de página'); return; }
    console.log(hay ? this.errores.join('\n') : 'sin errores de página');
    if (hay && modo === 'falla') this.fallos++;
  }

  cerrarLentas() {
    if (!this.lentas.length) return;
    const peores = [...this.lentas].sort((a, b) => b.ms - a.ms).slice(0, 8);
    for (const x of peores) console.log(`lenta: ${x.metodo} ${x.ruta} → ${x.estado} en ${segundos(x.ms)}`);
    if (this.lentas.length > peores.length) console.log(`lenta: … y ${this.lentas.length - peores.length} más de ${segundos(T.lento)}`);
  }
}

/**
 * Captura de pantalla en e2e/shots/<nombre>.png, con la página ya asentada
 * (sin peticiones en camino y pintada). `red: false` solo espera a que se
 * pinte: para capturar un estado «esperando la respuesta» a propósito.
 */
export async function captura(page, nombre, { full = false, red = true, elemento } = {}) {
  if (red) await asentado(page, { que: `La captura ${nombre}` });
  else await cuadros(page);
  const ruta = `${SHOTS}${nombre}.png`;
  if (elemento) await elemento.screenshot({ path: ruta, animations: 'disabled' });
  else await page.screenshot({ path: ruta, fullPage: full, animations: 'disabled' });
  return ruta;
}
