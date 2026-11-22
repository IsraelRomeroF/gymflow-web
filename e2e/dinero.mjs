// Lo que la ficha dice del dinero (auditoría 8, fase 0.6: 3-01, 4-14, 4-06,
// 4-08, 4-09). El día de corte no dice «Al corriente»: dice que le toca pagar,
// y la cifra es «Pagado hasta»; con la cuota abierta, «Renovar» se vuelve
// «Cobrar $X» y «Cambiar de plan» pide cobrar primero; «Decidir adeudo» solo
// aparece con meses atrasados; y el abono que no alcanza lo dice antes de
// cobrar. Solo mira: cierra cada diálogo sin cobrar nada.
//
// Datos propios (fase 1.17a): un socio en su día de corte, una suspendida con
// el periodo en curso y una con meses atrasados, de esta corrida
// (lib/datos.mjs). Antes buscaba los de la semilla y, si `adeudo` ya había
// resuelto las suspendidas con meses atrasados, fallaba hasta regenerar la base.
import { recorrido, socioEnDiaDeCorte, socioSuspendido, asentado, aparece, hasta, PANEL, T } from './lib/index.mjs';

await recorrido('dinero', async (r) => {
  const g = await r.api('gerencia');
  const corte = await socioEnDiaDeCorte(g);
  const enCurso = await socioSuspendido(g, { mesesAtras: 0 });
  const atrasado = await socioSuspendido(g, { mesesAtras: 3 });
  r.nota(`socios de esta corrida: ${corte?.memberCode ?? '(hoy no hay día de corte limpio)'} en su corte, ${enCurso.memberCode} suspendida en curso, ${atrasado.memberCode} con meses atrasados`);

  const p = await r.como('gerencia');
  const abrir = async (s) => {
    await p.goto(`${PANEL}/socios/${s.id}`, { waitUntil: 'networkidle' });
    await p.locator('.stat').first().waitFor({ timeout: T.respuesta });
    await p.getByRole('button', { name: /^Cobrar \$/ }).first().waitFor({ timeout: T.respuesta });
    await asentado(p);
  };

  // 1. El día de corte (4-14, 3-01, 4-06).
  r.paso('día de corte');
  if (!corte) r.nota('hoy es día 29, 30 o 31: el mes pasado no siempre tiene ese día y no se arma un día de corte limpio');
  else {
    await abrir(corte);
    const insignia = (await p.locator('.profile .badge').first().innerText()).trim();
    r.ok(/Hoy le toca pagar|Por pagar|Pago atrasado/.test(insignia) && !/Al corriente/.test(insignia), `con la cuota abierta, la cabecera no dice «Al corriente»: «${insignia}» (${corte.memberCode})`);
    const cifra = p.locator('.stat').filter({ hasText: /Pagado hasta|Vigente hasta/ });
    r.ok(/Pagado hasta/.test(await cifra.innerText()) && /su periodo va al/.test(await cifra.innerText()), 'la cifra es «Pagado hasta» y dice hasta dónde va su periodo');
    r.ok(await p.getByRole('button', { name: 'Renovar', exact: true }).count() === 0, 'la tarjeta ya no ofrece «Renovar» encima de la cuota abierta');
    r.ok(await p.getByRole('button', { name: /^Cobrar \$/ }).count() >= 2, 'en su lugar dice «Cobrar $X» (cabecera y tarjeta)');
    await r.captura(p, 'dinero-1-dia-de-corte');
    await p.getByRole('button', { name: 'Cambiar de plan' }).click();
    const cambio = p.getByRole('dialog', { name: /^Cambiar el plan de/ });
    await cambio.waitFor({ timeout: T.ui });
    await asentado(p);
    r.ok(await cambio.getByText(/^Primero se cobran \$/).count() === 1, '«Cambiar de plan» pide cobrar primero la cuota abierta');
    r.ok(await cambio.getByRole('button', { name: /^Cambiar (y cobrar|de plan)$/ }).isDisabled(), 'y no deja cambiar mientras tanto');
    await cambio.getByRole('button', { name: 'Cancelar' }).click();
  }

  // 2. «Decidir adeudo» solo con meses atrasados (4-08).
  r.paso('decidir adeudo');
  await abrir(enCurso);
  r.ok(await p.getByRole('button', { name: 'Decidir adeudo' }).count() === 0, `suspendida con el periodo en curso: sin «Decidir adeudo», solo cobrar (${enCurso.memberCode})`);
  await abrir(atrasado);
  r.ok(await p.getByRole('button', { name: 'Decidir adeudo' }).count() === 1, `suspendida con meses atrasados: «Decidir adeudo» (${atrasado.memberCode})`);
  r.ok(/Pagado hasta/.test(await p.locator('.stat').filter({ hasText: /Pagado hasta|Vigente hasta/ }).innerText()), 'y su cifra dice hasta dónde pagó');

  // 3. El abono que no alcanza lo dice antes de cobrar (4-09).
  r.paso('abono que no alcanza');
  await abrir(enCurso);
  await p.getByRole('button', { name: /^Cobrar \$/ }).first().click();
  const cobro = p.getByRole('dialog', { name: /^Cobrar a / });
  await cobro.waitFor({ timeout: T.ui });
  const monto = cobro.locator('#monto');
  await hasta(p, () => Number(document.querySelector('#monto')?.value) > 0, null, { timeout: T.respuesta, que: 'El importe a cobrar' });
  const todo = await monto.inputValue();
  await monto.fill('1');
  r.ok(await aparece(cobro.getByText('Con ese abono sigue sin poder entrar')), 'un abono de $1: «Con ese abono sigue sin poder entrar»');
  r.ok(/Para volver a entrar hoy necesita \$/.test(await cobro.innerText()), 'y dice cuánto necesita para volver a entrar hoy');
  await r.captura(p, 'dinero-2-abono-corto');
  await monto.fill(todo);
  r.ok(await aparece(cobro.getByText('Con este cobro queda al corriente y puede entrar.')), `con lo que debe ($${todo}): «queda al corriente y puede entrar»`);
  await cobro.getByRole('button', { name: 'Cancelar' }).click();

  // 4. Corregir un cargo (fase 2.2: «Ajustar» y «Anular» son un solo diálogo): nombra el cargo con sus fechas y lo pendiente (fase 0.10).
  r.paso('corregir un cargo');
  const conCuota = corte ?? enCurso;
  await p.goto(`${PANEL}/socios/${conCuota.id}?tab=cuenta`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Corregir', exact: true }).first().click();
  const ajuste = p.getByRole('dialog', { name: /^Corregir «/ });
  r.ok(await aparece(ajuste), `«Corregir» nombra el cargo: «${(await ajuste.getByRole('heading').first().innerText().catch(() => '')).trim()}»`);
  r.ok(/Pendiente \$[\d,.]+ de \$[\d,.]+/.test(await ajuste.innerText().catch(() => '')), 'y dice cuánto queda pendiente de cuánto');
  r.ok(!/\d{4}-\d{2}-\d{2}/.test(await ajuste.getByRole('heading').first().innerText().catch(() => '')), 'sin fechas ISO en el título');
  await ajuste.locator('.dialog-foot').getByRole('button', { name: 'Cancelar' }).click();

  // 5. Estado de cuenta (fase 2.2: una sola lista «Movimientos»): las acciones de cada renglón quedan dentro de su tarjeta
  // (la meta de 0.10, «botones dentro de su tarjeta»), en pantallas de escritorio comunes.
  r.paso('acciones dentro de la tarjeta Movimientos');
  for (const width of [1280, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    await p.goto(`${PANEL}/socios/${conCuota.id}?tab=cuenta`, { waitUntil: 'networkidle' });
    await p.locator('[data-testid="cuenta-movimientos"] li').first().waitFor({ timeout: T.respuesta });
    await asentado(p);
    const fuera = await p.evaluate(() => {
      const card = document.querySelector('[data-testid="cuenta-movimientos"]');
      const rc = card.getBoundingClientRect();
      return [...card.querySelectorAll('button, a.btn')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.right > rc.right + 1; })
        .map((b) => `${b.textContent.trim()} ${Math.round(b.getBoundingClientRect().right - rc.right)} px fuera`);
    });
    if (fuera.length) await r.captura(p, `dinero-3-cargos-${width}`);
    r.ok(fuera.length === 0, `a ${width} px, «Corregir», «Devolver» y el comprobante de cada renglón quedan dentro de la tarjeta «Movimientos»${fuera.length ? ` (DEFECTO: ${[...new Set(fuera)].join(', ')})` : ''}`);
  }
}, { erroresDePagina: 'falla' });
