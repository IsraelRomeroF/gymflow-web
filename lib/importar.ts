/**
 * Lectura del archivo de socios EN EL NAVEGADOR: CSV o Excel, en la
 * codificación que venga. Aquí solo se separan filas y columnas; la limpieza
 * de cada dato (teléfonos, fechas, importes) y la comparación de duplicados
 * las hace la API, que es la que decide.
 */

export const CAMPOS = [
  { key: 'fullName', label: 'Nombre completo', ayuda: 'Si el nombre viene en una sola columna' },
  { key: 'firstName', label: 'Nombre(s)' },
  { key: 'lastName', label: 'Apellidos' },
  { key: 'phone', label: 'Celular' },
  { key: 'email', label: 'Correo' },
  { key: 'birthDate', label: 'Fecha de nacimiento' },
  { key: 'curp', label: 'CURP' },
  { key: 'legacyCode', label: 'Código en el sistema anterior', ayuda: 'Con él, el socio se sigue encontrando y reimportar no duplica' },
  { key: 'branch', label: 'Sucursal' },
  { key: 'joinedAt', label: 'Socio desde', ayuda: 'Su antigüedad' },
  { key: 'balance', label: 'Saldo', ayuda: 'Positivo = debe; negativo = a favor' },
  { key: 'periodEnd', label: 'Vigente hasta' },
  { key: 'plan', label: 'Plan' },
  { key: 'notes', label: 'Notas' },
] as const;
export type Campo = (typeof CAMPOS)[number]['key'];

const SINONIMOS: Record<Campo, string[]> = {
  fullName: ['nombre completo', 'socio', 'cliente', 'nombre del socio', 'nombre del cliente', 'nombre y apellidos'],
  firstName: ['nombre', 'nombres', 'primer nombre', 'first name'],
  lastName: ['apellidos', 'apellido', 'apellido paterno y materno', 'last name'],
  phone: ['telefono', 'celular', 'tel', 'movil', 'whatsapp', 'telefono celular', 'cel'],
  email: ['correo', 'email', 'e mail', 'correo electronico', 'mail'],
  birthDate: ['fecha de nacimiento', 'nacimiento', 'cumpleanos', 'fecha nacimiento', 'f nacimiento'],
  curp: ['curp'],
  legacyCode: ['codigo', 'clave', 'no socio', 'numero de socio', 'num socio', 'folio', 'id', 'id socio', 'matricula', 'codigo de socio'],
  branch: ['sucursal', 'sede', 'gimnasio', 'club'],
  joinedAt: ['fecha de alta', 'alta', 'fecha de ingreso', 'ingreso', 'socio desde', 'fecha de registro', 'registro', 'inscripcion'],
  balance: ['saldo', 'adeudo', 'debe', 'saldo pendiente', 'deuda'],
  periodEnd: ['vigencia', 'vence', 'vencimiento', 'fecha de vencimiento', 'vigente hasta', 'fin', 'fecha fin', 'pagado hasta'],
  plan: ['plan', 'membresia', 'paquete', 'tipo de membresia'],
  notes: ['notas', 'observaciones', 'comentarios'],
};

const limpia = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Propone el campo de cada columna por su encabezado (misma regla que la API). */
export function proponerColumnas(encabezados: readonly string[]): Array<Campo | null> {
  const usados = new Set<Campo>();
  const out = encabezados.map((h) => {
    const e = limpia(h);
    for (const c of CAMPOS) {
      if (usados.has(c.key)) continue;
      if (SINONIMOS[c.key].includes(e)) { usados.add(c.key); return c.key; }
    }
    return null;
  });
  if (usados.has('firstName') && usados.has('lastName')) return out.map((c) => (c === 'fullName' ? null : c));
  return out;
}

export type Tabla = { encabezados: string[]; filas: Array<Array<string | number | null>> };

/** CSV o Excel → encabezados + filas. Lanza un Error con un mensaje para la persona. */
export async function leerArchivo(archivo: File): Promise<Tabla> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xlsx')) {
    // Solo la primera hoja: es donde los sistemas de mostrador ponen el padrón.
    const { readSheet } = await import('read-excel-file/browser');
    const hoja = await readSheet(archivo);
    const filas = (hoja as unknown as Array<Array<unknown>>).map((f) => f.map((c) => celda(c)));
    return separar(filas);
  }
  if (nombre.endsWith('.xls')) throw new Error('Ese es el formato viejo de Excel (.xls). Ábrelo en Excel y guárdalo como .xlsx o como CSV.');
  if (!nombre.endsWith('.csv') && !nombre.endsWith('.txt') && !nombre.endsWith('.tsv')) throw new Error('Sube un archivo CSV o Excel (.xlsx).');
  const texto = decodificar(new Uint8Array(await archivo.arrayBuffer()));
  return separar(csv(texto));
}

function celda(c: unknown): string | number | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'number') return c;
  return String(c);
}

function separar(filas: Array<Array<string | number | null>>): Tabla {
  // Las filas vacías (muy comunes al final de un Excel) no cuentan.
  const llenas = filas.filter((f) => f.some((c) => c !== null && String(c).trim() !== ''));
  if (llenas.length < 2) throw new Error('El archivo no trae filas de socios: ¿la primera fila tiene los encabezados?');
  const encabezados = llenas[0]!.map((c, i) => (c === null || String(c).trim() === '' ? `Columna ${i + 1}` : String(c).trim()));
  return { encabezados, filas: llenas.slice(1) };
}

/**
 * Texto en UTF-8 o, si no lo es, en Windows-1252: los sistemas viejos de
 * mostrador exportan así, y leerlo mal convierte "Martínez" en "MartÃ­nez".
 */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** CSV con comillas, saltos dentro de comillas y separador , ; tabulador o |. */
function csv(texto: string): string[][] {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t', '|'].map((s) => ({ s, n: primera.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"' && campo === '') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

export type EstadoImportacion = 'REVIEW' | 'APPLIED' | 'CANCELED';
export const ESTADO_IMPORTACION: Record<EstadoImportacion, { label: string; tone: 'warn' | 'ok' | 'neutral' }> = {
  REVIEW: { label: 'En revisión', tone: 'warn' },
  APPLIED: { label: 'Aplicada', tone: 'ok' },
  CANCELED: { label: 'Cancelada', tone: 'neutral' },
};

/**
 * DATOS DUDOSOS (D18-02): saldo, vigencia o fecha de alta que venían en el
 * archivo y no se entendieron. La fila espera a que una persona decida: entra
 * sin ese dato, con el valor correcto, o se omite. Los mismos campos que
 * `CAMPOS_DUDOSOS` del núcleo.
 */
export type CampoDudoso = 'balance' | 'periodEnd' | 'joinedAt';
export type DatoDudoso = { field: CampoDudoso; value: string; problem: string };
export const DATO_DUDOSO: Record<CampoDudoso, string> = { balance: 'Saldo', periodEnd: 'Vigente hasta', joinedAt: 'Socio desde' };
export type EstadoDatos = 'PENDING' | 'WITHOUT' | 'FIXED';
export const ESTADO_DATOS: Record<EstadoDatos, { label: string; tone: 'warn' | 'info' | 'ok' }> = {
  PENDING: { label: 'Sin decidir', tone: 'warn' },
  WITHOUT: { label: 'Entra sin ese dato', tone: 'info' },
  FIXED: { label: 'Corregido', tone: 'ok' },
};

/** Las vigencias que el archivo trae sin plan: la API las agrupa con la etiqueta vacía y también piden decisión (18-03). */
export const SIN_PLAN = '';
export const nombrePlanArchivo = (label: string) => (label === SIN_PLAN ? 'Sin plan en el archivo' : label);
