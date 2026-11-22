// Clases y crecimiento (auditoría UX 7, frente 2): Altas lista → detalle en el
// teléfono, Rutinas con confirmaciones y aviso de cambios sin guardar, horario
// semanal completo en el teléfono, y seguimiento "Le llamé" en Prospectos y Retención.
// Datos propios (fase 1.17a): el prospecto al que se le llama es de esta
// corrida (antes, el primero de la lista) y al terminar se cierra.
import { recorrido, sedeDe, letras, celular, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('crecimiento', async (r) => {
  const g = await r.api('gerencia');
  const prospecto = await g.post('/prospects', { branchId: (await sedeDe(g, 'CEN')).id, firstName: `Ximena${letras(4).toLowerCase()}`, lastName: 'Crecimiento', phoneE164: `+52${celular()}` });
  // Cerrar tiene su ruta y pide motivo (bloque 2.4); antes era `PATCH { status: 'LOST' }`.
  r.alFinal(() => g.post(`/prospects/${prospecto.id}/close`, { reasonCode: 'OTRO', note: 'Fin del recorrido' }));
  const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  // ── Teléfono ──────────────────────────────────────────────────────────────
  const m = await r.como('gerencia', { movil: true });

  // Altas: lista → detalle con "Volver".
  r.paso('altas en el teléfono');
  await m.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  const bandeja = m.getByTestId('bandeja-altas');
  if (await aparece(bandeja, T.ui)) {
    const items = bandeja.locator('.list-item');
    r.ok(await items.first().isVisible(), 'altas en el teléfono: primero la lista');
    r.ok(!(await m.getByRole('button', { name: /Volver a la bandeja/ }).isVisible()), 'el detalle no se encima a la lista');
    await items.nth(Math.min(1, (await items.count()) - 1)).click();
    await m.getByRole('button', { name: /Volver a la bandeja/ }).waitFor({ timeout: T.ui });
    r.ok(!(await items.first().isVisible()), 'tocar un pendiente abre su detalle');
    await r.captura(m, 'crecimiento-altas-detalle');
    await m.getByRole('button', { name: /Volver a la bandeja/ }).click();
    r.ok(await items.first().isVisible(), '"Volver" regresa a la lista');
  } else r.nota('la base no tiene altas pendientes');

  // Horario semanal: los 7 días, sin desplazarse de lado.
  r.paso('horario en el teléfono');
  // El horario semanal vive en la pestaña «Horario» de Clases (bloque 2.5).
  await m.goto(`${PANEL}/clases?vista=horario`, { waitUntil: 'networkidle' });
  await m.locator('.semana').waitFor({ timeout: T.respuesta });
  const dias = await m.locator('.semana-dia').evaluateAll((els) => els.filter((e) => { const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.right <= window.innerWidth + 1; }).length);
  r.ok(dias === 7, `horario en el teléfono: los 7 días a la vista (${dias})`);
  r.ok(await m.locator('.semana-dia[data-hoy]').count() === 1, 'el día de hoy va marcado');
  r.ok(await sinDesborde(m), 'clases en el teléfono sin desborde');
  await r.captura(m, 'crecimiento-horario-movil', { elemento: m.locator('.semana-card') });

  // ── Escritorio ───────────────────────────────────────────────────────────
  const p = await r.como('gerencia');

  // Rutinas: archivar pide confirmación; quitar un día con ejercicios también; salir con cambios avisa.
  r.paso('rutinas');
  await p.goto(`${PANEL}/rutinas`, { waitUntil: 'networkidle' });
  const enlaceRutina = p.locator('a[href^="/rutinas/"]').filter({ hasNotText: /Nueva/ }).first();
  if (await enlaceRutina.count()) {
    await enlaceRutina.click();
    await p.waitForURL(/\/rutinas\/[0-9a-f-]{36}/);
    await p.getByRole('button', { name: 'Archivar' }).click();
    await p.getByRole('dialog').getByText(/Archivar «/).waitFor();
    r.ok(true, 'archivar rutina pide confirmación');
    await p.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    const quitarDia = p.getByRole('button', { name: 'Quitar día' });
    if (await quitarDia.count()) {
      await quitarDia.click();
      await p.getByRole('dialog').getByText(/¿Quitar «/).waitFor();
      r.ok(true, 'quitar un día con ejercicios pide confirmación');
      await p.getByRole('dialog').getByRole('button', { name: 'Conservarlo' }).click();
    }

    await p.getByLabel('Nombre del día').fill('Pecho y tríceps (prueba)');
    await p.getByTestId('sin-guardar').waitFor();
    r.ok(true, 'el editor dice "Cambios sin guardar"');
    await p.locator('nav a[href="/clases"], aside a[href="/clases"]').first().click();
    r.ok(await aparece(p.getByRole('dialog').getByText('¿Salir sin guardar?'), T.ui), 'salir con cambios pregunta antes');
    r.ok(/\/rutinas\//.test(p.url()), 'no se fue sin preguntar');
    await p.getByRole('dialog').getByRole('button', { name: 'Salir sin guardar' }).click();
    await p.waitForURL('**/clases');
    r.ok(true, '"Salir sin guardar" sí sale');
  } else r.nota('la base no tiene rutinas');

  // Prospectos: "Le llamé" deja el contacto en la fila (en el prospecto de esta corrida).
  r.paso('le llamé a un prospecto');
  await p.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  const filaP = p.locator('tbody tr').filter({ hasText: prospecto.firstName }).first();
  await filaP.waitFor({ timeout: T.respuesta });
  const nombreP = (await filaP.locator('td').first().locator('.strong').first().innerText()).trim();
  // La acción de la fila es «Contactar» (bloque 2.4); en Retención sigue siendo «Le llamé».
  await filaP.getByRole('button', { name: 'Contactar' }).click();
  const d = p.getByRole('dialog');
  r.ok(await d.getByRole('button', { name: 'Registrar contacto' }).isDisabled(), 'sin resultado no se registra');
  await d.getByRole('radio', { name: 'WhatsApp' }).click();
  await d.getByRole('radio', { name: 'Le interesa', exact: true }).click();
  await d.getByLabel('Nota (opcional)').fill('Viene el lunes a probar');
  await d.getByRole('button', { name: 'Mañana' }).click();
  await r.captura(p, 'crecimiento-le-llame');
  await d.getByRole('button', { name: 'Registrar contacto' }).click();
  await d.waitFor({ state: 'hidden' });
  const filaDespues = p.locator('tbody tr').filter({ hasText: nombreP }).first();
  await filaDespues.getByTestId('ultimo-contacto').waitFor({ timeout: T.respuesta });
  // El próximo paso ya no va en la línea del contacto: tiene su columna («Cuándo toca»).
  const linea = `${await filaDespues.getByTestId('ultimo-contacto').innerText()} · ${(await filaDespues.locator('td').nth(2).innerText()).trim()}`;
  r.ok(/WhatsApp/.test(linea) && /Le interesa/.test(linea) && /Próximo/.test(linea), `la fila dice el contacto y el próximo paso: "${linea.replace(/\n/g, ' ')}"`);

  // Retención: tras "Le llamé", baja a "Ya contactados".
  r.paso('retención');
  await p.goto(`${PANEL}/retencion`, { waitUntil: 'networkidle' });
  const porLlamar = p.getByTestId('por-llamar');
  await porLlamar.waitFor({ timeout: T.respuesta }).catch(() => undefined);
  if (await porLlamar.count() && await porLlamar.getByRole('button', { name: 'Le llamé' }).count()) {
    const filaR = porLlamar.locator('.list-item').filter({ has: p.getByRole('button', { name: 'Le llamé' }) }).first();
    const nombreR = (await filaR.locator('a.strong').innerText()).trim();
    await filaR.getByRole('button', { name: 'Le llamé' }).click();
    await p.getByRole('dialog').getByRole('radio', { name: 'Va a regresar', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Registrar contacto' }).click();
    await p.getByTestId('ya-contactados').waitFor({ timeout: T.respuesta });
    r.ok(await porLlamar.getByText(nombreR, { exact: true }).count() === 0, `"${nombreR}" deja la lista de por llamar`);
    r.ok(await p.getByTestId('ya-contactados').getByText(nombreR, { exact: true }).count() === 1, 'y aparece en "Ya contactados"');
  } else r.nota('nadie en riesgo en la base');
});
