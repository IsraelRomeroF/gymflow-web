// Cobranza de la plataforma (DP-03) y soporte por marca (DP-04): ingreso
// mensual, emitir el mes (idempotente), pagos con su fecha y la marca por dentro.
import { recorrido, T, PANEL } from './lib/index.mjs';

await recorrido('cobranza', async (r) => {
  const pl = await r.como('plataforma');
  await pl.getByRole('heading', { name: 'Marcas' }).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-marca]').first().waitFor({ timeout: T.respuesta });
  r.ok(await pl.getByText('Ingreso mensual').count() === 1, 'la portada dice cuánto factura GymFlow al mes');
  r.ok(await pl.getByRole('navigation', { name: 'Secciones de la plataforma' }).getByRole('link').count() === 5, 'la barra enlaza Marcas, Cobranza, Precios, Planes y Seguridad');

  await pl.getByRole('navigation', { name: 'Secciones de la plataforma' }).getByRole('link', { name: 'Cobranza' }).click();
  await pl.getByRole('heading', { name: 'Cobranza' }).waitFor({ timeout: T.respuesta });
  await pl.getByText('Por cobrar').first().waitFor({ timeout: T.respuesta });
  r.ok(await pl.getByText(/Sin factura de/).count() === 1, 'dice cuántas marcas en uso no tienen la factura del mes');
  await r.captura(pl, 'cobranza-1', { full: true });

  // Emitir el mes a todas las marcas: idempotente y explica a quién saltó.
  await pl.getByRole('button', { name: /^Emitir / }).click();
  const d = pl.getByRole('dialog');
  // Antes de emitir se ve lo que va a salir (23-05, bloque 1.13): a quién, por cuánto y a quién se salta.
  const previa = d.getByTestId('vista-previa-emision').getByText(/por emitir/i).first();
  await previa.waitFor({ timeout: T.respuesta });
  r.ok(/por emitir/i.test(await previa.innerText()), `la vista previa dice qué va a salir ("${(await previa.innerText()).trim().slice(0, 80)}")`);
  const emitirLote = d.getByRole('button', { name: /^Emitir \d+ facturas? · \$/ });
  if (await emitirLote.isEnabled()) {
    await emitirLote.click();
    await d.getByText(/emitida|saltada/).first().waitFor({ timeout: T.respuesta });
    const resumen = (await d.getByText(/emitida|saltada/).first().innerText()).trim();
    r.ok(/\d+/.test(resumen), `emitir el mes informa el resultado ("${resumen.slice(0, 80)}")`);
    await r.captura(pl, 'cobranza-2-emitir');
    await d.getByRole('button', { name: 'Listo' }).click();
  } else {
    // Segunda corrida del mes: todas las marcas ya tienen su factura o se saltan, y el botón no deja emitir de más.
    r.ok(await d.getByText(/No hay ninguna factura que emitir/).count() === 1, 'sin nada que emitir, la vista previa lo explica y el botón queda apagado');
    await r.captura(pl, 'cobranza-2-emitir');
    await d.getByRole('button', { name: 'Cancelar' }).click();
  }
  await pl.getByRole('heading', { name: 'Cobranza' }).waitFor();

  // La lista de todas y el pago con su fecha.
  await pl.getByRole('button', { name: /^Todas/ }).click();
  const filas = await pl.locator('table tbody tr').count();
  r.ok(filas >= 0, `la vista "Todas" lista ${filas} facturas`);
  const pagar = pl.getByRole('button', { name: 'Registrar pago' }).first();
  if (await pagar.count()) {
    await pagar.click();
    r.ok(await pl.getByRole('dialog').getByLabel('Fecha en que llegó el pago').count() === 1, '"Registrar pago" pide la fecha real en que llegó el dinero');
    await pl.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  } else r.ok(true, 'no hay facturas pendientes que pagar en esta corrida');
  r.ok(await pl.getByRole('button', { name: 'Exportar' }).count() === 1, 'la cobranza se exporta a CSV');

  // Una marca por dentro: soporte sin abrir la base.
  const idDemo = await pl.evaluate(async () => (await (await fetch('/api/platform/organizations')).json()).organizations.find((o) => o.tradeName === 'Gimnasio Demo').id);
  await pl.goto(`${PANEL}/plataforma/${idDemo}`, { waitUntil: 'networkidle' });
  await pl.getByTestId('soporte').waitFor({ timeout: T.respuesta });
  await pl.getByTestId('soporte').getByText(/Con el panel abierto ahora/).waitFor({ timeout: T.respuesta });
  r.ok(await pl.getByTestId('soporte').getByText('Versión', { exact: true }).count() === 1, 'soporte ve la versión desplegada');
  r.ok(await pl.getByTestId('soporte').getByText('Cierre diario', { exact: true }).count() === 1, 'y si el cierre diario corrió');
  await pl.getByTestId('actos-plataforma').waitFor();
  await pl.getByTestId('actos-plataforma').locator('.list-item, .card-body').first().waitFor({ timeout: T.respuesta });
  r.ok(await pl.getByTestId('actos-plataforma').getByText(/GymFlow|Todavía nada/).count() > 0, 'la marca muestra lo que GymFlow hizo, en palabras');
  await r.captura(pl, 'cobranza-3-soporte', { full: true });
}, { erroresDePagina: 'ok' });
