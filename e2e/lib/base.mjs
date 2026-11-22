// La base de PRUEBAS (gymflow_pruebas), para lo poco que la API no permite y es
// a propósito que no lo permita: adelantar el reloj de UN registro (una firma
// que vence a los 10 minutos, una temporal que vence a los 7 días, una
// membresía que dejó de pagar hace meses) o deshacer lo que el propio
// recorrido cerró (el mes que firmó). `sql()` solo acepta gymflow_pruebas:
// nunca el uso real (gymflow_local) ni otra base.
//
// `leer()` es otra cosa: una consulta de SOLO LECTURA (transacción READ ONLY)
// contra la base que se le diga, para mediciones como medir-clases.mjs.
//
// PGURL la pone regresion.sh; corrido a mano, se arma igual que ahí desde
// gymflow-backend/.env.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const home = process.env.HOME;
const BASE_PRUEBAS = 'gymflow_pruebas';

function urlCon(base) {
  if (process.env.PGURL && base === BASE_PRUEBAS) return process.env.PGURL;
  const env = readFileSync(`${home}/gymflow-backend/.env`, 'utf8');
  const linea = env.split('\n').find((l) => l.startsWith('DATABASE_URL_MIGRATOR='));
  if (!linea) throw new Error('No hay DATABASE_URL_MIGRATOR en gymflow-backend/.env');
  return linea.slice(linea.indexOf('=') + 1).replace(/"/g, '').trim().replace(/\/gymflow_[a-z_]+\?schema=public/, `/${base}`);
}
const baseDe = (url) => new URL(url).pathname.replace(/^\//, '');

function pg() {
  const dirs = [`${home}/gymflow-db/node_modules/.pnpm`, `${home}/gymflow-backend/node_modules/.pnpm`]
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((x) => /^pg@\d/.test(x)).map((x) => `${d}/${x}/node_modules`));
  const require = createRequire(import.meta.url);
  return require(require.resolve('pg', { paths: dirs }));
}

/** Una consulta contra gymflow_pruebas; devuelve las filas. */
export async function sql(texto, valores = []) {
  const url = urlCon(BASE_PRUEBAS);
  const base = baseDe(url);
  if (base !== BASE_PRUEBAS) throw new Error(`lib/base.mjs solo escribe en gymflow_pruebas, no en «${base}»`);
  const { Client } = pg();
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(texto, valores)).rows; } finally { await c.end(); }
}

/**
 * Consulta de SOLO LECTURA contra `base` (gymflow_pruebas si no se dice). La
 * transacción es READ ONLY: la base rechaza cualquier escritura, aunque el
 * texto la tuviera.
 */
export async function leer(texto, valores = [], { base = BASE_PRUEBAS } = {}) {
  if (!/^gymflow_[a-z_]+$/.test(base)) throw new Error(`Base inválida: «${base}»`);
  const url = urlCon(base);
  const { Client } = pg();
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const filas = (await c.query(texto, valores)).rows;
    await c.query('ROLLBACK');
    return filas;
  } finally { await c.end(); }
}
