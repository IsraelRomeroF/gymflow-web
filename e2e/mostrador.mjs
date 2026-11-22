// Mostrador (auditoría UX 7, frente 1): veredicto verde con plan y vigencia,
// ficha de estado único, cotización en la fila, inicio con buscador y cajas
// ajenas, historial de Caja de 7 días y ticket con nombres completos.
//
// Datos propios (fase 1.17a): el socio al corriente, el suspendido y la clase
// que se cotiza son de esta corrida; antes eran los primeros de la semilla.
import { recorrido, socioAlCorriente, socioSuspendido, crearClase, retirarClase, letras, motivoDeExcepcion, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('mostrador', async (r) => {
  const g = await r.api('gerencia');
  const activo = await socioAlCorriente(g, { sede: 'CEN' });
  const deudor = await socioSuspendido(g, { sede: 'CEN', mesesAtras: 0 });
  const clase = await crearClase(g, { sede: 'CEN', nombre: `Yoga ${letras(4)}`, dias: [1] });
  r.alFinal(() => retirarClase(g, clase.tipo));
  r.ok(!!activo && !!deudor, `hay socio al corriente (${activo.firstName}) y suspendido (${deudor.firstName}), de esta corrida`);

  const rec = await r.como('recepcion');

  // Inicio: el inicio de recepción ES el mostrador (bloque 2.1): se busca y se atiende ahí mismo, sin ir a Socios.
  r.paso('buscar desde el inicio');
  const buscar = rec.locator('[data-testid="buscar-inicio"]');
  await buscar.waitFor({ timeout: T.respuesta }).catch(() => undefined);
  r.ok(await buscar.count() === 1, 'el inicio de recepción trae el buscador de socios');
  r.ok(await rec.getByText('Accesos rápidos').count() === 0, 'ya no hay "Accesos rápidos" que repitan el menú');
  await r.captura(rec, 'mostrador-inicio');
  await buscar.getByLabel('Buscar socio').fill(activo.memberCode);
  await rec.locator('[data-testid="resultados"]').getByText(activo.firstName).first().waitFor({ timeout: T.respuesta });
  r.ok(new URL(rec.url()).pathname === '/panel', 'buscar desde el inicio muestra el resultado ahí mismo, sin cambiar de pantalla');
  const tarjeta = rec.getByTestId('tarjeta-socio');
  await tarjeta.waitFor({ timeout: T.respuesta });
  r.ok((await tarjeta.getAttribute('data-socio')) === activo.memberCode, 'el resultado elegido muestra su tarjeta, con Entrada a la mano');
  await r.captura(rec, 'mostrador-inicio-tarjeta');

  // Veredicto verde: plan y vigencia, antes de cerrarse solo.
  r.paso('veredicto verde');
  await rec.getByRole('button', { name: 'Entrada' }).first().click();
  await motivoDeExcepcion(rec);
  const vig = rec.locator('[data-testid="vigencia-entrada"]');
  await vig.waitFor({ timeout: T.respuesta });
  const textoVig = await vig.innerText();
  r.ok(/vigente hasta|quedan? \d|pago pendiente/i.test(textoVig), `el verde dice plan y vigencia: "${textoVig.replace(/\n/g, ' ')}"`);
  await r.captura(rec, 'mostrador-verde', { red: false });
  await rec.getByRole('dialog').waitFor({ state: 'hidden', timeout: T.ui });

  // Historial de accesos en la ficha: la entrada por excepción con su motivo y quién la registró.
  r.paso('historial de accesos');
  await rec.goto(`${PANEL}/socios/${activo.id}?tab=accesos`, { waitUntil: 'networkidle' });
  const hist = rec.getByTestId('accesos-socio');
  await hist.waitFor({ timeout: T.respuesta });
  r.ok(await hist.locator('[data-acceso="GRANTED"]').count() > 0, 'la ficha tiene el historial de accesos');
  r.ok(await hist.getByText(/Excepción:.*recorrido de prueba/).count() > 0, 'la entrada por el mostrador aparece como excepción, con su motivo');
  await r.captura(rec, 'mostrador-historial', { full: true });

  // Ficha del suspendido: "Suspendida" una sola vez (la cabecera).
  r.paso('ficha del suspendido');
  await rec.goto(`${PANEL}/socios/${deudor.id}`, { waitUntil: 'networkidle' });
  await rec.locator('.stat').first().waitFor();
  await asentado(rec);
  const veces = await rec.locator('main').getByText(/Suspendida/).count();
  r.ok(veces === 1, `la ficha dice "Suspendida" una vez (${veces})`);
  r.ok(await rec.getByText('Da acceso hoy').count() === 0, 'sin "Da acceso hoy" repetido');
  r.ok(await rec.locator('.stat').filter({ hasText: 'Pagado hasta' }).count() === 1, 'la cifra dice hasta dónde pagó');
  await r.captura(rec, 'mostrador-ficha');

  // Inscribir a clase: la cotización sale dentro de la fila elegida (en la clase de esta corrida).
  r.paso('cotización en la fila');
  await rec.goto(`${PANEL}/socios/${activo.id}`, { waitUntil: 'networkidle' });
  const abrirClase = rec.getByRole('button', { name: /Inscribir a (una )?clase/ });
  if (await abrirClase.count() === 0) { await rec.getByRole('button', { name: 'Más' }).click(); }
  await rec.getByRole('button', { name: /Inscribir a (una )?clase/ }).or(rec.getByRole('menuitem', { name: /Inscribir a una clase/ })).first().click();
  const dlg = rec.getByRole('dialog');
  await dlg.locator('[data-sesion]').first().waitFor({ timeout: T.respuesta });
  const idSesion = await dlg.locator('[data-sesion]').filter({ hasText: clase.tipo.name }).filter({ has: rec.getByRole('button', { name: 'Inscribir' }) }).first().getAttribute('data-sesion');
  const fila = dlg.locator(`[data-sesion="${idSesion}"]`);
  await fila.getByRole('button', { name: 'Inscribir' }).click();
  const cot = dlg.locator('[data-testid="cotizacion"]');
  await cot.waitFor({ timeout: T.respuesta });
  r.ok(await fila.evaluate((li) => li.nextElementSibling?.getAttribute('data-testid') === 'cotizacion'), 'la cotización queda justo debajo de la fila');
  const tCot = await cot.innerText();
  r.ok(!(/se cobra ahora/.test(tCot) && /se carga a su cuenta/.test(tCot)), `un solo texto: "${tCot.split('\n')[0]}"`);
  await r.captura(rec, 'mostrador-cotizacion');
  await cot.getByRole('button', { name: /Cancelar|Cerrar/ }).click();
  await dlg.getByRole('button', { name: 'Listo' }).click();

  // Caja: siete días a la vista y "Ver más".
  r.paso('historial de caja');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const cortes = rec.locator('.card').filter({ hasText: 'Cortes anteriores' });
  await cortes.locator('tbody tr').first().waitFor({ timeout: T.respuesta });
  const antes = await cortes.locator('tbody tr').count();
  const fechas = new Set(await cortes.locator('tbody tr td:first-child .strong').allTextContents());
  r.ok(fechas.size <= 7, `historial de 7 días (${fechas.size} días, ${antes} turnos)`);
  const mas = cortes.getByRole('button', { name: /Ver más/ });
  if (await mas.count()) {
    await mas.click();
    r.ok(await aparece(cortes.locator(`tbody tr:nth-child(${antes + 1})`), T.respuesta), '"Ver más" trae el resto');
  }
  await cortes.locator('tbody tr').first().click();
  await rec.waitForURL('**/caja/*');
  r.ok(true, 'la fila entera abre el corte');

  // Punto de venta: el nombre del producto completo en el ticket.
  r.paso('ticket del punto de venta');
  await rec.goto(`${PANEL}/punto-de-venta`, { waitUntil: 'networkidle' });
  r.ok(await rec.getByLabel('Buscar producto').count() === 1, 'la búsqueda de productos tiene etiqueta');
  const prods = rec.locator('.pos-producto:not([disabled])');
  await prods.first().waitFor({ timeout: T.respuesta });
  for (let i = 0; i < Math.min(3, await prods.count()); i++) await prods.nth(i).click();
  const nombres = rec.locator('.pos-linea-nombre');
  const cortados = await nombres.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  r.ok(await nombres.count() > 0 && cortados === 0, `ticket sin nombres cortados (${await nombres.count()} líneas)`);
  await r.captura(rec, 'mostrador-ticket', { elemento: rec.locator('[data-testid="pos-ticket"]') });
  await rec.locator('[data-testid="pos-ticket"]').getByRole('button', { name: 'Vaciar' }).click();

  // Teléfono: el ticket no desborda.
  const m = await r.como('recepcion', { viewport: { width: 390, height: 844 } });
  await m.goto(`${PANEL}/punto-de-venta`, { waitUntil: 'networkidle' });
  await m.locator('.pos-producto').first().click();
  r.ok(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'punto de venta en el teléfono sin desborde');
});
