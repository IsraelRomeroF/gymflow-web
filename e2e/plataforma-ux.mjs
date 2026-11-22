// Plataforma (auditoría UX 7, frente 4): bandeja "Requiere atención", tabla de
// Marcas a 1024 px, Precios en un solo formulario y diálogos que dicen qué falta.
// La reconfirmación vencida se provoca en gymflow_pruebas (lib/base.mjs: la
// sesión de la plataforma deja de estar reconfirmada); antes solo corría si
// regresion.sh pasaba PGURL a consulta.cjs (que ya no existe).
import { recorrido, sql, cuadros, aparece, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('plataforma-ux', async (r) => {
  const p = await r.como('plataforma', { viewport: { width: 1024, height: 768 } });

  // Bandeja arriba de Marcas, cada renglón con su acción.
  const bandeja = p.getByTestId('bandeja-plataforma');
  await bandeja.waitFor({ timeout: T.respuesta });
  const renglones = bandeja.locator('[data-aviso]');
  const n = await renglones.count();
  r.ok(n === 0 || await renglones.locator('a.btn').count() === n, `la bandeja trae ${n} pendientes, cada uno con su acción`);
  await r.captura(p, 'plataforma-ux-bandeja');

  // Tabla de Marcas a 1024 px: nada escondido de lado.
  const tabla = p.locator('.table-wrap').last();
  r.ok(await tabla.evaluate((t) => t.scrollWidth <= t.clientWidth + 2), 'la tabla de Marcas cabe a 1024 px');

  // Precios: un solo botón; un importe mal escrito se marca en su campo.
  await p.goto(`${PANEL}/plataforma/precios`, { waitUntil: 'networkidle' });
  await p.locator('[data-precio]').first().waitFor({ timeout: T.respuesta });
  r.ok(await p.getByRole('button', { name: 'Guardar', exact: true }).count() === 0, 'ya no hay un "Guardar" por fila');
  const campos = p.locator('[data-precio] input');
  await campos.nth(0).fill('abc');
  r.ok(await p.getByText('Escribe pesos, por ejemplo 1500 o 1500.50').count() === 1, 'el importe inválido se dice en su campo');
  r.ok(await p.getByRole('button', { name: /Guardar (\d+ )?precios/ }).isDisabled(), 'con un importe inválido no se guarda');
  await campos.nth(0).fill('');
  await p.getByTestId('precios-pendientes').waitFor();

  // Ficha: "Suspender"/"Liberar" con el motivo vacío dice qué falta.
  await p.goto(`${PANEL}/plataforma`, { waitUntil: 'networkidle' });
  await p.locator('tbody tr a.strong').first().click();
  await p.waitForURL(/\/plataforma\/[0-9a-f-]{36}/);
  await p.locator('[data-contrato]').first().waitFor({ timeout: T.respuesta });
  const accion = p.getByRole('button', { name: /^(Suspender|Liberar|Reanudar)/ }).first();
  if (await accion.count()) {
    await accion.click();
    const d = p.getByRole('dialog');
    await d.waitFor();
    await d.getByRole('button', { name: /^(Suspender|Liberar|Reanudar)/ }).last().click();
    r.ok(await aparece(d.locator('.field-error'), T.ui), 'sin motivo, el diálogo dice qué falta (no un botón gris)');
    await cuadros(p);
    r.ok(await p.evaluate(() => !!document.activeElement?.closest('[data-error="true"]')), 'y el foco va al motivo');
    await d.getByRole('button', { name: 'Volver' }).click();
  }
  r.ok(await p.locator('[data-contrato] .tiny.muted').count() > 0, 'cada módulo dice qué es, sin depender del cursor');

  // Seguridad: la política, tus sesiones y lo que hizo la plataforma.
  await p.goto(`${PANEL}/plataforma/seguridad`, { waitUntil: 'networkidle' });
  await p.getByTestId('politica').waitFor({ timeout: T.respuesta });
  r.ok(await p.getByTestId('politica').getByText('Toda acción que modifica pide tu contraseña').count() === 1, 'Seguridad dice que cada cambio se reconfirma con la contraseña');
  r.ok(await p.getByTestId('sesiones').getByText('Esta sesión').count() === 1, 'y muestra esta sesión');
  // La actividad se lee aparte, de la cadena de plataforma (bloque 1.13): se espera a que llegue.
  await p.getByTestId('actividad').locator('tbody tr').first().or(p.getByTestId('actividad').getByText('Todavía nada')).waitFor({ timeout: T.respuesta });
  r.ok(await p.getByTestId('actividad').locator('tbody tr').count() > 0 || await p.getByTestId('actividad').getByText('Todavía nada').count() === 1, 'y lo que hizo la plataforma en las marcas (o que aún no hay nada)');
  await r.captura(p, 'plataforma-ux-seguridad', { full: true });

  // Reconfirmación vencida: la acción abre el diálogo de la contraseña y, al confirmar, se completa.
  await sql(`update sessions set "stepUpUntil" = now() - interval '1 minute' where "userId" in (select id from users where email = 'plataforma@gymflow.mx')`);
  await p.goto(`${PANEL}/plataforma/precios`, { waitUntil: 'networkidle' });
  const campo = p.locator('[data-precio="core"] input');
  await campo.waitFor({ timeout: T.respuesta });
  // Un precio distinto del que ya tiene (el campo lo muestra de fondo): con el
  // mismo no hay nada que guardar y el botón se queda apagado. Antes ponía
  // siempre 1499 y la segunda corrida se quedaba esperando ese botón.
  const actual = Number((await campo.getAttribute('placeholder') ?? '').replace(/[^\d.]/g, ''));
  await campo.fill(actual === 1499 ? '1500' : '1499');
  await p.getByRole('button', { name: /Guardar (\d+ )?precios/ }).click();
  const dlg = p.getByRole('dialog').filter({ hasText: 'Confirma que eres tú' });
  r.ok(await aparece(dlg, T.ui), 'con la reconfirmación vencida, cambiar un precio pide la contraseña');
  await dlg.getByLabel('Tu contraseña').fill(CLAVE_PRUEBAS);
  await dlg.getByRole('button', { name: 'Confirmar' }).click();
  r.ok(await aparece(p.getByText(/precio guardado|precios guardados/), T.respuesta), 'tras confirmar, el cambio se guarda solo');
});
