/**
 * FORMATO DE PRESENTACIÓN — panel y portal (auditoría 8, 26-06).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal (`lib/format.ts`);
 * `pnpm test:tokens` falla si difieren. Para cambiarlo: edítalo en uno,
 * cópialo al otro y actualiza su huella en los dos `scripts/tokens-iguales.mjs`.
 * No importa nada (ni React ni `@/…`), así que se prueba con `node --test`.
 *
 * Es el ÚNICO lugar con decimales (ADR-005): la API habla en centavos enteros
 * y aquí se convierten para mostrarse.
 *
 * LA HORA ES LA DEL GIMNASIO (26-06): `fecha`, `hora` y las demás pintan un
 * instante en la zona que el marco fija al cargar la sesión (`fijarZona`), no
 * en la de la computadora. Una PC del mostrador con otra zona, o la dueña de
 * viaje, veían la entrada de las 7:00 como «8:00». Sin zona fijada (el portal
 * todavía no la recibe de la API) se usa la de la computadora, como antes.
 * Una fecha de calendario (AAAA-MM-DD) nunca se mueve de día.
 */

let zonaFijada: string | undefined;

/** La zona IANA del gimnasio (`America/Mexico_City`). `null` o una zona que no existe vuelven a la de la computadora. */
export function fijarZona(zona: string | null | undefined): void {
  zonaFijada = zona && zonaValida(zona) ? zona : undefined;
}

/** La zona con que se pintan las horas; `undefined` = la de la computadora. */
export function zonaActiva(): string | undefined {
  return zonaFijada;
}

function zonaValida(zona: string): boolean {
  try { new Intl.DateTimeFormat('es-MX', { timeZone: zona }); return true; } catch { return false; }
}

const DE_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El instante a pintar y la zona en que se lee. Un día de calendario se lee a
 * mediodía en UTC: `new Date('2026-09-01')` es medianoche UTC y en México
 * sería el día 31.
 */
function leer(iso: string | Date, zona?: string): [Date, string | undefined] {
  if (typeof iso === 'string' && DE_CALENDARIO.test(iso)) return [new Date(`${iso}T12:00:00Z`), 'UTC'];
  return [iso instanceof Date ? iso : new Date(iso), zona ?? zonaFijada];
}

export function pesos(cents: string | bigint, opts: { decimals?: boolean } = {}): string {
  const n = typeof cents === 'bigint' ? cents : BigInt(cents);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const major = new Intl.NumberFormat('es-MX').format(abs / 100n);
  const minor = opts.decimals === false ? '' : `.${(abs % 100n).toString().padStart(2, '0')}`;
  return `${neg ? '-' : ''}$${major}${minor}`;
}

/** «19 nov 2026». */
export function fecha(iso: string | Date | null | undefined, zona?: string): string {
  if (!iso) return '—';
  const [d, timeZone] = leer(iso, zona);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

/** «19 nov». */
export function fechaCorta(iso: string | Date, zona?: string): string {
  const [d, timeZone] = leer(iso, zona);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone });
}

/**
 * «19:00». 24 horas, igual en panel y portal (UX-13): «19:00» cabe en una
 * columna; «07:00 p.m.» se partía en dos líneas en Accesos (UI-12).
 */
export function hora(iso: string | Date, zona?: string): string {
  const [d, timeZone] = leer(iso, zona);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
}

/** «19 nov · 19:00». */
export function fechaHora(iso: string | Date, zona?: string): string {
  return `${fechaCorta(iso, zona)} · ${hora(iso, zona)}`;
}

/** Una fecha con las opciones que se pidan (`{ weekday: 'long', day: 'numeric' }`…), en la zona del gimnasio. Por omisión, «19 de noviembre». */
export function dia(iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }): string {
  const [d, timeZone] = leer(iso, opts.timeZone);
  return d.toLocaleDateString('es-MX', { ...opts, timeZone });
}

/** «Jueves, 19 de noviembre»: el encabezado de un día en una lista. */
export function diaLargo(iso: string | Date, zona?: string): string {
  return capital(dia(iso, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona }));
}

/** «noviembre de 2026» para un mes AAAA-MM (o una fecha de ese mes). */
export function nombreMes(mes: string): string {
  return new Date(`${mes.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** «19/11/2026»: el día como se escribe a mano en México (D26-02), sin depender del idioma de la computadora. */
export function fechaNumerica(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** «6:30 pm» para una hora HH:MM de 24 (como la guarda la API). Vacío si no es una hora. */
export function hora12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Último día CUBIERTO de un periodo. La API da el fin semiabierto (ese día
 * ya no está pagado); mostrarlo tal cual decía "vigente hasta el 29" a quien
 * solo tenía hasta el 28.
 */
export function ultimoDia(finExclusivo: string): string {
  const d = new Date(`${finExclusivo.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * HOY EN LA ZONA DEL GIMNASIO (13-12, 14-20, 26-06): la fecha de calendario
 * (AAAA-MM-DD) que corre en esa zona, no la que marca la computadora. Es la
 * misma cuenta que hace el servidor (`businessDateIn`). Sin zona, la fijada
 * con `fijarZona` (o la de la computadora).
 */
export function hoyEn(zona?: string | null, ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona ?? zonaFijada, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}

/** Suma (o resta) días a una fecha de calendario AAAA-MM-DD sin moverla de zona. */
export function masDias(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Lo que alguien escribió en un campo de fecha, como AAAA-MM-DD; `null` si no
 * es un día que exista. Siempre día/mes/año (D26-02): «19/11/2026»,
 * «19-11-2026», «19.11.2026», «19 11 2026», «19112026»; también el formato de
 * la API («2026-11-19»), que es lo que llega al pegar o desde un recorrido.
 * El año va completo: «19/11/26» no se adivina.
 */
export function leerFecha(texto: string): string | null {
  const t = texto.trim();
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let a: number; let m: number; let d: number;
  if (r) { a = Number(r[1]); m = Number(r[2]); d = Number(r[3]); }
  else if ((r = /^(\d{1,2})[/.\-\s]+(\d{1,2})[/.\-\s]+(\d{4})$/.exec(t))) { d = Number(r[1]); m = Number(r[2]); a = Number(r[3]); }
  else if ((r = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) { d = Number(r[1]); m = Number(r[2]); a = Number(r[3]); }
  else return null;
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(a, m, 0)).getUTCDate()) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * El texto de un campo de fecha mientras se escribe: los números se acomodan
 * solos como dd/mm/aaaa («19112026» → «19/11/2026») y un día o un mes de una
 * cifra seguido de «/» se completa («1/3/» → «01/03/»). Lo que no son solo
 * números y diagonales (una fecha pegada como «2026-11-19») se deja igual.
 */
export function escribirFecha(texto: string): string {
  if (!/^[\d/]*$/.test(texto)) return texto;
  const corrido = (n: string) => [n.slice(0, 2), n.slice(2, 4), n.slice(4, 8)].filter(Boolean).join('/');
  if (!texto.includes('/')) return corrido(texto);
  if (texto.startsWith('/')) return escribirFecha(texto.replace(/^\/+/, ''));
  const [d = '', m, a] = texto.split('/');
  const soloCifras = () => corrido(texto.replace(/\//g, ''));
  if (d.length > 2) return soloCifras();
  const dd = d.padStart(2, '0');
  if (a === undefined) {
    // El mes se está escribiendo; si trae de más (se pegó «19/112026»), lo que sobra es el año.
    const mes = m ?? '';
    return mes.length <= 2 ? `${dd}/${mes}` : `${dd}/${mes.slice(0, 2)}/${mes.slice(2, 6)}`;
  }
  if (!m || m.length > 2) return soloCifras();
  return `${dd}/${m.padStart(2, '0')}/${a.slice(0, 4)}`;
}

/**
 * Lo que alguien escribió en un campo de hora, como HH:MM de 24; `null` si no
 * es una hora. Entiende «18:30», «1830», «6:30 pm», «6:30pm», «6:30 p. m.»,
 * «6 pm» y «7» (las 7:00).
 */
export function leerHora(texto: string): string | null {
  const t = texto.trim().toLowerCase();
  const r = /^(\d{1,2})(?::?(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|a|p)?$/.exec(t);
  if (!r) return null;
  let h = Number(r[1]);
  const min = r[2] === undefined ? 0 : Number(r[2]);
  const sufijo = r[3]?.[0];
  if (min > 59) return null;
  if (sufijo) {
    if (h < 1 || h > 12) return null;
    h = sufijo === 'p' ? (h % 12) + 12 : h % 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * El texto de un campo de hora mientras se escribe: si son solo números se
 * pone «:» («1830» → «18:30», «630» → «6:30»). Con «:» o con «am/pm» escritos
 * a mano, se deja igual.
 */
export function escribirHora(texto: string): string {
  if (!/^\d*$/.test(texto) || texto.length < 2) return texto;
  const n = texto.slice(0, 4);
  // Una hora de una cifra: «6» no puede ser el principio de las 60, ni «25» una hora.
  // Con 0, 1 o 2 delante se lee como hora de dos cifras («130» → «13:0»; la 1:30 es «1:30» o «0130»).
  const corta = n[0]! >= '3' || (n[0] === '2' && n[1]! >= '4');
  if (corta) return `${n[0]}:${n.slice(1, 3)}`;
  return n.length === 2 ? n : `${n.slice(0, 2)}:${n.slice(2, 4)}`;
}

/** "hace 3 min", "hace 2 días". Para lo reciente; lo viejo va con fecha. */
export function hace(iso: string | Date, ahora = new Date()): string {
  const seg = Math.round((ahora.getTime() - new Date(iso).getTime()) / 1000);
  if (seg < 45) return 'justo ahora';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'ayer' : `hace ${d} días`;
  return fecha(iso);
}

/** «3 meses», «2 años». Recibe desde cuándo (fecha) o cuántos días lleva (número). */
export function antiguedad(desde: string | Date | number, ahora = new Date()): string {
  const dias = typeof desde === 'number' ? Math.max(0, Math.floor(desde)) : Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 86_400_000));
  if (dias < 60) return dias === 1 ? '1 día' : `${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 24) return `${meses} meses`;
  const anios = Math.floor(dias / 365);
  return anios === 1 ? '1 año' : `${anios} años`;
}

/** «hace 3 meses», o «hoy» con antigüedad de cero (bloque 4.16: antes decía «hace 0 días»). */
export function haceTanto(desde: string | Date | number, ahora = new Date()): string {
  const t = antiguedad(desde, ahora);
  return t === '0 días' ? 'hoy' : `hace ${t}`;
}

export function telefono(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+52(\d{2})(\d{4})(\d{4})$/.exec(e164);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const a = partes[0]?.[0] ?? '';
  const b = partes.length > 1 ? partes[partes.length - 1]![0] : '';
  return (a + b).toUpperCase();
}

/** La primera letra en mayúscula: «jueves, 19 de noviembre» → «Jueves, 19 de noviembre». */
export function capital(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * El concepto de un cargo trae su periodo con fechas ISO y fin semiabierto,
 * como lo guarda el servidor ("Mensualidad · 2026-11-19 a 2026-12-19": el 19
 * de diciembre ya no está cubierto). Se reescribe con el último día cubierto,
 * igual que «Periodo actual» en la ficha: "19 nov – 18 dic".
 */
export function concepto(texto: string): string {
  return texto
    .replace(/(\d{4})-(\d{2})-(\d{2}) a (\d{4})-(\d{2})-(\d{2})/g, (_m, _a1, m1, d1, a2, m2, d2) => {
      const ultimo = new Date(Date.UTC(Number(a2), Number(m2) - 1, Number(d2)) - 86_400_000);
      return `${Number(d1)} ${MESES[Number(m1) - 1]} – ${ultimo.getUTCDate()} ${MESES[ultimo.getUTCMonth()]}`;
    })
    .replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, _a, m, d) => `${Number(d)} ${MESES[Number(m) - 1]}`);
}

/**
 * Comparar dos cantidades de dinero en palabras (UX5-D-03): "$6,385 más que
 * ayer a esta hora". El porcentaje va entre paréntesis solo si dice algo: la
 * base pasa de $1,000 y el cambio cabe entre −99 % y +99 %. "+5590 %" no le
 * dice nada a nadie. `tono` es 'ok' / 'danger' solo si la diferencia pasa del
 * 10 % y de $500; si no, neutro. Si las dos cifras son cero no hay nada que
 * comparar: el texto va vacío y quien lo pinta se lo salta.
 */
export function comparar(actual: string | bigint, antes: string | bigint, contra: string): { texto: string; tono: 'ok' | 'danger' | 'neutral' } {
  const a = typeof actual === 'bigint' ? actual : BigInt(actual);
  const b = typeof antes === 'bigint' ? antes : BigInt(antes);
  if (b === 0n) return { texto: a === 0n ? '' : `${capital(contra)} no había entrado nada`, tono: 'neutral' };
  const dif = a - b;
  if (dif === 0n) return { texto: `Igual que ${contra}`, tono: 'neutral' };
  const abs = dif < 0n ? -dif : dif;
  const pct = Number((dif * 1000n) / (b < 0n ? -b : b)) / 10;
  const conPct = (b < 0n ? -b : b) > 100_000n && Math.abs(pct) < 100 ? ` (${pct > 0 ? '+' : ''}${Math.round(pct)} %)` : '';
  const tono = Math.abs(pct) > 10 && abs > 50_000n ? (dif > 0n ? 'ok' : 'danger') : 'neutral';
  return { texto: `${pesos(abs, { decimals: false })} ${dif > 0n ? 'más' : 'menos'} que ${contra}${conPct}`, tono };
}

/** Lo mismo para conteos (entradas, socios): "12 más que ayer". Vacío si ambos son cero. */
export function compararConteo(actual: number, antes: number, contra: string): { texto: string; tono: 'ok' | 'danger' | 'neutral' } {
  if (actual === 0 && antes === 0) return { texto: '', tono: 'neutral' };
  const dif = actual - antes;
  if (dif === 0) return { texto: `Igual que ${contra}`, tono: 'neutral' };
  return { texto: `${Math.abs(dif).toLocaleString('es-MX')} ${dif > 0 ? 'más' : 'menos'} que ${contra}`, tono: 'neutral' };
}
