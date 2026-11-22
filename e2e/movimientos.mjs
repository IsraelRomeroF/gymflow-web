// Movimientos (Dirección): el resumen del periodo, 30 barras, un día con sus
// movimientos, exportar, «Hoy» sin gráfica, el teléfono y que recepción no lo ve.
import { recorrido, abrirMenu, irPorMenu, accion, asentado, PANEL, T } from './lib/index.mjs';

await recorrido('movimientos', async (r) => {
  const p = await r.como('gerencia', { acceptDownloads: true });
  await irPorMenu(p, 'Movimientos');
  await p.getByText('Ganancia en caja del periodo').waitFor({ timeout: T.respuesta });
  r.ok(true, 'el menú lleva a Movimientos con el resumen del periodo');
  await p.getByRole('button', { name: '30 días' }).click();
  await p.locator('.mov-barra').first().waitFor();
  r.ok(await p.locator('.mov-barra').count() === 30, '30 días = 30 barras');
  await r.captura(p, 'mov-30');
  // Elegir un día con dinero desde la tabla.
  const filas = p.locator('table').first().locator('tbody tr');
  const n = await filas.count();
  let elegido = false;
  for (let i = 1; i < n && !elegido; i++) {
    const t = await filas.nth(i).locator('td').nth(1).innerText();
    if (t.trim() !== '$0') { await accion(p, () => filas.nth(i).getByRole('button').click(), '/api/reports/movements', { metodo: 'GET', que: 'los movimientos del día' }); elegido = true; }
  }
  r.ok(elegido, 'hay días anteriores con dinero');
  await p.getByText(/\d+ movimientos/).waitFor({ timeout: T.respuesta });
  r.ok(await p.locator('table').last().locator('tbody tr').count() > 0, 'el día elegido lista sus movimientos');
  const [csv] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exportar' }).click()]);
  r.ok(csv.suggestedFilename().endsWith('.csv'), `exporta ${csv.suggestedFilename()}`);
  await p.getByRole('button', { name: 'Hoy' }).click();
  await p.getByText('Ganancia en caja del día').waitFor();
  await asentado(p);
  r.ok(await p.locator('.mov-chart').count() === 0, 'un solo día no dibuja la gráfica');
  await r.captura(p, 'mov-hoy', { full: true });

  const m = await r.como('gerencia', { viewport: { width: 375, height: 800 } });
  await m.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  await m.getByText('Ganancia en caja del periodo').waitFor({ timeout: T.respuesta });
  r.ok(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'móvil sin desborde');
  await r.captura(m, 'mov-movil', { full: true });

  const rec = await r.como('recepcion');
  await abrirMenu(rec);
  r.ok(await rec.getByRole('link', { name: 'Movimientos' }).count() === 0, 'recepción no ve Movimientos');
});
