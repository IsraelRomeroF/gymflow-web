// PRIMER USO REAL: cuenta de plataforma nueva (contraseña propia) → primera
// marca → liberarla → la gerencia entra por primera vez y recorre su gimnasio
// vacío. Corre contra las pruebas (panel 4003) o contra otra instalación de
// ensayo (GYMFLOW_E2E_PANEL), nunca contra el uso real.
//
// Se basta solo (fase 1.17a): si no recibe PLATAFORMA y TEMPORAL, crea su
// propia cuenta de plataforma en gymflow_pruebas con el guion de siempre
// (gymflow-backend/scripts/plataforma-alta.ts, perfil de pruebas), y la marca,
// sus cuentas y sus correos llevan el sufijo de la corrida. Antes usaba
// correos fijos («gerencia@fuerza.mx»): la segunda corrida chocaba con la
// primera y había que regenerar la base. Por eso no estaba en regresion.sh.
//   A mano, con una cuenta propia:
//   cd ~/gymflow-backend && bash scripts/perfil.sh pruebas npx tsx scripts/plataforma-alta.ts ensayo@gymflow.mx "Ensayo"
//   PLATAFORMA=ensayo@gymflow.mx TEMPORAL=xxxx node e2e/primer-uso.mjs
import { execFileSync } from 'node:child_process';
import { recorrido, elegirContrasena, sesionApi, sufijo, letras, asentado, PANEL, T } from './lib/index.mjs';

const NUEVA = 'Una contraseña propia larga 2026';

/** Una cuenta de plataforma con su temporal, en gymflow_pruebas (el perfil de pruebas lo fija). */
function cuentaDePlataforma(correo) {
  const salida = execFileSync('bash', ['scripts/perfil.sh', 'pruebas', 'node_modules/.bin/tsx', 'scripts/plataforma-alta.ts', correo, 'Ensayo de primer uso'],
    { cwd: `${process.env.HOME}/gymflow-backend`, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/creada en gymflow_pruebas/.test(salida)) throw new Error(`plataforma-alta no dijo que escribió en gymflow_pruebas: ${salida.slice(0, 200)}`);
  const temporal = salida.match(/Contraseña temporal:\s+(\S+)/)?.[1];
  if (!temporal) throw new Error('plataforma-alta no imprimió la contraseña temporal');
  return temporal;
}

await recorrido('primer-uso', async (r) => {
  const s = sufijo();
  const plataforma = process.env.PLATAFORMA ?? `ensayo.${s}@gymflow.mx`;
  const temporal = process.env.TEMPORAL ?? cuentaDePlataforma(plataforma);
  if (!process.env.PLATAFORMA) r.nota(`cuenta de plataforma de esta corrida: ${plataforma}`);
  const marca = `Fuerza Norte ${letras(4)}`;
  // La marca de esta corrida se suspende al terminar (no entra a la cobranza de cada mes).
  r.alFinal(async () => {
    const api = await sesionApi(plataforma, { clave: NUEVA });
    await api.post('/platform/reauth', { password: NUEVA });
    const org = (await api.get('/platform/organizations')).organizations.find((o) => o.tradeName === marca);
    if (org) await api.post(`/platform/organizations/${org.id}/service`, { status: 'SUSPENDED', reason: 'Marca de un recorrido de prueba' });
  });
  const correo = (rol) => `${rol}.${s}@fuerza.mx`;
  const shot = (p, n, full = true) => r.captura(p, `primer-${n}`, { full });

  // Sin verificación en dos pasos: correo y contraseña.
  async function entrar(p, email, clave) {
    await p.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
    await p.getByLabel('Correo').fill(email);
    await p.getByLabel('Contraseña').fill(clave);
    await p.getByRole('button', { name: /^Entrar/ }).first().click();
  }

  // 1. Plataforma: la temporal solo sirve para elegir la propia, ahí mismo en el login (A4-N1).
  r.paso('la plataforma elige su contraseña');
  const p = await r.nueva();
  await entrar(p, plataforma, temporal);
  await p.getByTestId('elegir-contrasena').waitFor({ timeout: T.respuesta });
  r.ok(true, 'la plataforma entra sin código y lo primero es elegir su contraseña');
  await shot(p, 'plat-2-clave-temporal', false);
  await elegirContrasena(p, NUEVA);
  await p.waitForURL('**/plataforma', { timeout: T.navegacion });
  await p.getByRole('heading', { name: 'Marcas' }).waitFor({ timeout: T.respuesta });
  await shot(p, 'plat-3-marcas-vacia');

  // 2. Primera marca: pide reconfirmar.
  r.paso('primera marca');
  await p.getByRole('button', { name: 'Nueva marca' }).first().click();
  const d = p.getByRole('dialog');
  await d.getByLabel('Nombre comercial').fill(marca);
  await d.getByLabel('Razón social').fill(`${marca} Gimnasios S.A. de C.V.`);
  await d.locator('#nm-bc').fill('NTE');
  await d.locator('#nm-bn').fill('Norte');
  // El alta va en tres pasos (bloque 2.11): la marca → qué contrató (a la medida, todo) → las cuentas.
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.getByText('Paso 2 de 3').waitFor({ timeout: T.ui });
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.getByText('Paso 3 de 3').waitFor({ timeout: T.ui });
  const personas = [['ow', 'Ana Dueña Ríos', correo('duena')], ['s0', 'Carlos Gerente Paz', correo('gerencia')], ['s1', 'Rosa Recepción Luna', correo('recepcion')]];
  for (const [id, n, e] of personas) { await d.locator(`#${id}-n`).fill(n); await d.locator(`#${id}-e`).fill(e); }
  await d.getByLabel('Motivo del alta').fill('Contrato firmado');
  await shot(p, 'plat-4-nueva-marca', false);
  await d.getByRole('button', { name: 'Dar de alta la marca' }).click();
  const conf = p.getByRole('dialog').filter({ hasText: 'Confirma que eres tú' });
  await conf.waitFor({ timeout: T.respuesta });
  r.ok(true, 'dar de alta la marca pide reconfirmar con la contraseña');
  await conf.getByLabel('Tu contraseña').fill(NUEVA);
  await conf.getByRole('button', { name: 'Confirmar' }).click();
  await p.getByText('accesos de arranque').waitFor({ timeout: T.respuesta });
  await shot(p, 'plat-5-credenciales', false);
  const correoGerencia = correo('gerencia');
  const filaGerencia = p.getByRole('dialog').locator('div, li').filter({ hasText: correoGerencia }).last();
  const temporalGerencia = (await p.getByRole('dialog').innerText()).match(new RegExp(`${correoGerencia.replace(/[.]/g, '\\.')}\\s*\\n?\\s*(GYM-[A-Z0-9]{4}-[A-Z0-9]{4})`))?.[1]
    ?? (await filaGerencia.innerText()).match(/GYM-[A-Z0-9-]+/)?.[0];
  r.ok(!!temporalGerencia, 'se ven las contraseñas temporales una sola vez');
  await p.getByRole('button', { name: 'Ya los entregué' }).click();
  await p.locator(`[data-marca="${marca}"] a.strong`).first().click();
  await p.getByRole('button', { name: 'Liberar el software' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Contrato firmado y primer pago recibido' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Liberar', exact: true }).click();
  await p.getByText(/liberad/i).first().waitFor({ timeout: T.respuesta });
  await shot(p, 'plat-6-marca-liberada');
  await p.goto(`${PANEL}/plataforma/seguridad`, { waitUntil: 'networkidle' });
  await shot(p, 'plat-7-seguridad');
  await p.getByRole('button', { name: 'Salir' }).click();
  await p.waitForURL('**/login');

  // 3. La gerencia entra por primera vez.
  r.paso('la gerencia entra por primera vez');
  const g = await r.nueva();
  await entrar(g, correoGerencia, String(temporalGerencia).trim());
  await g.getByTestId('elegir-contrasena').waitFor({ timeout: T.respuesta });
  await shot(g, 'ger-2-cambiar-clave', false);
  await elegirContrasena(g, NUEVA);
  await g.waitForURL('**/panel', { timeout: T.navegacion });
  r.ok(true, 'la gerencia elige su contraseña al entrar y llega a su inicio');
  await shot(g, 'ger-1-primer-inicio', false);
  for (const ruta of ['panel', 'arranque', 'socios', 'caja', 'punto-de-venta', 'clases', 'planes', 'productos', 'personal', 'sucursales', 'tablero', 'movimientos', 'bitacora', 'modulos', 'altas', 'prospectos', 'rutinas', 'retencion']) {
    await g.goto(`${PANEL}/${ruta}`, { waitUntil: 'networkidle' });
    await asentado(g);
    await shot(g, `ger-p-${ruta}`);
  }
});
