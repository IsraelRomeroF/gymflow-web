// Firma a distancia de un retiro: el gerente de sede lo pide al teléfono de la
// dueña, ella lo autoriza con su contraseña y el retiro se registra solo.
//
// Fase 1.17a: el aviso «Por autorizar · N» se compara con lo que la dueña ya
// tenía pendiente (antes exigía «· 1» y fallaba si otra corrida dejó una
// solicitud abierta); el retiro lleva un motivo propio de la corrida (antes
// «Retiro a distancia de prueba» ya estaba en el turno de corridas anteriores
// y la última comprobación pasaba sola), y la dueña autoriza ESA tarjeta.
import { recorrido, respuesta, letras, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('remota', async (r) => {
  const motivo = `Retiro a distancia de prueba ${letras(4)}`;
  const antes = (await (await r.api('duena')).get('/approvals/inbox')).requests.length;
  if (antes) r.nota(`la dueña ya tenía ${antes} por autorizar antes de esta corrida`);
  const pedidas = [];
  r.alFinal(async () => {
    const gte = await r.api('gerente');
    for (const id of pedidas) {
      const s = await gte.get(`/approvals/requests/${id}`).catch(() => null);
      if (s?.status === 'PENDING') await gte.post(`/approvals/requests/${id}/cancel`, {});
    }
  });

  // 1. El gerente de sede pide el retiro a distancia (recepción ya no retira).
  r.paso('el gerente pide el retiro');
  const rec = await r.como('gerente');
  await rec.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Retiro o gasto' }).first().click();
  let d = rec.getByRole('dialog');
  await d.getByLabel('Importe').fill('150');
  await d.getByLabel('Motivo').fill(motivo);
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  d = rec.getByRole('dialog');
  await d.getByRole('button', { name: 'Pedir a su teléfono' }).click();
  const creada = respuesta(rec, '/api/approvals/requests', { metodo: 'POST', que: 'la solicitud de firma' });
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  pedidas.push((await (await creada).json()).id);
  await d.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
  r.ok(true, 'el gerente envía la solicitud y queda esperando');
  await r.captura(rec, 'remota-1-esperando');

  // 2. El dueño, en su teléfono, la ve y la autoriza (la segunda firma es suya, 2026-10-05).
  r.paso('la dueña autoriza en su teléfono');
  const tel = await r.como('duena', { movil: true, deviceScaleFactor: 1 });
  await tel.getByRole('link', { name: new RegExp(`Por autorizar · ${antes + 1}`) }).waitFor({ timeout: T.respuesta });
  r.ok(true, 'al teléfono del dueño le aparece el aviso');
  await tel.getByRole('link', { name: /Por autorizar/ }).click();
  const tarjeta = tel.locator('.card').filter({ hasText: motivo });
  await tarjeta.getByText('Retirar efectivo').waitFor({ timeout: T.respuesta });
  r.ok(await tarjeta.getByText('$150.00').count() > 0, 've qué se autoriza y por cuánto');
  await r.captura(tel, 'remota-2-bandeja');
  await tarjeta.getByRole('button', { name: 'Autorizar' }).first().click();
  await tel.getByLabel('Tu contraseña').fill(CLAVE_PRUEBAS);
  await tel.getByRole('dialog').getByRole('button', { name: 'Autorizar' }).click();
  await tel.getByText(/^Autorizado\. La operación se completa/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el dueño autoriza con su contraseña');

  // 3. En el mostrador, el retiro se registra solo.
  r.paso('el retiro se registra solo');
  await rec.getByText(motivo).waitFor({ timeout: T.respuesta });
  r.ok(true, 'el retiro queda registrado sin que nadie vuelva al mostrador');
  await r.captura(rec, 'remota-3-hecho');
}, { erroresDePagina: 'ok' });
