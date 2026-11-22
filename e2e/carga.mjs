// Pantallas que no mienten (auditoría 8, fase 0.10: 26-01, 13-18, 14-20). Si una
// consulta falla, la pantalla lo dice con «Reintentar»: no se lee como «sin
// datos» ni deja a la vista las cifras de antes. El fallo se provoca solo para
// esa consulta (page.route), sin apagar nada, y luego se reintenta.
// Fase 1.17a: el socio de la ficha es de esta corrida.
import { recorrido, socioAlCorriente, accion, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('carga', async (r) => {
  const socio = await socioAlCorriente(await r.api('gerencia'));
  const p = await r.como('gerencia');
  const tirar = (ruta) => p.route((u) => u.pathname === ruta || u.pathname.startsWith(`${ruta}/`), (x) => x.abort('failed'));
  const visible = (loc) => aparece(loc, T.respuesta);

  // 1. Tablero: al cambiar de rango con la red caída no quedan las cifras del anterior (13-18).
  r.paso('tablero');
  await p.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await p.locator('.stat-label', { hasText: 'Utilidad' }).waitFor({ timeout: T.respuesta });
  await tirar('/api/dashboard');
  await p.getByRole('button', { name: 'Mes pasado' }).click();
  r.ok(await visible(p.getByText('No se pudo cargar el tablero')), 'el tablero dice «No se pudo cargar el tablero»');
  r.ok(await p.locator('.stat-label', { hasText: 'Utilidad' }).count() === 0, 'y no deja a la vista las cifras del mes anterior');
  await r.captura(p, 'carga-1-tablero-error');
  await p.unrouteAll({ behavior: 'wait' });
  await p.getByRole('button', { name: 'Reintentar' }).first().click();
  r.ok(await visible(p.locator('.stat-label', { hasText: 'Utilidad' })), '«Reintentar» trae las cifras del mes pasado');

  // 2. Movimientos: un fallo del día no se lee «Ese día no entró ni salió dinero» (14-20).
  r.paso('movimientos');
  await p.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  await p.getByText('Gastos fijos', { exact: true }).waitFor({ timeout: T.respuesta });
  await tirar('/api/reports/movements');
  await p.getByRole('button', { name: 'Ayer', exact: true }).click();
  r.ok(await visible(p.getByText('No se pudieron cargar los movimientos del día')), 'Movimientos dice que no pudo cargar los del día');
  r.ok(await p.getByText('Ese día no entró ni salió dinero.').count() === 0, 'y no que ese día no hubo dinero');
  await p.unrouteAll({ behavior: 'wait' });
  await accion(p, () => p.getByRole('button', { name: 'Reintentar' }).first().click(), '/api/reports/movements', { metodo: 'GET', que: 'los movimientos del día' });
  await p.getByText('No se pudieron cargar los movimientos del día').waitFor({ state: 'detached', timeout: T.ui }).catch(() => undefined);
  r.ok(await p.getByText('No se pudieron cargar los movimientos del día').count() === 0, '«Reintentar» los vuelve a pedir');

  // 3. Ficha: si no llegan sus membresías, no dice «Sin membresía» ni ofrece vender otra (26-01, sitio 8).
  r.paso('ficha');
  await tirar(`/api/members/${socio.id}/memberships`);
  await p.goto(`${PANEL}/socios/${socio.id}`, { waitUntil: 'networkidle' });
  r.ok(await visible(p.getByText('No se pudo cargar su membresía')), `la ficha de ${socio.firstName} dice que no pudo cargar su membresía`);
  r.ok(await p.getByRole('button', { name: 'Vender membresía' }).count() === 0 && await p.getByText('No tiene membresía').count() === 0, 'sin ofrecer «Vender membresía» ni decir que no tiene');
  await r.captura(p, 'carga-2-ficha-error');
  await p.unrouteAll({ behavior: 'wait' });
  await p.getByRole('button', { name: 'Reintentar' }).first().click();
  await p.getByText('No se pudo cargar su membresía').waitFor({ state: 'detached', timeout: T.respuesta }).catch(() => undefined);
  const cifra = (await p.locator('.stat').filter({ hasText: /Vigente hasta|Pagado hasta/ }).locator('.stat-value').innerText().catch(() => '—')).trim();
  r.ok(cifra !== '—' && cifra !== '', `«Reintentar» trae su membresía (${cifra})`);
}, { erroresDePagina: 'falla' });
