// Dirección (auditoría UX 7, frente 3): el Tablero no se vacía al cambiar de
// rango, Personal trae la acción junto a la cuenta en rojo, Módulos corto en
// el teléfono y con insignias para quien consulta, Movimientos un renglón por día.
import { recorrido, cuadros, PANEL, T } from './lib/index.mjs';

await recorrido('direccion', async (r) => {
  // Tablero: al cambiar de rango las cifras siguen ahí (atenuadas), no esqueletos.
  const d = await r.como('duena');
  await d.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await d.locator('.stat').first().waitFor({ timeout: T.respuesta });
  // La respuesta del rango nuevo se frena 1.2 s a propósito, para ver el estado «cargando».
  await d.route('**/api/dashboard?*', async (x) => { await new Promise((listo) => setTimeout(listo, 1200)); await x.continue(); });
  // Se mira en cuanto sale la petición del rango nuevo (antes: 300 ms a ciegas).
  await Promise.all([d.waitForRequest(/\/api\/dashboard\?/, { timeout: T.ui }), d.getByRole('button', { name: /^Hoy$/ }).first().click()]);
  await cuadros(d);
  r.ok(await d.locator('.tablero-cifras[data-cargando]').count() === 1 && await d.locator('.stat').count() >= 4, 'cambiar de rango deja las cifras atenuadas, sin vaciar');
  await d.locator('.tablero-cifras:not([data-cargando])').waitFor({ timeout: T.respuesta });
  r.ok(true, 'y al llegar las nuevas, se ven normales');
  await d.unroute('**/api/dashboard?*');

  // Personal: la cuenta en rojo trae su acción.
  await d.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await d.locator('tbody tr').first().waitFor({ timeout: T.respuesta });
  const rojas = d.locator('tbody tr').filter({ hasText: /Falta la verificación|Aún no entra/ });
  const nRojas = await rojas.count();
  const conAccion = await rojas.filter({ has: d.locator('button:has-text("Activar ahora"), button:has-text("Nueva contraseña"), :text("Activará su verificación al entrar")') }).count();
  r.ok(nRojas === 0 || conAccion === nRojas, `cada cuenta que pide atención dice qué hacer (${conAccion}/${nRojas})`);

  // Módulos para la dueña: insignias, sin interruptores apagados.
  await d.goto(`${PANEL}/modulos`, { waitUntil: 'networkidle' });
  await d.locator('[data-modulo]').first().waitFor({ timeout: T.respuesta });
  r.ok(await d.getByRole('switch').count() === 0, 'la dueña ve el estado, no interruptores deshabilitados');

  // Teléfono.
  const m = await r.como('gerencia', { movil: true, viewport: { width: 375, height: 800 } });
  await m.goto(`${PANEL}/modulos`, { waitUntil: 'networkidle' });
  await m.locator('[data-modulo]').first().waitFor({ timeout: T.respuesta });
  const alto = await m.evaluate(() => document.documentElement.scrollHeight);
  r.ok(alto < 4000, `Módulos en el teléfono mide ${alto}px (antes ~7,000)`);
  await m.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  await m.locator('.table-dias tbody tr').first().waitFor({ timeout: T.respuesta });
  const fila = await m.locator('.table-dias tbody tr').first().evaluate((tr) => ({ alto: tr.getBoundingClientRect().height, boton: tr.querySelector('.row-link')?.getBoundingClientRect().height ?? 0, cortadas: [...tr.children].filter((td) => td.getBoundingClientRect().right > innerWidth - 4).length }));
  r.ok(fila.boton >= 44 && fila.alto < 70 && fila.cortadas === 0, `Movimientos: un renglón de ${Math.round(fila.alto)}px por día, día tocable de ${Math.round(fila.boton)}px`);
  await m.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  r.ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Personal en el teléfono sin desborde');
});
