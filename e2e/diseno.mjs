// Tercera tanda de diseño (2026-10-06): Personal, Clases, Tablero, Caja,
// Punto de venta en teléfono e Inicio del dueño a dos columnas.
// Datos propios (fase 1.17a): el socio que debe y se cobra en Caja es de esta
// corrida (antes, el primer deudor de Centro de la semilla).
import { recorrido, socioSuspendido, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('diseno', async (r) => {
  const deudor = await socioSuspendido(await r.api('gerencia'), { sede: 'CEN', mesesAtras: 0 });

  // 1. Personal: el estado de cada cuenta y "Editar" a la vista.
  r.paso('personal');
  const g = await r.como('gerencia');
  await g.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await g.locator('table tbody tr').first().waitFor({ timeout: T.respuesta });
  r.ok(await g.getByRole('columnheader', { name: 'Cuenta' }).count() === 1, 'Personal tiene la columna Cuenta');
  r.ok(await g.locator('table tbody').getByText(/^(Activa|Contraseña temporal|Aún no entra|Dada de baja|Temporal vencida)$/).count() >= 3, 'cada persona dice el estado de su cuenta');
  r.ok(await g.locator('table tbody').getByRole('button', { name: 'Editar' }).count() >= 1, 'el botón Editar se ve en la fila');
  const buscar = g.getByLabel('Buscar personal');
  if (await buscar.count()) {
    await buscar.fill('paola');
    r.ok(await g.locator('table tbody tr').count() === 1, 'el buscador de personal filtra por nombre, sin acentos ni mayúsculas');
  }

  // 2. Clases: hoy primero.
  r.paso('clases');
  await g.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  // Clases abre en «Sesiones», agrupadas por día, y el primer bloque es el de hoy (bloque 2.5; antes «Hoy» y «Próximos 7 días»).
  await g.getByTestId('clases-hoy').waitFor({ timeout: T.respuesta });
  const dias = await g.locator('section[id^="dia-"] h2').allInnerTexts();
  r.ok(await g.getByRole('tab', { name: 'Sesiones' }).getAttribute('aria-selected') === 'true' && (dias[0] ?? '').startsWith('Hoy'), 'Clases empieza por las sesiones de hoy');

  // 3. Tablero: la cartera en socios.
  r.paso('tablero');
  await g.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await g.getByTestId('socios-atrasados').waitFor({ timeout: T.respuesta });
  r.ok(/\d+ de \d+ socios atrasados/.test(await g.getByTestId('socios-atrasados').innerText()), 'la cartera dice cuántos socios van atrasados');
  r.ok(await g.getByText('Vencido del total por cobrar').count() === 0, 'ya no dice "vencido del total por cobrar"');

  // 4. Caja: "¿A quién le cobras?" con el cobro en la fila.
  r.paso('caja');
  const rc = await r.como('recepcion');
  await rc.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await rc.getByText('Cortes anteriores').waitFor({ timeout: T.respuesta });
  await asentado(rc);
  if (await rc.getByRole('button', { name: 'Hacer corte' }).count() === 0) {
    await rc.getByRole('button', { name: 'Abrir turno' }).first().click();
    await rc.getByRole('dialog').getByLabel('Fondo inicial').fill('500');
    await rc.getByRole('dialog').getByRole('button', { name: 'Abrir turno' }).click();
  }
  await rc.getByTestId('a-quien-cobras').waitFor({ timeout: T.respuesta });
  // El socio que debe, de esta corrida, buscado por su código: el resultado es determinista.
  await rc.getByLabel('Buscar socio para cobrar').fill(deudor.memberCode);
  const conCobro = await aparece(rc.getByTestId('a-quien-cobras').getByRole('button', { name: /^Cobrar \$/ }).first(), T.respuesta);
  r.ok(conCobro, 'en la caja se busca al socio y la fila trae "Cobrar $…"');
  if (conCobro) {
    await rc.getByTestId('a-quien-cobras').getByRole('button', { name: /^Cobrar \$/ }).first().click();
    await rc.getByRole('dialog').getByText(/^Cobrar a /).waitFor();
    await rc.getByRole('dialog').getByLabel(/Importe/).fill('abc');
    // count() no espera: con la máquina cargada se contaba antes de que el error se pintara.
    const errCampo = rc.getByRole('dialog').locator('.field-error');
    await errCampo.first().waitFor({ timeout: T.ui }).catch(() => undefined);
    const nErr = await errCampo.count();
    if (nErr !== 1) {
      // Para diagnosticar: qué quedó en el campo y qué decía el diálogo.
      await r.captura(rc, 'diseno-importe-mal-escrito', { red: false });
      console.log('diagnóstico:', JSON.stringify({ valor: await rc.getByRole('dialog').getByLabel(/Importe/).inputValue().catch(() => null), dialogos: await rc.getByRole('dialog').count(), texto: (await rc.getByRole('dialog').first().innerText().catch(() => '')).replace(/\n+/g, ' · ').slice(0, 400) }));
    }
    r.ok(nErr === 1, `un importe mal escrito se marca en su campo (${nErr}${nErr !== 1 ? `: ${(await errCampo.allInnerTexts()).join(' | ')} · socio ${deudor.memberCode}` : ''})`);
    await rc.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  }

  // 5. Punto de venta en el teléfono: barra fija con el ticket.
  r.paso('punto de venta en el teléfono');
  const m = await r.como('recepcion', { viewport: { width: 390, height: 844 } });
  await m.goto(`${PANEL}/punto-de-venta`, { waitUntil: 'networkidle' });
  await m.locator('.pos-producto:not([disabled])').first().waitFor({ timeout: T.respuesta });
  await m.locator('.pos-producto:not([disabled])').first().click();
  await m.getByTestId('pos-barra').waitFor();
  r.ok(/1 producto · \$/.test(await m.getByTestId('pos-barra').innerText()), 'la barra dice cuántos productos y cuánto lleva');
  const barra = await m.getByTestId('pos-barra').boundingBox();
  r.ok(!!barra && barra.y + barra.height <= 844 + 1 && barra.y > 600, 'la barra queda fija abajo de la pantalla');

  // 6. Inicio del dueño: dos columnas en escritorio.
  r.paso('inicio de la dueña');
  const o = await r.como('duena');
  await o.getByTestId('sedes').waitFor({ timeout: T.respuesta });
  const sedes = await o.getByTestId('sedes').boundingBox();
  const alertas = await o.locator('.duena-alertas').boundingBox();
  r.ok(!!sedes && !!alertas && alertas.x > sedes.x + sedes.width - 1, 'lo que pide atención va a la derecha de la operación del día');
}, { erroresDePagina: 'falla' });
