// Caja (gerente de sede): el turno abierto no revela el efectivo; el corte
// cuenta billetes y monedas, revela el esperado solo después de contar y pide
// motivo si no cuadra; el corte impreso dice quién cerró; el turno se vuelve a
// abrir; y en el teléfono el conteo cabe.
// Fase 1.17a: el gerente corta un turno abierto de la semilla y abre otro; si
// el recorrido se cae en medio, al terminar se reabre un turno en cada sede
// que tenía uno (otros recorridos retiran y cobran en esos turnos).
import { recorrido, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('caja', async (r) => {
  const g = await r.api('gerencia');
  const conTurno = [...new Set((await g.get('/cash-sessions?status=OPEN')).sessions.map((s) => s.branchId))];
  r.alFinal(async () => {
    const abiertas = new Set((await g.get('/cash-sessions?status=OPEN')).sessions.map((s) => s.branchId));
    for (const sede of conTurno.filter((x) => !abiertas.has(x))) {
      const caja = (await g.get(`/cash-registers?branchId=${sede}`)).registers.find((c) => c.isActive);
      if (caja) { await g.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '50000', shiftLabel: 'MORNING' }); r.nota(`se reabrió un turno en ${caja.name}: el recorrido no alcanzó a reabrirlo`); }
    }
  });

  const page = await r.como('gerente');
  const shot = (n, opciones) => r.captura(page, `c${n}`, opciones);
  // El gerente de la sede corta cualquier turno (UX5-M-06); recepción solo el suyo.
  r.paso('turno abierto');
  await page.getByRole('link', { name: 'Caja' }).click();
  await page.waitForURL('**/caja');
  await page.getByText('Cortes anteriores').waitFor({ timeout: T.respuesta });
  await asentado(page);
  if (await page.getByRole('button', { name: 'Hacer corte' }).count() === 0) {
    await page.getByRole('button', { name: 'Abrir turno' }).first().click();
    await page.getByRole('dialog').getByLabel('Fondo inicial').fill('500');
    await page.getByRole('dialog').getByRole('button', { name: 'Abrir turno' }).click();
  }
  await page.getByRole('button', { name: 'Hacer corte' }).first().waitFor({ timeout: T.respuesta });
  await asentado(page);
  r.ok(await page.getByText('El efectivo no se muestra aquí').count() > 0, 'el turno abierto no revela el efectivo');
  await shot('1-caja');

  // Corte con un conteo que NO cuadra
  r.paso('corte que no cuadra');
  await page.getByRole('button', { name: 'Hacer corte' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Billetes de $500').fill('3');
  await d.getByLabel('Monedas de $10').fill('7');
  r.ok((await d.locator('.conteo-total strong').innerText()).includes('1,570'), 'el conteo suma billetes y monedas ($1,570)');
  r.ok(await d.getByText('Debía haber').count() === 0, 'el esperado NO aparece antes de contar');
  await shot('2-conteo');
  await d.getByRole('button', { name: /^Cerrar con/ }).click();
  await page.getByText('La caja no cuadra').waitFor({ timeout: T.respuesta });
  r.ok(await d.getByText('Debía haber').count() > 0, 'tras contar se revela el esperado y se pide motivo');
  await shot('3-motivo');
  await d.getByLabel('Motivo').fill('Prueba de corte: se contó solo una parte del cajón');
  await d.getByRole('button', { name: 'Cerrar con diferencia' }).click();
  await page.getByText('Corte hecho').waitFor({ timeout: T.respuesta });
  await shot('4-hecho');
  await d.getByRole('link', { name: /Ver e imprimir corte/ }).click();
  await page.waitForURL(/\/caja\/[0-9a-f-]{36}$/);
  await page.getByText('Corte de caja').first().waitFor();
  await page.getByText('Se contó', { exact: true }).waitFor();
  r.ok(await page.getByText('Prueba de corte').count() > 0, 'el corte muestra el motivo de la diferencia');
  r.ok(await page.getByText('Héctor Salinas').count() > 0, 'el corte dice quién cerró');
  await shot('5-corte');
  await page.emulateMedia({ media: 'print' });
  await shot('6-corte-impreso', { full: true });
  r.ok(await page.locator('.side').isHidden(), 'al imprimir se oculta el menú');
  await page.emulateMedia({ media: 'screen' });

  // Abrir un turno nuevo en esa caja
  r.paso('abrir turno nuevo');
  await page.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await asentado(page);
  const cerradasAntes = await page.getByRole('button', { name: 'Abrir turno' }).count();
  await page.getByRole('button', { name: 'Abrir turno' }).first().click();
  await page.getByRole('dialog').getByLabel('Fondo inicial').fill('500');
  await shot('7-abrir');
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir turno' }).click();
  await page.getByText(/Turno abierto en/).waitFor({ timeout: T.respuesta });
  await asentado(page);
  r.ok(await page.getByRole('button', { name: 'Abrir turno' }).count() === cerradasAntes - 1, 'la caja queda abierta de nuevo');
  r.ok(await page.getByText('$500.00').count() > 0, 'con su fondo inicial');
  r.ok(await page.getByRole('link', { name: 'Ver corte' }).count() > 0, 'el corte aparece en el historial');
  await shot('8-reabierta');

  // Móvil
  r.paso('teléfono');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await asentado(page);
  r.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 404, 'en móvil no empeora el desborde');
  await page.getByRole('button', { name: 'Hacer corte' }).first().click();
  await aparece(page.getByRole('dialog'), T.ui);
  await shot('9-movil-conteo');
});
