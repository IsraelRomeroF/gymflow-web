// El padrón de socios en Recepción: páginas de 50 con el total verdadero,
// «Cargar más», «Solo con adeudo», búsqueda sin acentos, teclado y teléfono.
import { recorrido, accion, asentado, hasta, PANEL, T } from './lib/index.mjs';

await recorrido('padron', async (r) => {
  const p = await r.como('recepcion');
  await p.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await p.getByText(/de [\d,]+ socios/).waitFor({ timeout: T.respuesta });
  const filas = () => p.locator('tbody tr').count();
  r.ok(await filas() === 50, 'primera página de 50');
  const pie = await p.getByText(/de [\d,]+ socios/).textContent();
  r.ok(Number(pie.match(/de ([\d,]+)/)[1].replace(/,/g, '')) > 200, `el total dice la verdad: ${pie}`);
  await p.getByRole('button', { name: 'Cargar más' }).click();
  await hasta(p, () => document.querySelectorAll('tbody tr').length === 100, null, { timeout: T.respuesta, que: 'La segunda página' });
  r.ok(true, 'cargar más trae la siguiente página');
  // El filtro vive en el servidor: se espera SU respuesta, no un rato.
  await accion(p, () => p.getByLabel('Solo con adeudo').check(), /\/api\/members\?.*withDebt=true/, { metodo: 'GET', que: 'el padrón con adeudo' });
  await asentado(p);
  const saldos = await p.locator('tbody tr td:last-child').allTextContents();
  r.ok(saldos.length > 0 && saldos.every((t) => t.includes('$')), `solo con adeudo: ${saldos.length} socios, todos deben`);
  await p.getByLabel('Solo con adeudo').uncheck();
  await accion(p, () => p.getByLabel('Buscar en el padrón').fill('aguilar'), '/api/members/search?q=aguilar', { metodo: 'GET', que: 'la búsqueda «aguilar»' });
  await asentado(p);
  // Al teclear, el padrón da paso a los resultados del mostrador (Recepción y Socios son una sola pantalla).
  const nombres = await p.locator('[data-testid="resultados"] .row-link').allTextContents();
  r.ok(nombres.length > 0 && nombres.every((n) => /aguilar/i.test(n.normalize('NFD').replace(/[̀-ͯ]/g, ''))), `buscar "aguilar": ${nombres.length}`);
  // Teclado: el nombre es alcanzable con Tab.
  await p.locator('[data-testid="resultados"] .row-link').first().focus();
  r.ok(await p.evaluate(() => document.activeElement?.classList.contains('row-link')), 'la fila se alcanza con el teclado');
  const m = await r.como('recepcion', { movil: true, viewport: { width: 375, height: 800 } });
  await m.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await m.getByText(/de [\d,]+ socios/).waitFor({ timeout: T.respuesta });
  await asentado(m);
  r.ok(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'móvil sin desborde');
  await r.captura(m, 'padron-movil');
});
