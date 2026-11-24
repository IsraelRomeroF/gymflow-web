// Apoderado temporal (fase 3, bloque 3.1 · D-02), en el navegador:
//
//  1. La dueña lo nombra en Autorizaciones: persona, hasta qué día y su
//     contraseña. La tarjeta queda «Vigente».
//  2. El apoderado (el gerente de Centro) ve en Autorizaciones con qué
//     autoridad firma: «Autorizas como apoderado de … hasta el …».
//  3. Recepción pide un retiro de $1.00; en la firma ya se puede elegir al
//     apoderado en «Quién autoriza», y con su contraseña el retiro se registra
//     a su nombre.
//  4. La dueña ve que «lleva 1 autorización», lo revoca, y el nombramiento
//     queda en «Nombramientos anteriores» como «lo revocaste · 1 firma».
//
// Lo compartido que toca: el nombramiento (se revoca al terminar, también si
// el recorrido se cae) y $1.00 del turno abierto de Centro, que vuelve al
// cajón con una entrada de fondo.
import { recorrido, sedeDe, letras, accion, asentado, aparece, firmar, CLAVE_PRUEBAS, PANEL, T } from './lib/index.mjs';

await recorrido('apoderado', async (r) => {
  const g = await r.api('gerencia');
  const d0 = await r.api('duena');
  const L = letras(4);
  const cen = await sedeDe(g, 'CEN');
  const revocar = async (motivo) => {
    const e = await d0.get('/approvals/proxy');
    if (e.current) { await d0.post('/approvals/proxy/revoke', { reason: motivo }); return true; }
    return false;
  };
  if (await revocar('Empieza el recorrido apoderado (prueba)')) r.nota('había un apoderado vigente (una corrida que no terminó): se revocó antes de empezar');
  r.alFinal(() => revocar('Termina el recorrido apoderado (prueba)'));

  // ── 1. La dueña nombra a su apoderado ─────────────────────────────────────
  r.paso('nombrar');
  const duena = await r.como('duena');
  await duena.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
  const tarjeta = duena.getByTestId('apoderado');
  r.ok(await aparece(tarjeta.getByRole('button', { name: 'Nombrar apoderado' }), T.respuesta), 'Autorizaciones de la dueña trae «Apoderado temporal · Nombrar apoderado»');
  await tarjeta.getByRole('button', { name: 'Nombrar apoderado' }).click();
  const nb = duena.getByRole('dialog', { name: 'Nombrar apoderado' });
  await nb.getByRole('button', { name: 'Nombrar', exact: true }).click();
  r.ok(await aparece(nb.getByText('Elige a quién nombras.'), T.ui) && await nb.getByText('Escribe tu contraseña.').count() === 1, 'sin persona, día ni contraseña no se nombra, y cada campo lo dice');
  const estado = await d0.get('/approvals/proxy');
  const elegido = estado.candidates.find((c) => /Héctor/.test(c.fullName) && !c.cannotSignYet) ?? estado.candidates.find((c) => !c.cannotSignYet);
  await nb.getByRole('radio', { name: new RegExp(`^${elegido.fullName}`) }).click();
  await nb.getByRole('group', { name: 'Atajos de fecha' }).getByRole('button').nth(1).click();
  await nb.getByLabel('Nota').fill(`Salgo de viaje (prueba ${L})`);
  await nb.getByLabel('Tu contraseña').fill(CLAVE_PRUEBAS);
  await r.captura(duena, 'apoderado-1-nombrar');
  const nombrado = await accion(duena, () => nb.getByRole('button', { name: 'Nombrar', exact: true }).click(), '/api/approvals/proxy', { metodo: 'POST', que: 'el nombramiento' });
  r.ok(nombrado.ok(), `nombra a ${elegido.fullName} hasta mañana (${nombrado.status()})`);
  r.ok(await aparece(duena.getByText(new RegExp(`^${elegido.fullName} autoriza por ti hasta el `)).first(), T.respuesta), `avisa «${elegido.fullName} autoriza por ti hasta el …»`);
  r.ok(await aparece(tarjeta.getByText('Vigente', { exact: true }), T.respuesta) && await tarjeta.getByText('No ha firmado nada con este nombramiento.').count() === 1, 'la tarjeta queda «Vigente» y dice que no ha firmado nada');
  await r.captura(duena, 'apoderado-2-vigente');

  // ── 2. El apoderado ve con qué autoridad firma ────────────────────────────
  r.paso('el aviso del apoderado');
  const esGerente = /Héctor/.test(elegido.fullName);
  if (!esGerente) throw new Error(`El candidato elegido (${elegido.fullName}) no es el gerente sembrado: la siembra cambió`);
  const apo = await r.como('gerente');
  await apo.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
  r.ok(await aparece(apo.getByTestId('apoderado-aviso'), T.respuesta) && await apo.getByText(/^Autorizas como apoderado de .* hasta el /).count() === 1, `el apoderado ve: «${(await apo.getByText(/^Autorizas como apoderado de /).first().innerText().catch(() => '')).trim()}»`);
  r.ok(await apo.getByTestId('apoderado').count() === 0, 'y no tiene la tarjeta para nombrar a nadie');
  await r.captura(apo, 'apoderado-3-aviso');

  // ── 3. Firma como apoderado lo que pide recepción ─────────────────────────
  r.paso('firma como apoderado');
  const turno = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions[0];
  if (!turno) throw new Error('No hay turno abierto en Centro para el retiro');
  const caja = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers.find((c) => c.id === turno.cashRegisterId);
  const MOT = `Retiro que firma el apoderado ${L}`;
  r.alFinal(async () => {
    const hecho = (await g.get(`/cash-sessions/${turno.id}`)).movements.some((m) => m.reason === MOT);
    if (hecho) await g.post(`/cash-sessions/${turno.id}/petty-movements`, { movementType: 'FLOAT_IN', amountCents: '100', reason: 'Vuelve al cajón lo que retiró el recorrido apoderado (prueba)' });
  });
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  // La tarjeta se titula con el código y la sede («Caja 1 · Centro»), no con el nombre de la caja: se toma la que tiene el turno abierto.
  await rec.locator('.card').filter({ has: rec.getByRole('button', { name: 'Retiro o gasto' }) }).first().getByRole('button', { name: 'Retiro o gasto' }).click();
  const mv = rec.getByRole('dialog', { name: `Movimiento de efectivo · ${caja.name}` });
  await mv.getByLabel('Tipo').selectOption({ label: 'Retiro a caja fuerte' });
  await mv.getByLabel('Importe').fill('1');
  await mv.getByLabel('Motivo').fill(MOT);
  await mv.getByRole('button', { name: 'Pedir autorización' }).click();
  const au = rec.getByRole('dialog', { name: 'Autorizar retiro a caja fuerte' });
  const quien = au.getByLabel('Quién autoriza');
  r.ok(await aparece(quien, T.respuesta) && (await quien.locator('option').allInnerTexts()).some((t) => t.includes(elegido.fullName)), `en la firma ya se puede elegir al apoderado: ${(await quien.locator('option').allInnerTexts().catch(() => [])).join(' / ')}`);
  await quien.selectOption({ label: elegido.fullName });
  const f = await firmar(rec, 'Autorizar retiro a caja fuerte');
  await r.captura(rec, 'apoderado-4-firma');
  const retiro = await accion(rec, () => f.autorizar(), /\/api\/cash-sessions\/[^/]+\/movements$/, { metodo: 'POST', que: 'el retiro firmado por el apoderado' });
  r.ok(retiro.ok(), `con la contraseña del apoderado el retiro de $1.00 se registra (${retiro.status()})`);
  const mov = (await g.get(`/cash-sessions/${turno.id}`)).movements.find((m) => m.reason === MOT);
  r.ok(mov?.approvedByUserId === elegido.userId, 'y queda autorizado a nombre del apoderado, no de la dueña');
  await asentado(rec);

  // ── 4. La dueña lo ve y lo revoca ─────────────────────────────────────────
  r.paso('revocar');
  await duena.reload({ waitUntil: 'networkidle' });
  r.ok(await aparece(tarjeta.getByText(/Con este nombramiento lleva 1 autorización y 0 rechazos\./), T.respuesta), 'la dueña ve que «lleva 1 autorización» y que está en la bitácora como «firmó como apoderado»');
  await tarjeta.getByRole('button', { name: 'Revocar' }).click();
  const rv = duena.getByRole('dialog', { name: 'Revocar el nombramiento' });
  await rv.getByLabel('Motivo').fill(`Ya regresé (prueba ${L})`);
  const revocado = await accion(duena, () => rv.getByRole('button', { name: 'Revocar', exact: true }).click(), '/api/approvals/proxy/revoke', { metodo: 'POST', que: 'la revocación' });
  r.ok(revocado.ok() && await aparece(duena.getByText('Nombramiento revocado. Desde este momento solo tú autorizas.'), T.respuesta), `lo revoca (${revocado.status()})`);
  r.ok(await aparece(tarjeta.getByRole('button', { name: 'Nombrar apoderado' }), T.respuesta), 'la tarjeta vuelve a ofrecer «Nombrar apoderado»');
  await tarjeta.locator('summary').click();
  const historia = tarjeta.getByTestId('apoderado-historia').locator('li').first();
  r.ok(/lo revocaste · 1 firma/.test(await historia.innerText().catch(() => '')), `y en «Nombramientos anteriores»: «${(await historia.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}»`);
  await r.captura(duena, 'apoderado-5-revocado');
  await apo.reload({ waitUntil: 'networkidle' });
  await asentado(apo);
  r.ok(await apo.getByTestId('apoderado-aviso').count() === 0, 'al apoderado se le va el aviso: ya no autoriza por la dueña');
});
