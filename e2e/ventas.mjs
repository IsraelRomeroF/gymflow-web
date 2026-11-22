// Ventas (2026-10): la gerencia arma el catálogo (plan nuevo, aviso de a
// cuántos afecta un cambio de precio, validación en su campo) y recepción
// vende y cobra, también sin cobrar y a un socio de otra sucursal.
//   node e2e/ventas.mjs dark    con el esquema oscuro (capturas)
// Fase 1.17a: el plan «Estudiante» lleva el nombre y el código de la corrida y
// se desactiva al terminar (antes se creaba otro «Estudiante» por corrida y la
// comprobación de que aparece pasaba con el de una corrida anterior).
import { recorrido, crearSocio, letras, elegirCaja, asentado, aparece, PANEL, T } from './lib/index.mjs';

const scheme = process.argv[2] ?? 'light';

await recorrido('ventas', async (r) => {
  const L = letras(4);
  const nombrePlan = `Estudiante ${L}`;
  const g = await r.api('gerencia');
  r.alFinal(async () => {
    const plan = (await g.get('/plans')).find((x) => x.name === nombrePlan);
    if (plan && plan.isActive !== false) await g.patch(`/plans/${plan.id}`, { isActive: false, reason: 'Plan de un recorrido de prueba' });
  });
  const sesion = (quien) => r.como(quien, { colorScheme: scheme });
  const shot = (p, n) => r.captura(p, `${scheme}-v${n}`);

  // ── 1. La gerencia arma el catálogo ───────────────────────────────────────
  r.paso('catálogo');
  const duena = await sesion('gerencia');
  await duena.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  await duena.getByText('Mensualidad').first().waitFor();
  await shot(duena, '1-catalogo');
  r.ok(await duena.getByRole('button', { name: 'Nuevo plan' }).count() > 0, 'la dueña puede crear planes');

  await duena.getByRole('button', { name: 'Nuevo plan' }).click();
  const dlg = duena.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill(nombrePlan);
  await dlg.getByLabel('Código').fill(`EST${L.toUpperCase()}`);
  await dlg.getByLabel('Precio por periodo').fill('450');
  await dlg.getByLabel('Inscripción').fill('0');
  await dlg.getByLabel('Motivo').fill('Plan para universitarios');
  await shot(duena, '2-nuevo-plan');
  await dlg.getByRole('button', { name: 'Crear plan' }).click();
  await duena.getByText(nombrePlan).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'el plan nuevo aparece en el catálogo');

  // Cambiar el precio de un plan con socios: avisa a cuántos afecta.
  await duena.locator('.card', { hasText: 'Mensualidad' }).first().getByRole('button', { name: 'Editar' }).click();
  await duena.getByRole('dialog').getByLabel('Precio por periodo').fill('690');
  r.ok(await aparece(duena.getByText(/tienen este plan|tiene este plan/).first(), T.respuesta), 'al cambiar el precio avisa cuántos socios se afectan');
  await shot(duena, '3-editar-aviso');
  await duena.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  // Un plan incoherente marca el campo, no truena.
  await duena.getByRole('button', { name: 'Nuevo plan' }).click();
  const d2 = duena.getByRole('dialog');
  await d2.getByRole('button', { name: 'Paquete de visitas' }).click();
  await d2.getByLabel('Nombre').fill('Paquete sin visitas');
  await d2.getByLabel('Código').fill(`PQ${L.toUpperCase()}`);
  await d2.getByLabel('Precio del paquete').fill('900');
  await d2.getByLabel('Motivo').fill('Prueba de validación');
  await d2.getByRole('button', { name: 'Crear plan' }).click();
  r.ok(await aparece(d2.getByText(/cuántas visitas/).first(), T.respuesta), 'un paquete sin visitas marca el campo con su motivo');
  await shot(duena, '4-validacion');
  await d2.getByRole('button', { name: 'Cancelar' }).click();

  // ── 2. Recepción: atiende y le vende ──────────────────────────────────────
  const rec = await sesion('recepcion');
  /** Socio sin membresía. `fuera` = con sucursal de casa FUERA del alcance de recepción. */
  async function socioNuevo(fuera) {
    // Lo da de alta la gerencia (recepción no puede dar altas fuera de su sede); recepción lo atiende.
    const s = await crearSocio(g, { sede: fuera ? 'FRO' : 'CEN', nombre: 'Renata', apellidos: `Prueba ${letras(5)}` });
    await rec.goto(`${PANEL}/socios/${s.id}`, { waitUntil: 'networkidle' });
    return s.id;
  }

  r.paso('venta cobrada');
  const socio1 = await socioNuevo(false);
  r.ok(!!socio1, 'socio nuevo sin membresía');
  await rec.getByRole('button', { name: 'Vender membresía' }).first().click();
  const v = rec.getByRole('dialog');
  await v.getByText('Mensualidad', { exact: true }).click();
  await shot(rec, '5-venta-plan');
  await v.getByRole('button', { name: 'Continuar' }).click();
  await v.getByText('Total').waitFor({ timeout: T.respuesta });
  await v.locator('.strong.num').last().waitFor();
  await asentado(rec);
  const totalTxt = await v.locator('.strong.num').last().innerText();
  r.ok(totalTxt.includes('950'), `el total incluye inscripción + periodo (${totalTxt})`);
  await shot(rec, '6-venta-cobro');
  await elegirCaja(v);
  await v.getByRole('button', { name: /^Cobrar/ }).click();
  await rec.getByText(/ya puede entrar/).waitFor({ timeout: T.respuesta });
  await shot(rec, '7-venta-lista');
  await v.getByRole('button', { name: 'Listo' }).click();
  await rec.locator('.profile').getByText(/Al corriente/).waitFor({ timeout: T.respuesta });
  r.ok(await rec.locator('.profile').getByText(/Al corriente/).count() > 0, 'la ficha muestra la membresía al corriente');
  await shot(rec, '8-ficha-vigente');

  // ── 3. Vender sin cobrar, y cobrar después — a un socio de OTRA sucursal ──
  r.paso('vender sin cobrar y cobrar después');
  await socioNuevo(true);
  await rec.getByRole('button', { name: 'Vender membresía' }).first().click();
  const v2 = rec.getByRole('dialog');
  await v2.getByText('Mensualidad', { exact: true }).click();
  await v2.getByRole('button', { name: 'Continuar' }).click();
  await v2.getByText('Total').waitFor({ timeout: T.respuesta });
  await v2.getByText(/Cobrar ahora/).click();
  await v2.getByRole('button', { name: 'Vender sin cobrar' }).click();
  await rec.getByText(/pendiente de pago/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'vender sin cobrar deja la membresía pendiente');
  await v2.getByRole('button', { name: 'Listo' }).click();
  await rec.getByText('Por activar').first().waitFor({ timeout: T.respuesta });
  r.ok(await rec.getByText('Por activar').count() > 0, 'la ficha la muestra por activar');
  await rec.getByRole('tab', { name: /Estado de cuenta/ }).click();
  await rec.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await shot(rec, '9-cobrar');
  await asentado(rec);
  await elegirCaja(rec.getByRole('dialog'));
  await rec.getByRole('dialog').getByRole('button', { name: /^Cobrar \$/ }).click();
  await rec.getByText('Cobro registrado').waitFor({ timeout: T.respuesta });
  r.ok(await rec.getByRole('link', { name: 'Comprobante' }).count() > 0, 'cobrar ofrece el comprobante');
  await rec.getByRole('button', { name: 'Listo' }).click();
  await asentado(rec);
  const avisos = await rec.locator('.toast').allInnerTexts();
  if (await rec.getByRole('dialog').count()) { console.log('diálogo sigue abierto; avisos:', avisos); await shot(rec, '9b-cobrar-error'); }
  await rec.getByRole('tab', { name: /Resumen/ }).click();
  await rec.locator('.stat').filter({ hasText: 'Membresía' }).waitFor({ timeout: T.respuesta });
  await asentado(rec);
  r.ok(await rec.locator('.profile').getByText(/Al corriente/).count() > 0, 'cobrar después la activa');
  await shot(rec, '10-activada');

  // ── 4. Pase del día (1.8): la visita suelta se vende y se cobra en un paso, sin membresía ──
  r.paso('pase del día');
  await socioNuevo(false);
  await rec.getByRole('button', { name: 'Vender membresía' }).first().click();
  const v3 = rec.getByRole('dialog');
  await v3.getByText('Visita suelta', { exact: true }).last().click();
  await v3.getByRole('button', { name: 'Continuar' }).click();
  await v3.getByText('Total').waitFor({ timeout: T.respuesta });
  await asentado(rec);
  const totalPase = await v3.locator('.strong.num').last().innerText();
  r.ok(totalPase.includes('150') && !totalPase.includes('450'), `el pase no cobra inscripción (${totalPase})`);
  r.ok(await v3.getByText(/Cobrar ahora/).count() === 0, 'el pase se cobra al venderlo: no hay «vender sin cobrar»');
  await shot(rec, '11-pase-cobro');
  await elegirCaja(v3);
  await v3.getByRole('button', { name: /^Cobrar/ }).click();
  await rec.getByText(/pase del día/i).first().waitFor({ timeout: T.respuesta });
  await shot(rec, '12-pase-vendido');
  await v3.getByRole('button', { name: 'Listo' }).click();
  await rec.locator('.profile').getByText(/Pase del día/).first().waitFor({ timeout: T.respuesta });
  r.ok(true, 'la ficha dice que hoy entra con su pase del día');
  await shot(rec, '13-pase-ficha');

  // Recepción ve el catálogo sin poder editarlo
  await rec.goto(`${PANEL}/planes`, { waitUntil: 'networkidle' });
  // Recepción puede ver el catálogo o la puerta cerrada del dueño: se espera a cualquiera de las dos pantallas.
  await rec.getByText('Mensualidad').or(rec.getByText(/libera el dueño/)).first().waitFor({ timeout: T.respuesta }).catch(() => undefined);
  r.ok(await rec.getByRole('button', { name: 'Nuevo plan' }).count() === 0, 'recepción ve el catálogo pero no lo edita');
});
