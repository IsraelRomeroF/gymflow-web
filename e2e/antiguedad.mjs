// Antigüedad del socio (auditoría 8, fase 0.7, 2-01). El alta pregunta «¿Desde
// cuándo viene?» (es nuevo, o ya venía: mes y año, nunca un mes que no llega);
// la gerencia la corrige en «Editar datos» solo con motivo, y queda en la
// bitácora con el antes y el después. El «hoy» del recorrido es el del
// gimnasio (lib/entorno.mjs fija la zona de la Ciudad de México).
import { recorrido, letras, celular, hoy, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('antiguedad', async (r) => {
  const nombre = `Sofía${letras(4).toLowerCase()}`;

  // 1. Alta: «Ya venía», con mes y año.
  r.paso('alta con antigüedad');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Nuevo socio' }).click();
  const d = rec.getByRole('dialog');
  await d.locator('#sf-fn').fill(nombre);
  await d.locator('#sf-ln').fill('Antigua Prueba');
  await d.locator('#sf-ph').fill(celular());
  r.ok(await d.getByText('¿Desde cuándo viene?').count() === 1, 'el alta pregunta desde cuándo viene');
  await d.getByRole('button', { name: 'Ya venía' }).click();
  const [anio, mes] = hoy().split('-').map(Number);
  if (mes < 12) {
    // Un mes que todavía no llega no se acepta.
    await d.locator('#sf-desde-anio').selectOption(String(anio));
    await d.locator('#sf-desde-mes').selectOption(String(mes + 1).padStart(2, '0'));
    r.ok(await d.getByText('Ese mes todavía no llega').count() === 1, 'un mes futuro se rechaza en su campo');
  }
  await d.locator('#sf-desde-mes').selectOption('03');
  await d.locator('#sf-desde-anio').selectOption('2024');
  r.ok(await d.getByText('Ese mes todavía no llega').count() === 0, 'marzo de 2024 sí');
  await d.getByRole('button', { name: 'Leer texto' }).first().waitFor({ timeout: T.respuesta });
  for (const c of await d.getByRole('switch').all()) await c.check();
  await r.captura(rec, 'antiguedad-1-alta');
  await d.getByRole('button', { name: 'Dar de alta' }).click();
  await rec.waitForURL('**/socios/**', { timeout: T.respuesta });
  const id = rec.url().split('?')[0].split('/').pop();
  await rec.keyboard.press('Escape');
  const socio = await rec.evaluate(async (i) => (await fetch(`/api/members/${i}`)).json(), id);
  r.ok((socio.joinedAt ?? '').startsWith('2024-03-01'), `queda como socio desde el 1 de marzo de 2024 (${socio.joinedAt?.slice(0, 10)})`);
  r.ok(await aparece(rec.getByText(/Socio desde hace \d+ años?/).first(), T.respuesta), 'la ficha lo cuenta en años, no «hace 0 días»');

  // 2. La gerencia la corrige, solo con motivo.
  r.paso('la gerencia corrige la antigüedad');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/socios/${id}`, { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Más' }).click();
  await ger.getByRole('menuitem', { name: 'Editar datos' }).click();
  const e = ger.getByRole('dialog', { name: 'Editar datos' });
  await e.locator('#sf-desde').fill('2023-03-01');
  r.ok(await e.locator('#sf-desde-motivo').count() === 1, 'al cambiar «Socio desde» aparece «Motivo del cambio»');
  r.ok(await e.getByRole('button', { name: 'Guardar' }).isDisabled(), 'y sin motivo no guarda');
  await e.locator('#sf-desde-motivo').fill('Venía desde 2023; se capturó mal');
  await r.captura(ger, 'antiguedad-2-corregir');
  await e.getByRole('button', { name: 'Guardar' }).click();
  await ger.getByText('Datos actualizados').waitFor({ timeout: T.respuesta });
  const corregido = await ger.evaluate(async (i) => (await fetch(`/api/members/${i}`)).json(), id);
  r.ok((corregido.joinedAt ?? '').startsWith('2023-03-01'), `la antigüedad queda corregida (${corregido.joinedAt?.slice(0, 10)})`);
  const asiento = (await ger.evaluate(async (i) => (await (await fetch(`/api/audit?resourceId=${i}&limit=20`)).json()).entries, id)).find((x) => x.action === 'member.update' && x.reason);
  r.ok(asiento?.reason === 'Venía desde 2023; se capturó mal', `la bitácora guarda el cambio con su motivo («${asiento?.reason ?? ''}»)`);
}, { erroresDePagina: 'falla' });
