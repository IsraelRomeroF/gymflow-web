// Personal (fase 1.14: 17-04 a 17-07, 17-10, 17-11 y la temporal vencida de la
// fase 0). Alta con celular (validado) y lo que verá el primer día; editar en
// cuatro bloques con un solo botón que dice lo que guarda; dar de baja y
// reactivar con una temporal NUEVA (la de antes ya no entra); «Temporal
// vencida» en la lista; «Qué ve» con solo las secciones que tienen efecto para
// el puesto; y el aviso del gerente nuevo con «Copiar lo de…».
//
// Datos propios: las tres cuentas son de esta corrida (correo con sufijo) y se
// dan de baja al terminar. A Paola (recepción sembrada) no se le cambia nada.
// La temporal vencida se arma recorriendo 8 días el reloj de ESA cuenta en
// gymflow_pruebas (lib/base.mjs), como en contrasenas.mjs.
import { recorrido, sql, sufijo, letras, celular, accion, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('personal', async (r) => {
  const g = await r.api('gerencia');
  const s = sufijo();
  const L = letras(4);
  const recep = { nombre: `Inés Personal ${L}`, email: `personal.${s}@demo.mx` };
  const nuevoGerente = { nombre: `Gonzalo Gerente ${L}`, email: `gerente.${s}@demo.mx` };
  const vencida = { nombre: `Vera Vencida ${L}`, email: `vencida.${s}@demo.mx` };
  r.alFinal(async () => {
    const gente = (await g.get('/users')).users;
    for (const correo of [recep.email, nuevoGerente.email, vencida.email]) {
      const u = gente.find((x) => x.email === correo && x.isActive);
      if (u) await g.patch(`/users/${u.id}`, { isActive: false, reason: 'Cuenta de un recorrido de prueba' });
    }
  });
  const persona = async (correo) => (await g.get('/users')).users.find((x) => x.email === correo);
  const fila = (p, correo) => p.locator('tbody tr').filter({ hasText: correo });
  const claveDe = async (p) => {
    const dlg = p.getByRole('dialog', { name: /^Contraseña temporal de/ });
    await dlg.waitFor({ timeout: T.respuesta });
    const clave = (await dlg.locator('.mono').first().innerText()).trim();
    await dlg.getByRole('button', { name: 'Ya la entregué' }).click();
    return clave;
  };
  const intentar = async (correo, clave) => {
    const p = await r.nueva();
    await p.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
    await p.getByLabel('Correo').fill(correo);
    await p.getByLabel('Contraseña').fill(clave);
    await p.getByRole('button', { name: /^Entrar/ }).first().click();
    return p;
  };

  // 1. Alta con celular: uno incompleto se marca en su campo; al gerente se le dice que nace sin Dirección.
  r.paso('alta con celular');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Dar de alta' }).click();
  const alta = ger.getByRole('dialog', { name: 'Dar de alta a una persona' });
  await alta.getByLabel('Nombre completo').fill(recep.nombre);
  await alta.getByLabel('Correo').fill(recep.email);
  r.ok(await alta.getByLabel('Celular').count() === 1, 'el alta pide el celular');
  await alta.locator('#st-rol').selectOption('MANAGER');
  r.ok(/De Dirección y Cumplimiento, nada al principio/.test(await alta.innerText()), 'con Gerente, dice que de Dirección y Cumplimiento no ve nada al principio');
  await alta.locator('#st-rol').selectOption('RECEPTION');
  await alta.getByLabel('Celular').fill('12345');
  await accion(ger, () => alta.getByRole('button', { name: 'Dar de alta' }).click(), '/api/users', { metodo: 'POST', que: 'el alta' });
  await asentado(ger);
  r.ok(/10 dígitos/.test(await alta.locator('.field:has(#st-tel) .field-error').innerText().catch(() => '')), 'un celular de 5 dígitos se marca en su campo');
  const tel = celular();
  await alta.getByLabel('Celular').fill(tel);
  await alta.getByRole('button', { name: 'Dar de alta' }).click();
  const temporal1 = await claveDe(ger);
  r.ok(/^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(temporal1), `la persona nace con su temporal (${temporal1})`);
  r.ok((await persona(recep.email))?.phoneE164 === `+52${tel}`, 'y su celular queda guardado como el de los socios (+52…)');

  // 2. Editar en cuatro bloques, con un solo botón que dice lo que guarda.
  r.paso('cuatro bloques');
  await ger.reload({ waitUntil: 'networkidle' });
  await fila(ger, recep.email).getByRole('button', { name: 'Editar' }).click();
  const ed = ger.getByRole('dialog', { name: recep.nombre });
  await ed.waitFor({ timeout: T.ui });
  const bloques = [];
  for (const b of ['Cuenta', 'Puesto y sucursales', 'Qué ve', 'Qué puede hacer']) if (await ed.locator(`section[aria-label="${b}"]`).count() === 1) bloques.push(b);
  r.ok(bloques.length === 4, `la persona se edita en cuatro bloques (${bloques.join(' · ')})`);
  r.ok(await ed.locator('section[aria-label="Cuenta"]').getByRole('button', { name: 'Nueva contraseña' }).count() === 1 && await ed.locator('section[aria-label="Cuenta"]').getByRole('button', { name: 'Dar de baja' }).count() === 1, '«Nueva contraseña» y «Dar de baja» viven en Cuenta');
  r.ok(/Lo decide la dueña/.test(await ed.locator('section[aria-label="Qué ve"]').innerText()), 'a la gerencia, «Qué ve» se le lee: lo decide la dueña');
  await ed.getByTestId('permisos-persona').getByRole('switch').first().click();
  r.ok((await ed.getByTestId('guardar-persona').innerText()).trim() === 'Guardar permisos', 'con una excepción, el botón dice «Guardar permisos»');
  await ed.locator('#pd-nom').fill(`${recep.nombre} Ruiz`);
  r.ok((await ed.getByTestId('guardar-persona').innerText()).trim() === 'Guardar cambios', 'con la excepción y el nombre, dice «Guardar cambios»');
  r.ok(await ed.getByTestId('guardar-persona').isDisabled(), 'y sin motivo no guarda');
  await ed.locator('#ed-mot').fill('Cubre el turno de la tarde');
  await r.captura(ger, 'personal-1-cuatro-bloques');
  await ed.getByTestId('guardar-persona').click();
  await ed.waitFor({ state: 'hidden', timeout: T.respuesta });
  const editada = await persona(recep.email);
  r.ok(editada?.fullName === `${recep.nombre} Ruiz` && ((editada?.permissionOverrides?.add?.length ?? 0) + (editada?.permissionOverrides?.remove?.length ?? 0)) === 1, 'se guardan el nombre y la excepción, juntos');
  recep.nombre = `${recep.nombre} Ruiz`;

  // 3. Baja y reactivación: vuelve con una temporal NUEVA; la de antes ya no entra.
  r.paso('baja y reactivación');
  await fila(ger, recep.email).getByRole('button', { name: 'Editar' }).click();
  await ger.getByRole('dialog', { name: recep.nombre }).getByRole('button', { name: 'Dar de baja' }).click();
  let c = ger.getByRole('dialog', { name: `¿Dar de baja a ${recep.nombre}?` });
  await c.getByLabel('Motivo').fill('Fin de contrato (recorrido de prueba)');
  await c.getByRole('button', { name: 'Dar de baja' }).click();
  await ger.getByText('Dada de baja: sus sesiones se cerraron').waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await fila(ger, recep.email).getByText('Dada de baja', { exact: true }).count() === 1, 'dada de baja, la fila lo dice');
  await fila(ger, recep.email).getByRole('button', { name: 'Editar' }).click();
  await ger.getByRole('dialog', { name: recep.nombre }).getByRole('button', { name: 'Reactivar' }).click();
  c = ger.getByRole('dialog', { name: `¿Reactivar a ${recep.nombre}?` });
  r.ok(/contraseña temporal nueva/.test(await c.innerText()), 'reactivar avisa que llega una temporal nueva');
  await c.getByLabel('Motivo').fill('Regresa a trabajar (recorrido de prueba)');
  await c.getByRole('button', { name: 'Reactivar' }).click();
  const temporal2 = await claveDe(ger);
  r.ok(/^GYM-/.test(temporal2) && temporal2 !== temporal1, 'y la muestra una sola vez, distinta de la de antes');
  const vieja = await intentar(recep.email, temporal1);
  r.ok(await aparece(vieja.getByText('El correo o la contraseña no coinciden'), T.respuesta), 'con la temporal de antes ya no entra');
  const nueva = await intentar(recep.email, temporal2);
  r.ok(await aparece(nueva.getByTestId('elegir-contrasena'), T.respuesta), 'con la nueva entra a elegir la suya');

  // 4. «Temporal vencida» en la lista, con «Nueva contraseña» en la fila.
  r.paso('temporal vencida');
  const sedes = await g.get('/branches');
  await g.post('/users', { email: vencida.email, fullName: vencida.nombre, phoneE164: null, roleKey: 'RECEPTION', branchIds: [sedes.find((b) => b.code === 'CEN').id], reason: 'Cuenta de un recorrido de prueba' });
  const movida = await sql(`update users set "passwordResetAt" = now() - interval '8 days' where lower(email) = lower($1) and "mustChangePassword" returning id`, [vencida.email]);
  r.ok(movida.length === 1, 'pasan 8 días sin que use su temporal');
  await ger.reload({ waitUntil: 'networkidle' });
  const fv = fila(ger, vencida.email);
  await fv.waitFor({ timeout: T.respuesta });
  r.ok(await fv.getByText('Temporal vencida', { exact: true }).count() === 1 && await fv.getByRole('button', { name: 'Nueva contraseña' }).count() === 1, 'Personal la marca «Temporal vencida», con «Nueva contraseña» en la fila');
  await fv.getByRole('button', { name: 'Editar' }).click();
  r.ok(await aparece(ger.getByRole('dialog', { name: vencida.nombre }).getByText('Su contraseña temporal venció sin usarla: dale una nueva.'), T.ui), 'y su ficha dice que venció sin usarla');
  await r.captura(ger, 'personal-2-temporal-vencida');
  await ger.keyboard.press('Escape');

  // 5. «Qué ve» (la dueña): solo lo que tiene efecto para recepción, cada uno con lo que le da.
  r.paso('qué ve');
  const own = await r.como('duena');
  await own.goto(`${PANEL}/personal`, { waitUntil: 'networkidle' });
  await fila(own, recep.email).getByRole('button', { name: 'Qué ve' }).click();
  const qv = own.getByRole('dialog', { name: recep.nombre }).getByTestId('secciones-llave');
  await qv.waitFor({ timeout: T.ui });
  // El nombre de cada interruptor es su etiqueta (el input va dentro del <label>).
  const interruptores = (await qv.locator('.switch-label').allInnerTexts()).map((t) => t.trim()).sort();
  const esperados = ['Caja', 'Planes', 'Punto de venta', 'Retención', 'Textos de consentimiento'];
  r.ok(JSON.stringify(interruptores) === JSON.stringify(esperados), `a recepción solo se le ofrece lo que tiene efecto: ${interruptores.join(', ')}`);
  r.ok(await qv.getByText('Consulta los planes y sus precios; no los cambia.').count() === 1, 'cada sección dice lo que le da a ese puesto («Consulta los planes…»)');
  await qv.getByRole('switch', { name: 'Planes' }).click();
  await own.getByRole('dialog', { name: recep.nombre }).locator('#ed-mot').fill('Lleva el catálogo de la sucursal');
  r.ok((await own.getByTestId('guardar-persona').innerText()).trim() === 'Guardar secciones', 'el botón dice «Guardar secciones»');
  await r.captura(own, 'personal-3-que-ve');
  await own.getByTestId('guardar-persona').click();
  await own.getByText('Secciones guardadas: tendrá que volver a entrar').waitFor({ timeout: T.respuesta });
  await asentado(own);
  r.ok((await fila(own, recep.email).getByTestId('llave').innerText()) === 'Ve 1 de 3 de Dirección y Cumplimiento', 'la fila cuenta sobre lo que aplica: «Ve 1 de 3 de Dirección y Cumplimiento»');

  // 6. Gerente nuevo: la dueña se entera en Personal y copia lo de otro gerente.
  r.paso('gerente nuevo');
  await g.post('/users', { email: nuevoGerente.email, fullName: nuevoGerente.nombre, phoneE164: null, roleKey: 'MANAGER', branchIds: [], reason: 'Cuenta de un recorrido de prueba' });
  await own.reload({ waitUntil: 'networkidle' });
  const aviso = own.locator('.callout').filter({ hasText: /^Gerentes? nuevos?:/ });
  r.ok(await aparece(aviso, T.respuesta) && (await aviso.innerText()).includes(nuevoGerente.nombre), `Personal le avisa a la dueña: «Gerente nuevo: ${nuevoGerente.nombre}»`);
  r.ok(await fila(own, nuevoGerente.email).getByTestId('por-decidir').count() === 1, 'y la fila dice que aún no decide qué ve');
  await aviso.getByRole('button', { name: /^Decidir qué ve/ }).filter({ hasText: nuevoGerente.nombre }).or(aviso.getByRole('button', { name: 'Decidir qué ve' })).first().click();
  const dg = own.getByRole('dialog', { name: nuevoGerente.nombre });
  await dg.getByText('Gerente nuevo: decide qué ve').waitFor({ timeout: T.ui });
  await dg.getByTestId('copiar-que-ve').selectOption({ label: 'Lucía Fernández' });
  r.ok((await dg.locator('#ed-mot').inputValue()) === 'Lo mismo que Lucía Fernández', '«Copiar lo de…» trae lo de otro gerente y propone el motivo');
  await dg.getByTestId('guardar-persona').click();
  await dg.waitFor({ state: 'hidden', timeout: T.respuesta });
  await asentado(own);
  r.ok(await own.locator('.callout').filter({ hasText: nuevoGerente.nombre }).count() === 0 && await fila(own, nuevoGerente.email).getByTestId('por-decidir').count() === 0, 'al guardar, el aviso se va');
  const copiado = await persona(nuevoGerente.email);
  const lucia = (await g.get('/users')).users.find((x) => x.email === 'gerencia@demo.mx');
  r.ok(JSON.stringify([...(copiado?.unlockedSections ?? [])].sort()) === JSON.stringify([...(lucia?.unlockedSections ?? [])].sort()), `y ve lo mismo que Lucía Fernández (${copiado?.unlockedSections?.length ?? 0} secciones)`);
}, { erroresDePagina: 'falla' });
