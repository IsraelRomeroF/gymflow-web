// La dueña, en su teléfono: actividad del día y lo que gana, sin acciones. En
// escritorio, lo administrativo sí y la operación no (ADR-039).
import { recorrido, abrirMenu, asentado, PANEL, T } from './lib/index.mjs';

await recorrido('duena', async (r) => {
  const p = await r.como('duena', { movil: true, deviceScaleFactor: 1 });
  await p.getByText(/Hoy, hasta las/).waitFor({ timeout: T.respuesta });
  r.ok(await p.getByText('Entró a caja').count() > 0, 'su inicio dice cuánto entró hoy');
  r.ok(await p.getByText(/ayer a esta hora/i).count() > 0, 'lo compara con ayer a esta misma hora');
  r.ok(await p.getByText(/Este mes \(1–/).count() > 0 && await p.getByText('Ganancia en caja', { exact: true }).count() > 0, 'dice la ganancia del mes');
  r.ok(await p.getByText(/el mes pasado al mismo día/).count() > 0, 'y la compara con el mes pasado al mismo día');
  r.ok(await p.getByText('Lo que conviene revisar').count() > 0, 'tiene su tarjeta de alertas');
  // Monitoreo de personal (ADR-039): su equipo, con puesto y actividad, sin un solo expediente.
  await p.getByTestId('equipo').waitFor({ timeout: T.respuesta });
  r.ok(await p.locator('[data-testid="equipo"] [data-equipo]').count() >= 3 && await p.locator('[data-testid="equipo"] [data-equipo="OWNER"]').count() === 0, 'su inicio lista a su equipo con su puesto, y ella no se lista a sí misma');
  r.ok(await p.locator('[data-testid="equipo"]').getByText(/Recepción|Caja|Encargado/).count() > 0, 'los puestos se leen como los dice el gimnasio');
  await r.captura(p, 'duena-inicio', { full: true });
  const s = await r.como('duena');
  await s.getByText(/Hoy, hasta las/).waitFor({ timeout: T.respuesta });
  await r.captura(s, 'duena-inicio-escritorio', { full: true });
  await abrirMenu(s);
  r.ok(await s.getByRole('link', { name: 'Socios' }).count() === 0, 'no ve el mostrador en el menú');
  r.ok(await s.locator('.side-nav').getByRole('link', { name: 'Autorizaciones' }).count() === 1, 'tiene la bandeja de Autorizaciones: da la segunda firma');
  // Lo administrativo sí; la operación (socios, clases, altas) no (ADR-039).
  const faltan = [];
  const menu = s.locator('.side-nav');
  for (const n of ['Tablero', 'Movimientos', 'Personal', 'Bitácora']) if (await menu.getByRole('link', { name: n, exact: true }).count() !== 1) faltan.push(`${n}=${await menu.getByRole('link', { name: n, exact: true }).count()}`);
  r.ok(faltan.length === 0, `ve Tablero, Movimientos, Personal y Bitácora${faltan.length ? ` (${faltan.join(', ')})` : ''}`);
  r.ok(await s.getByRole('link', { name: 'Socios' }).count() === 0 && await s.getByRole('link', { name: 'Clases', exact: true }).count() === 0 && await s.getByRole('link', { name: 'Altas digitales' }).count() === 0, 'no ve Socios, Clases ni Altas digitales: son operación');
  r.ok((await s.locator('.side-user-role').innerText()).includes('Dueño'), 'el panel dice que es el dueño');
  // Una ruta de operación escrita a mano le dice, dentro del panel, que no es suya.
  await s.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await s.getByText('Tu rol no ve esta pantalla').waitFor({ timeout: T.respuesta });
  r.ok(true, 'si teclea /socios, el panel le explica que esa pantalla no es de su puesto');
  await r.captura(s, 'duena-ficha');
  // Caja, solo consulta; Personal, solo consulta.
  await s.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await asentado(s);
  r.ok(await s.getByRole('button', { name: /Hacer corte|Retiro o gasto|Abrir turno/ }).count() === 0, 'en Caja no puede cortar, retirar ni abrir');
  await s.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await s.getByRole('heading', { name: 'Personal' }).waitFor({ timeout: T.respuesta });
  await asentado(s);
  r.ok(await s.getByRole('button', { name: /Nueva cuenta|Agregar|Dar de alta/ }).count() === 0, 'en Personal consulta, pero no da de alta');
}, { erroresDePagina: 'ok' });
