// La llave del dueño (2026-10-06): Dirección y Cumplimiento se liberan sección
// por sección. El recorrido deja a recepción como la encontró: Planes
// cerrado y Caja con su puesto.
import { recorrido, abrirMenu, PANEL, T } from './lib/index.mjs';

await recorrido('llave', async (r) => {
  // Las secciones del menú vienen plegadas: se abren antes de contar.
  const enMenu = async (p, nombre) => { await abrirMenu(p); return (await p.locator('.side-nav').getByRole('link', { name: nombre, exact: true }).count()) === 1; };

  // 1. Recepción, por su puesto, no ve Dirección; y por un enlace directo tampoco.
  let rec = await r.como('recepcion');
  r.ok(!(await enMenu(rec, 'Planes')) && !(await enMenu(rec, 'Tablero')), 'recepción no ve Planes ni Tablero por su puesto');
  await rec.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  await rec.getByText('Esta pantalla la libera el dueño').waitFor({ timeout: T.respuesta });
  r.ok(true, 'por enlace directo dice que la libera el dueño');
  await rec.context().close();

  // 2. El dueño le libera Planes desde Personal.
  const own = await r.como('duena');
  await own.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  const fila = own.locator('table tbody tr', { hasText: 'recepcion@demo.mx' });
  await fila.waitFor({ timeout: T.respuesta });
  r.ok((await fila.getByTestId('llave').innerText()).includes('Solo operación'), 'Personal dice que recepción solo ve la operación');
  await fila.getByRole('button', { name: 'Qué ve' }).click();
  const d = own.getByRole('dialog');
  await d.getByTestId('secciones-llave').waitFor();
  r.ok(await d.getByRole('button', { name: 'Guardar rol' }).count() === 0, 'el dueño no cambia puestos: solo qué ve cada quien');
  await d.getByLabel('Planes', { exact: true }).check();
  await d.getByLabel(/Motivo/).fill('Lleva el catálogo de la sucursal');
  await d.getByRole('button', { name: 'Guardar secciones' }).click();
  await own.getByText(/Secciones guardadas/).waitFor({ timeout: T.respuesta });
  await fila.getByTestId('llave').filter({ hasText: '1 de' }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el dueño libera Planes a recepción y Personal lo refleja');
  await r.captura(own, 'llave-personal');

  // 3. Recepción vuelve a entrar: ahora ve Planes, y nada más de Dirección.
  rec = await r.como('recepcion');
  r.ok(await enMenu(rec, 'Planes'), 'tras volver a entrar, recepción ve Planes');
  r.ok(!(await enMenu(rec, 'Tablero')) && !(await enMenu(rec, 'Movimientos')), 'y sigue sin ver Tablero ni Movimientos');
  await rec.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  await rec.getByRole('heading', { name: 'Planes', exact: true }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la pantalla de Planes abre');

  // 4. El dueño se la quita: se cierra de nuevo.
  await own.reload({ waitUntil: 'networkidle' });
  await fila.getByRole('button', { name: 'Qué ve' }).click();
  await own.getByRole('dialog').getByLabel('Planes', { exact: true }).uncheck();
  await own.getByRole('dialog').getByLabel(/Motivo/).fill('Ya no lleva el catálogo');
  await own.getByRole('dialog').getByRole('button', { name: 'Guardar secciones' }).click();
  await own.getByText(/Secciones guardadas/).waitFor({ timeout: T.respuesta });
  rec = await r.como('recepcion');
  r.ok(!(await enMenu(rec, 'Planes')), 'al quitársela, recepción deja de ver Planes');

  // 4b. Caja viene con el puesto: el dueño se la QUITA a recepción y luego se la devuelve (2026-10-07).
  r.ok(await enMenu(rec, 'Caja'), 'recepción ve Caja por su puesto');
  await own.reload({ waitUntil: 'networkidle' });
  await fila.getByRole('button', { name: 'Qué ve' }).click();
  await own.getByRole('dialog').getByLabel('Caja', { exact: true }).uncheck();
  await own.getByRole('dialog').getByLabel(/Motivo/).fill('Este turno no lleva caja');
  await own.getByRole('dialog').getByRole('button', { name: 'Guardar secciones' }).click();
  await own.getByText(/Secciones guardadas/).waitFor({ timeout: T.respuesta });
  await fila.getByTestId('llave').filter({ hasText: 'sin Caja' }).waitFor({ timeout: T.respuesta });
  rec = await r.como('recepcion');
  r.ok(!(await enMenu(rec, 'Caja')) && await enMenu(rec, 'Punto de venta'), 'sin Caja en el menú, pero sigue con Punto de venta');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await rec.getByText('El dueño quitó esta pantalla a tu cuenta').waitFor({ timeout: T.respuesta });
  r.ok(true, 'por enlace directo dice que el dueño se la quitó');
  await own.reload({ waitUntil: 'networkidle' });
  await fila.getByRole('button', { name: 'Qué ve' }).click();
  await own.getByRole('dialog').getByLabel('Caja', { exact: true }).check();
  await own.getByRole('dialog').getByLabel(/Motivo/).fill('Vuelve a llevar caja');
  await own.getByRole('dialog').getByRole('button', { name: 'Guardar secciones' }).click();
  await own.getByText(/Secciones guardadas/).waitFor({ timeout: T.respuesta });
  rec = await r.como('recepcion');
  r.ok(await enMenu(rec, 'Caja'), 'al devolvérsela, recepción vuelve a ver Caja');

  // 5. El gerente de ensayo tiene todo liberado; el dueño no tiene llave.
  const ger = await r.como('gerencia');
  r.ok(await enMenu(ger, 'Tablero') && await enMenu(ger, 'Bitácora'), 'el gerente con todo liberado ve Dirección y Cumplimiento');
  await own.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  const filaOwner = own.locator('table tbody tr', { hasText: 'owner@demo.mx' });
  await filaOwner.waitFor();
  r.ok(await filaOwner.getByTestId('llave').count() === 0, 'el dueño no tiene llave: ve todo por su puesto');
}, { erroresDePagina: 'falla' });
