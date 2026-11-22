// Control (Dirección y Cumplimiento): la bitácora abre en «Para revisar» con
// quién autorizó y su cadena se verifica; los gastos fijos entran a la
// ganancia; el tablero compara cada cifra; el coach no ve saldos.
//
// Fase 1.17a: ya no depende de que `bloque3` haya corrido antes: arranca con
// un retiro autorizado propio (lib/datos.mjs · retiroAutorizado), y su renta
// lleva el nombre de la corrida y se anula al terminar (antes se sumaba una
// renta de $31,000 por corrida al mismo mes).
import { recorrido, irPorMenu, retiroAutorizado, accion, asentado, hoy, letras, PANEL, T } from './lib/index.mjs';

await recorrido('control', async (r) => {
  const motivoRetiro = `Retiro de prueba autorizado ${letras(4)}`;
  await retiroAutorizado(await r.api('gerente'), { sede: 'CEN', centavos: 100, motivo: motivoRetiro });
  const renta = `Renta del local de prueba ${letras(4)}`;
  const g = await r.api('gerencia');
  r.alFinal(async () => {
    const mes = hoy().slice(0, 7);
    const gasto = (await g.get(`/expenses?month=${mes}`)).expenses.find((x) => x.description === renta && !x.voidedAt);
    if (gasto) await g.post(`/expenses/${gasto.id}/void`, { reason: 'Gasto de un recorrido de prueba' });
  });

  // 1. Bitácora: abre en "Para revisar", con quién autorizó.
  r.paso('bitácora');
  const o = await r.como('gerencia');
  await irPorMenu(o, 'Bitácora');
  await o.getByRole('heading', { name: 'Bitácora' }).waitFor({ timeout: T.respuesta });
  await o.locator('.list-item').first().waitFor({ timeout: T.respuesta });
  await asentado(o);
  // 1.11: se cuentan los asientos; la tarjeta «Entradas por excepción» también usa .list-item.
  const revisar = await o.getByTestId('asiento').count();
  r.ok(revisar > 0, `"Para revisar" trae ${revisar} operaciones sensibles`);
  r.ok(await o.getByText(/Autorizó /).count() > 0, 'dice quién autorizó (el retiro autorizado de esta corrida)');
  await r.captura(o, 'bitacora');
  await o.getByRole('button', { name: 'Verificar integridad' }).click();
  await o.getByText(/Íntegra: .* registros encadenados/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la cadena de la bitácora se verifica desde la pantalla');
  await accion(o, () => o.getByRole('button', { name: 'Todo' }).click(), '/api/audit', { metodo: 'GET', que: 'la bitácora completa' });
  await asentado(o);
  // «Todo» pagina y agrupa lo del sistema: no se comparan cuentas, se comprueba que trae también lo que no es para revisar.
  r.ok(await o.locator('[data-testid="asiento"][data-revisar="no"], [data-testid="grupo-sistema"]').count() > 0, '"Todo" trae también lo que no es para revisar');

  // 2. Gastos fijos en Movimientos: la ganancia los descuenta.
  r.paso('gastos fijos');
  await o.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  await o.getByText('Gastos fijos', { exact: true }).waitFor({ timeout: T.respuesta });
  await o.getByRole('button', { name: 'Registrar' }).click();
  const d = o.getByRole('dialog');
  await d.getByLabel('Descripción').fill(renta);
  await d.getByLabel('Importe del mes').fill('31000');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await o.getByText('Gasto registrado').waitFor({ timeout: T.respuesta });
  await o.getByText(renta).waitFor();
  r.ok(true, 'la renta queda registrada en el mes');
  r.ok(await o.getByText(/En caja quedó/).count() > 0, 'la ganancia distingue lo que quedó en caja');
  await r.captura(o, 'gastos-fijos', { full: true });

  // 3. Tablero: utilidad y comparación.
  r.paso('tablero');
  await o.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await o.locator('.stat-label', { hasText: 'Utilidad' }).waitFor({ timeout: T.respuesta });
  r.ok(await o.getByText(/ (más|menos) que |Igual que | no había entrado nada/).count() > 0, 'cada cifra se compara con el periodo anterior, en pesos');
  await o.getByRole('button', { name: 'Mes pasado' }).click();
  await o.locator('.tablero-cifras:not([aria-busy])').waitFor({ timeout: T.respuesta });
  await o.locator('.stat-label', { hasText: 'Utilidad' }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el tablero cambia a un mes de calendario');
  await r.captura(o, 'tablero-utilidad');

  // 5. Coach: sin saldos ni deudores.
  r.paso('el coach no ve saldos');
  const c = await r.como('coach');
  await c.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await c.locator('table tbody tr').first().waitFor({ timeout: T.respuesta });
  r.ok(await c.getByRole('columnheader', { name: 'Saldo' }).count() === 0, 'el coach no ve la columna de saldo');
  r.ok(await c.getByText('Solo con adeudo').count() === 0, 'ni el filtro de deudores');
  await c.locator('table tbody tr').first().click();
  await c.getByRole('tab', { name: 'Resumen' }).waitFor({ timeout: T.respuesta }).catch(() => undefined);
  await asentado(c);
  r.ok(await c.getByText('Por cobrar').count() === 0 && await c.getByText('Identificación').count() === 0, 'la ficha no muestra saldo ni la biometría que no puede ver');
  await r.captura(c, 'coach-ficha');
}, { erroresDePagina: 'ok' });
