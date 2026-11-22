// Importación segura (auditoría 8, fase 0.11: 18-01, 18-02, 18-03, 16-04), con
// el archivo de 7 filas de fase0/0.11-importacion-segura.md (códigos, nombres y
// celulares con sufijo para poder repetirlo). Lo ilegible queda en «Con datos
// dudosos» y bloquea aplicar; cada plan del archivo exige decisión; la
// vigencia importada lleva el precio de su sucursal; y reimportar el mismo
// archivo no vuelve a cargar ningún saldo inicial.
import { writeFileSync } from 'node:fs';
import { recorrido, asentado, cuadros, hoy, PANEL, T } from './lib/index.mjs';

await recorrido('importar-seguro', async (r) => {
  const ok = r.ok;
  const p = await r.como('gerencia');
  const get = async (url) => (await p.request.get(`${PANEL}/api${url}`)).json();

  const n = Date.now().toString(36);
  const L = n.slice(-4).replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).replace(/^./, (c) => c.toUpperCase());
  const cod = (i) => `V${n.slice(-5).toUpperCase()}-00${i}`;
  const tel = (i) => `99${String(Date.now()).slice(-7)}${i}`;
  const csv = [
    'No. Socio;Nombre completo;Teléfono;Sucursal;Fecha de alta;Saldo;Plan;Vence',
    `${cod(1)};Verónica ${L} Saldo;${tel(1)};Centro;15/03/2021;mil pesos;;`,
    `${cod(2)};Víctor ${L} Vigencia;${tel(2)};Centro;10/01/2022;$650.00;MENSUAL;31/02/2027`,
    `${cod(3)};Valeria ${L} Alta;${tel(3)};Norte;ayer;;;`,
    `${cod(4)};Vicente ${L} Frontera;${tel(4)};Frontera;01/06/2020;;MENSUAL;30/12/2030`,
    `${cod(5)};Viviana ${L} Sinplan;${tel(5)};Centro;;;;30/12/2030`,
    `${cod(6)};Vladimir ${L} Repetido;${tel(6)};Centro;;$100.00;;`,
    `${cod(6)};Vladimir ${L} Repetido;${tel(6)};Centro;;$100.00;;`,
  ].join('\n');
  const ruta = new URL(`./archivos/importacion-segura-${n}.csv`, import.meta.url).pathname;
  writeFileSync(ruta, csv);

  async function subir() {
    await p.goto(`${PANEL}/importar`, { waitUntil: 'networkidle' });
    if (!(await p.getByTestId('nueva-importacion').count())) await p.getByRole('button', { name: 'Nueva importación' }).click();
    await p.getByLabel('Archivo de socios').setInputFiles(ruta);
    // La fecha de corte ya no nace en «hoy» (fase 2 · 2.7).
    await p.getByLabel('Fecha de corte').fill(hoy());
    await p.getByRole('button', { name: /Revisar 7 filas/ }).click();
    await p.waitForURL(/\/importar\/[0-9a-f-]{36}$/, { timeout: T.respuesta });
    await p.getByTestId('importar-resumen').waitFor({ timeout: T.respuesta });
  }
  const aplicar = p.getByTestId('aplicar').getByRole('button', { name: /^(Aplicar \d+ filas|Faltan? \d+ por revisar|Falta elegir el plan)/ });
  // Aplicar abre su confirmación (fase 2 · 2.7): el motivo y el cotejo contra la cartera van ahí.
  async function confirmarAplicar(motivo) {
    await aplicar.click();
    const d = p.getByRole('dialog');
    await d.locator('#ap-motivo').fill(motivo);
    await d.getByLabel(/Cotejé el adeudo/).check();
    await d.getByRole('button', { name: /^Aplicar \d+ filas$/ }).click();
  }
  const tarjeta = (renglon) => p.locator(`[data-dato="${renglon}"]`);
  async function decidirDatos({ corregirSaldo }) {
    await p.getByRole('tab', { name: /Con datos dudosos/ }).click();
    await tarjeta(2).waitFor({ timeout: T.respuesta });
    if (corregirSaldo) {
      await tarjeta(2).getByRole('button', { name: 'Corregir el valor' }).click();
      await tarjeta(2).getByLabel('Debe o tiene a favor').selectOption('DEBE');
      await tarjeta(2).getByLabel('Saldo correcto').first().fill('650');
      await tarjeta(2).getByRole('button', { name: 'Guardar corrección' }).click();
    } else await tarjeta(2).getByRole('button', { name: 'Entra sin ese dato' }).click();
    await p.locator('[data-dato="2"]:not([data-datos="PENDING"])').waitFor({ timeout: T.respuesta });
    await tarjeta(3).getByRole('button', { name: 'Entra sin ese dato' }).click();
    await p.locator('[data-dato="3"][data-datos="WITHOUT"]').waitFor({ timeout: T.respuesta });
    await tarjeta(4).getByRole('button', { name: 'Corregir el valor' }).click();
    await tarjeta(4).getByLabel('Socio desde (correcto)').fill('2019-05-01');
    await tarjeta(4).getByRole('button', { name: 'Guardar corrección' }).click();
    await p.locator('[data-dato="4"][data-datos="FIXED"]').waitFor({ timeout: T.respuesta });
  }
  async function decidirPlanes() {
    const asig = p.getByTestId('asignaciones');
    await asig.locator('#plan-MENSUAL').selectOption({ label: 'Mensualidad' });
    const noCargar = await asig.locator('#plan-sin-plan option', { hasText: 'No cargar su vigencia' }).getAttribute('value');
    await asig.locator('#plan-sin-plan').selectOption(noCargar);
    await asig.getByRole('button', { name: 'Guardar' }).click();
    await p.getByText('Asignaciones guardadas.').waitFor({ timeout: T.respuesta });
  }
  const saldosIniciales = async (id) => ((await get(`/members/${id}/statement`)).charges ?? []).filter((c) => c.chargeType === 'OPENING_BALANCE' && c.status !== 'VOID');
  const socio = async (codigo) => (await get(`/members/search?q=${encodeURIComponent(codigo)}`)).results?.[0];

  // 1. Revisión: lo dudoso espera a una persona y bloquea aplicar.
  await subir();
  await r.captura(p, 'importar-seguro-1-revision', { full: true });
  ok(await p.getByText('3 filas con datos dudosos esperan tu decisión').count() === 1, 'avisa: 3 filas con datos dudosos esperan tu decisión');
  ok(await p.getByRole('tab', { name: /Con datos dudosos/ }).count() === 1, 'la pestaña «Con datos dudosos» está a la vista');
  ok(await tarjeta(2).getByText('El archivo dice «mil pesos»').count() === 1 && await tarjeta(3).getByText('El archivo dice «31/02/2027»').count() === 1 && await tarjeta(4).getByText('El archivo dice «ayer»').count() === 1,
    'cada fila dice qué no se entendió: saldo «mil pesos», vigencia «31/02/2027», alta «ayer»');
  ok(/Faltan 3 por revisar/.test(await aplicar.innerText()) && await aplicar.isDisabled(), 'con datos dudosos sin decidir no se puede aplicar («Faltan 3 por revisar»)');
  const asig = p.getByTestId('asignaciones');
  ok(await asig.locator('#plan-MENSUAL').inputValue() === '' && await asig.locator('#plan-sin-plan').inputValue() === '', 'los planes del archivo, y las vigencias sin plan, empiezan sin decisión');
  ok(await asig.getByText(/Falta elegir qué hacer con/).count() === 1, 'y avisa que falta elegir qué hacer con ellos');

  // 2. Decidir datos: sin los planes, todavía no se aplica.
  await decidirDatos({ corregirSaldo: true });
  ok(await p.locator('[data-dato="2"][data-datos="FIXED"]').count() === 1, 'el saldo de V-001 se corrige a mano: debe $650');
  await asentado(p);
  ok(/Falta elegir el plan/.test(await aplicar.innerText()) && await aplicar.isDisabled(), 'decididos los datos, sin plan todavía no se aplica');
  ok(await p.getByTestId('aplicar').getByText(/Antes de aplicar/).count() === 1, 'y la tarjeta «Aplicar» dice qué falta');
  await decidirPlanes();
  await p.getByRole('tab', { name: /Repetidos en el archivo/ }).click();
  await p.locator('[data-caso="8"]').waitFor({ timeout: T.respuesta });
  ok(/ya trae el saldo de este registro/.test(await p.locator('[data-caso="8"]').innerText()), 'el renglón repetido avisa que su saldo no se carga dos veces');
  await cuadros(p);
  ok(/^Aplicar 7 filas/.test(await aplicar.innerText()) && !(await aplicar.isDisabled()), 'con todo decidido: «Aplicar 7 filas»');
  await confirmarAplicar('Corte firmado por el dueño (recorrido de prueba)');
  await p.getByText('Importación aplicada', { exact: true }).waitFor({ timeout: 2 * T.navegacion });
  await r.captura(p, 'importar-seguro-2-aplicada', { full: true });

  // 3. Lo que quedó en cada ficha.
  const [v1, v2, v3, v4, v5, v6] = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => socio(cod(i))));
  ok(!!v1 && !!v2 && !!v3 && !!v4 && !!v5 && !!v6, 'cada código del sistema anterior encuentra a su socio');
  const s1 = await saldosIniciales(v1.id); const s2 = await saldosIniciales(v2.id); const s6 = await saldosIniciales(v6.id);
  ok(s1.length === 1 && s1[0].amountCents === '65000', `V-001 entra con el saldo corregido: $650 (${s1.map((c) => c.amountCents).join(', ')})`);
  ok(s2.length === 1 && s2[0].amountCents === '65000' && (await get(`/members/${v2.id}/memberships`)).length === 0, 'V-002 entra con su saldo y sin la vigencia ilegible');
  ok(((await get(`/members/${v3.id}`)).joinedAt ?? '').startsWith('2019-05-01'), 'V-003 es socio desde la fecha corregida (1 may 2019)');
  const m4 = (await get(`/members/${v4.id}/memberships`))[0];
  const cuota4 = ((await get(`/members/${v4.id}/statement`)).charges ?? []).find((c) => c.membershipId === m4?.id);
  ok(m4?.status === 'ACTIVE' && /^2030-12-3[01]/.test(m4.coveredThrough ?? m4.currentPeriodEnd ?? ''), `V-004 trae su vigencia hasta el 30 dic 2030 (${m4?.status} ${m4?.coveredThrough ?? m4?.currentPeriodEnd})`);
  ok(cuota4?.amountCents === '71500', `con el precio de Frontera: la cuota cubierta en el sistema anterior es de $715 (${cuota4?.amountCents})`);
  ok((await get(`/members/${v5.id}/memberships`)).length === 0, 'V-005 (vigencia sin plan) entra sin membresía, como se decidió');
  ok((await get(`/members/search?q=${encodeURIComponent(cod(6))}`)).results.filter((r) => r.lastName?.includes('Repetido')).length === 1 && s6.length === 1 && s6[0].amountCents === '10000', 'V-006, repetido en el archivo: una sola ficha y un solo saldo de $100');

  // 4. Reimportar el mismo archivo: nadie nuevo y ningún saldo inicial se vuelve a cargar.
  await subir();
  ok(await p.getByRole('tab', { name: /^Nuevos/ }).count() === 0 && await p.getByRole('tab', { name: /Ya son socios/ }).count() === 1, 'reimportar: todos se reconocen («Ya son socios»), nadie nuevo');
  ok(/por revisar/.test(await aplicar.innerText()) && await aplicar.isDisabled(), 'sus datos dudosos vuelven a bloquear «Aplicar»');
  await decidirDatos({ corregirSaldo: false });
  await decidirPlanes();
  await p.getByRole('tab', { name: /Ya son socios/ }).click();
  await asentado(p);
  ok(await p.getByText(/Ya tiene su saldo inicial/).count() >= 2, 'antes de aplicar, avisa quién ya tiene su saldo inicial');
  await cuadros(p);
  await confirmarAplicar('Reimportación del mismo corte (recorrido de prueba)');
  await p.getByText('Importación aplicada', { exact: true }).waitFor({ timeout: 2 * T.navegacion });
  ok(await p.getByText(/saldos? iniciales? no se (volvió|volvieron) a cargar/).count() === 1, 'la importación aplicada dice cuántos saldos no se volvieron a cargar');
  await r.captura(p, 'importar-seguro-3-reimportada', { full: true });
  const d1 = await saldosIniciales(v1.id); const d2 = await saldosIniciales(v2.id); const d6 = await saldosIniciales(v6.id);
  ok(d1.length === 1 && d2.length === 1 && d6.length === 1, `reimportar no duplica saldos: V-001 ${d1.length}, V-002 ${d2.length}, V-006 ${d6.length}`);
  ok((await get(`/members/${v4.id}/memberships`)).length === 1, 'ni la membresía importada');
}, { erroresDePagina: 'falla' });
