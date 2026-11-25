// Los avisos a la dueña (fase 4, bloque 4.2 · D-05), vistos en el navegador:
//
//  1. Un corte con faltante de más de $20 queda por revisar; el corredor de 15
//     minutos (`pnpm jobs:pruebas:15min`, el mismo que corre solo) lo convierte
//     en el aviso «Corte con diferencia». Se corre una vez ANTES del corte (la
//     primera corrida de un gimnasio solo fija desde cuándo avisa) y otra después.
//  2. La dueña: «Mis avisos» en su menú con el número de nuevos; la tarjeta
//     «Tus avisos» del Inicio; en «Mis avisos» el aviso con quién abrió el turno
//     (eso no viaja al teléfono) y el número del menú se apaga.
//  3. Apaga «Corte con diferencia» y queda apagado.
//  4. El gerente no tiene «Mis avisos»; tecleando /avisos, «es para la Dueña».
//
// Turno PROPIO en «Caja 2 Centro», abierto y cortado por la API con un faltante
// de importe único por corrida; al terminar se revisa (no se queda «por
// revisar») y el aviso vuelve a encenderse, pase lo que pase.
import { execFileSync } from 'node:child_process';
import { recorrido, sedeDe, accion, aparece, abrirMenu, PANEL, T } from './lib/index.mjs';

const corredor = () => execFileSync('pnpm', ['-s', 'jobs:pruebas:15min'], { cwd: `${process.env.HOME}/gymflow-backend`, encoding: 'utf8', timeout: 120_000 });

await recorrido('avisos-duena', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const own = await r.api('duena');
  const cen = await sedeDe(g, 'CEN');
  const caja = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers.find((c) => c.code === 'C2' && c.isActive);
  if (!caja) throw new Error('No hay «Caja 2» en Centro: la siembra cambió');
  const cortar = async () => {
    for (const s of (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions.filter((x) => x.cashRegisterId === caja.id)) {
      const { expectedCashCents } = await g.get(`/cash-sessions/${s.id}`);
      await g.post(`/cash-sessions/${s.id}/close`, { countedCashCents: expectedCashCents });
    }
  };
  let turnoId = null;
  r.alFinal(async () => {
    await own.put('/owner-alerts/preferences', { kind: 'CASH_VARIANCE', enabled: true });
    await cortar();
    if (turnoId) {
      const { session } = await g.get(`/cash-sessions/${turnoId}`);
      if (session.varianceStatus === 'PENDING') await g.post(`/cash-sessions/${turnoId}/variance/review`, { note: 'Fin del recorrido de prueba' });
    }
  });
  await cortar();
  await own.put('/owner-alerts/preferences', { kind: 'CASH_VARIANCE', enabled: true });

  // ── 1. El corte con faltante y el corredor ────────────────────────────────
  r.paso('corte con faltante y corredor');
  const salida1 = corredor();
  r.ok(/corredor de 15 minutos OK/.test(salida1), 'el corredor de 15 minutos corre (fija desde cuándo se avisa, si es la primera vez)');
  // Un faltante distinto en cada corrida ($41.00 a $69.99): así se encuentra SU aviso entre los de otras corridas.
  const faltante = 4100 + Math.floor(Math.random() * 2899);
  const enPesos = `$${(faltante / 100).toFixed(2)}`;
  const turno = await rcp.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '100000', shiftLabel: 'EVENING' });
  turnoId = turno.id;
  await rcp.post(`/cash-sessions/${turno.id}/close`, { countedCashCents: String(100000 - faltante), varianceReason: 'Recorrido de avisos: faltó cambio' });
  const { session } = await g.get(`/cash-sessions/${turno.id}`);
  r.ok(session.varianceStatus === 'PENDING', `recepción cortó con ${enPesos} de faltante: queda por revisar`);
  const salida2 = corredor();
  r.ok(/corredor de 15 minutos OK/.test(salida2), 'el corredor corre otra vez');
  const avisos = await own.get('/owner-alerts');
  const suyo = avisos.alerts.find((a) => a.kind === 'CASH_VARIANCE' && a.body.includes(enPesos));
  r.ok(!!suyo && !suyo.seen, `la API ya tiene el aviso: «${suyo?.title}. ${suyo?.body}»`);
  r.ok(!!suyo && !suyo.body.includes('Paola'), 'lo que viaja al teléfono no dice quién (dónde y cuánto, nada más)');

  // ── 2. La dueña ───────────────────────────────────────────────────────────
  r.paso('la dueña');
  const duena = await r.como('duena');
  const tarjeta = duena.getByTestId('avisos-duena');
  await tarjeta.waitFor({ timeout: T.respuesta });
  const enTarjeta = tarjeta.locator('[data-aviso="CASH_VARIANCE"]').filter({ hasText: enPesos });
  r.ok(await aparece(enTarjeta, T.respuesta) || Number(await tarjeta.getAttribute('data-nuevos')) > 3, `la tarjeta «Tus avisos» del Inicio trae el aviso nuevo («${(await enTarjeta.innerText().catch(() => '')).trim().slice(0, 140)}»)`);
  await abrirMenu(duena);
  const enlace = duena.getByRole('link', { name: /^Mis avisos/ });
  r.ok(await enlace.count() === 1, 'su menú trae «Mis avisos»');
  const numero = async () => Number(((await enlace.innerText()).match(/\d+/) ?? ['0'])[0]);
  r.ok(await numero() >= 1, `con el número de nuevos (${await numero()})`);
  await r.captura(duena, 'avisos-duena-1-inicio');
  const vistos = accion(duena, () => enlace.click(), '/api/owner-alerts/seen', { metodo: 'POST', que: 'marcar vistos' });
  await vistos;
  await duena.waitForURL('**/avisos', { timeout: T.navegacion });
  const lista = duena.getByTestId('lista-de-avisos');
  const fila = lista.locator('[data-aviso="CASH_VARIANCE"]').filter({ hasText: enPesos });
  await fila.waitFor({ timeout: T.respuesta });
  const texto = (await fila.innerText()).replace(/\s+/g, ' ');
  r.ok(/Paola Núñez/.test(texto), `en «Mis avisos» trae el detalle que no viaja al teléfono: «${texto.slice(0, 220)}»`);
  r.ok(/No sonó en ningún teléfono: quedó aquí\.|Sonó en/.test(texto), 'y dice si sonó en algún teléfono');
  r.ok(await aparece(enlace.filter({ hasNotText: /\d/ }), T.ui), 'al abrir la pantalla, el número del menú se apaga');
  await r.captura(duena, 'avisos-duena-2-mis-avisos', { full: true });

  // ── 3. Apagar un tipo ─────────────────────────────────────────────────────
  r.paso('apagar un tipo');
  const pref = duena.getByTestId('preferencias-avisos').locator('[data-preferencia="CASH_VARIANCE"]');
  const sw = pref.getByRole('switch');
  r.ok(await sw.isChecked(), '«Corte con diferencia» está encendido');
  const put = await accion(duena, () => sw.click(), '/api/owner-alerts/preferences', { metodo: 'PUT', que: 'apagar el aviso' });
  r.ok(put.ok() && !(await sw.isChecked()), `se apaga (${put.status()})`);
  const prefs = (await own.get('/owner-alerts')).preferences;
  r.ok(prefs.find((x) => x.kind === 'CASH_VARIANCE')?.enabled === false, 'y la API lo guarda apagado');
  await duena.reload({ waitUntil: 'networkidle' });
  r.ok(!(await duena.getByTestId('preferencias-avisos').locator('[data-preferencia="CASH_VARIANCE"]').getByRole('switch').isChecked()), 'al recargar sigue apagado');
  r.ok(await aparece(duena.getByTestId('lista-de-avisos').locator('[data-aviso="CASH_VARIANCE"]').filter({ hasText: enPesos }), T.respuesta), 'apagado solo calla el teléfono: el aviso sigue en la lista');

  // ── 4. El gerente ─────────────────────────────────────────────────────────
  r.paso('el gerente');
  const ger = await r.como('gerente');
  await abrirMenu(ger);
  r.ok(await ger.getByRole('link', { name: /^Mis avisos/ }).count() === 0, 'el gerente no tiene «Mis avisos» en su menú');
  await ger.goto(`${PANEL}/avisos`, { waitUntil: 'networkidle' });
  const fuera = ger.getByText('Tu rol no ve esta pantalla').or(ger.getByText('Esta pantalla es para la Dueña o el Dueño'));
  r.ok(await aparece(fuera.first(), T.respuesta), `y tecleando /avisos: «${(await fuera.first().innerText().catch(() => '')).trim()}»`);
  r.ok(await ger.getByTestId('lista-de-avisos').count() === 0, 'sin ningún aviso a la vista');
}, { erroresDePagina: 'informa' });
