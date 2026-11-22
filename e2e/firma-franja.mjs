// «Seguir atendiendo» mientras llega una firma a distancia (fase 2, bloque
// 2.10). El gerente de sede pide un retiro al teléfono de la dueña; en vez de
// quedarse mirando el diálogo, lo guarda con «Seguir atendiendo» y la franja
// bajo la barra superior le dice que sigue esperando. La dueña autoriza desde
// su teléfono y la operación sigue sola: la franja dice «listo» y el retiro
// queda en el turno, sin que nadie vuelva a abrir nada. La dueña lo encuentra
// después en «Resueltas hoy».
//
// Datos propios: el retiro lleva un motivo y un importe de esta corrida, y la
// dueña autoriza ESA tarjeta. Si se corta, la solicitud pendiente se cancela.
// Como `remota`, usa el turno de caja que el gerente tiene abierto en pruebas;
// el retiro es de poco más de un peso y al terminar vuelve al cajón (una
// entrada de fondo por lo mismo): el efectivo del turno queda como estaba.
//
// El último paso afirma lo correcto sobre un DEFECTO (2.14-recorridos.md, D1):
// si la dueña autoriza y el retiro NO se puede registrar (no hay tanto
// efectivo), nadie debe decir que la operación se registró. Hoy lo dicen la
// franja y «Resueltas hoy», y ese paso falla hasta que se arregle.
import { recorrido, respuesta, letras, aparece, desaparece, asentado, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

/** Como `pesos()` del panel: «$1,250.00». */
const pesos = (centavos) => `$${(Number(centavos) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

await recorrido('firma-franja', async (r) => {
  const motivo = `Retiro con franja ${letras(4)}`;
  // Un importe pequeño y que casi no se repite: la franja y la tarjeta se reconocen por él.
  const centavos = 101 + Math.floor(Math.random() * 98);
  const pedidas = [];
  const gte = await r.api('gerente');
  /** El turno abierto donde quedó un movimiento con ese motivo (o null). */
  async function turnoCon(texto) {
    for (const s of (await gte.get('/cash-sessions?status=OPEN')).sessions) {
      const t = await gte.get(`/cash-sessions/${s.id}`);
      const mov = t.movements.find((m) => m.reason === texto);
      if (mov) return { id: s.id, mov, esperado: BigInt(t.expectedCashCents) };
    }
    return null;
  }
  r.alFinal(async () => {
    for (const id of pedidas) {
      const s = await gte.get(`/approvals/requests/${id}`).catch(() => null);
      if (s?.status === 'PENDING') await gte.post(`/approvals/requests/${id}/cancel`, {});
    }
    // Lo retirado vuelve al cajón: el turno es de todos los recorridos (`remota`, `escalera`, `caja`).
    const t = await turnoCon(motivo);
    if (t) await gte.post(`/cash-sessions/${t.id}/movements`, { movementType: 'FLOAT_IN', amountCents: String(-BigInt(t.mov.amountCents)), reason: `Vuelve al cajón: ${motivo}` });
  });

  const ger = await r.como('gerente');
  const tel = await r.como('duena', { movil: true, deviceScaleFactor: 1 });
  /** El gerente pide el retiro al teléfono de la dueña y queda esperando. */
  async function pedirAlTelefono(cuanto, porque) {
    await ger.getByRole('button', { name: 'Retiro o gasto' }).first().click();
    let d = ger.getByRole('dialog');
    await d.getByLabel('Importe').fill((cuanto / 100).toFixed(2));
    await d.getByLabel('Motivo').fill(porque);
    await d.getByRole('button', { name: 'Pedir autorización' }).click();
    d = ger.getByRole('dialog');
    await d.getByRole('button', { name: 'Pedir a su teléfono' }).click();
    const creada = respuesta(ger, '/api/approvals/requests', { metodo: 'POST', que: 'la solicitud de firma' });
    await d.getByRole('button', { name: 'Pedir autorización' }).click();
    const solicitud = await (await creada).json();
    pedidas.push(solicitud.id);
    await d.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
    return { d, solicitud };
  }
  /** La dueña autoriza ESA tarjeta con su contraseña. */
  async function autorizar(porque, cuanto) {
    await tel.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
    const tarjeta = tel.locator('.card').filter({ hasText: porque });
    await tarjeta.waitFor({ timeout: T.respuesta });
    const conImporte = await tarjeta.getByText(pesos(cuanto)).count() > 0;
    await tarjeta.getByRole('button', { name: 'Autorizar', exact: true }).click();
    await tel.getByLabel('Tu contraseña').fill(CLAVE_PRUEBAS);
    await tel.getByRole('dialog').getByRole('button', { name: 'Autorizar' }).click();
    return { conImporte, autorizado: await aparece(tel.getByText(/^Autorizado\. La operación se completa/), T.respuesta) };
  }
  const franjas = ger.getByRole('region', { name: 'Autorizaciones que estás esperando' });
  const franjaDe = (cuanto) => franjas.getByRole('status').filter({ hasText: pesos(cuanto) });
  const limpio = (t) => t.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  /** La fila de «Resueltas hoy» con ese motivo (cada resuelta es un hijo directo de la lista: no tiene rol ni testid propios). */
  async function resuelta(porque) {
    await tel.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
    await tel.getByRole('tab', { name: /Resueltas hoy/ }).click();
    const lista = tel.getByTestId('resueltas');
    await lista.waitFor({ timeout: T.respuesta });
    await asentado(tel);
    const fila = lista.locator(':scope > *').filter({ hasText: porque }).first();
    return (await aparece(fila, T.respuesta)) ? limpio(await fila.innerText()) : '';
  }

  // 1. El gerente pide el retiro al teléfono de la dueña.
  r.paso('pedir la firma a distancia');
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const { d, solicitud } = await pedirAlTelefono(centavos, motivo);
  r.ok(/Vence en \d+:\d{2}/.test(limpio(await d.innerText())), 'el gerente pide la firma a distancia y ve la cuenta regresiva');
  await r.captura(ger, 'firma-franja-1-esperando');

  // 2. «Seguir atendiendo»: el diálogo se guarda y queda la franja.
  r.paso('seguir atendiendo');
  await d.getByRole('button', { name: 'Seguir atendiendo' }).click();
  r.ok(await desaparece(ger.getByRole('dialog').first(), T.ui), '«Seguir atendiendo» guarda el diálogo');
  const franja = franjaDe(centavos);
  r.ok(await aparece(franja.filter({ hasText: 'esperando a' }), T.ui), `la franja dice que sigue esperando: «${limpio(await franja.first().innerText().catch(() => ''))}»`);
  r.ok((await gte.get(`/approvals/requests/${solicitud.id}`)).status === 'PENDING', 'la solicitud sigue viva (guardar el diálogo no la cancela)');
  await r.captura(ger, 'firma-franja-2-franja');

  // 3. La dueña la autoriza desde su teléfono.
  r.paso('la dueña autoriza en su teléfono');
  const firma = await autorizar(motivo, centavos);
  r.ok(firma.conImporte, 'a la dueña le llega con su motivo y su importe');
  r.ok(firma.autorizado, 'la dueña autoriza con su contraseña');

  // 4. En el mostrador la operación sigue sola.
  r.paso('la operación sigue sola');
  r.ok(await aparece(franja.filter({ hasText: 'listo:' }), T.respuesta), `la franja cambia a «listo»: «${limpio(await franja.first().innerText().catch(() => ''))}»`);
  r.ok(await aparece(ger.getByText(motivo).first(), T.respuesta), 'y el retiro queda en el turno sin volver a abrir nada');
  r.ok(await ger.getByRole('dialog').count() === 0, 'sin que el diálogo se vuelva a abrir');
  await r.captura(ger, 'firma-franja-3-listo');
  const final = await gte.get(`/approvals/requests/${solicitud.id}`);
  const turno = await turnoCon(motivo);
  r.ok(final.status === 'APPROVED' && final.seenAt !== null && turno !== null, `por la API: la solicitud quedó autorizada, guardó que la dueña la tuvo a la vista y el retiro está en el turno (${final.status})`);

  // 5. La dueña la encuentra en «Resueltas hoy».
  r.paso('resueltas hoy');
  const fila = await resuelta(motivo);
  r.ok(/Autorizada/.test(fila), '«Resueltas hoy» la trae como «Autorizada»');
  r.ok(/La operación se registró con esa firma/.test(fila), 'y dice que la operación se registró con esa firma');
  await r.captura(tel, 'firma-franja-4-resueltas');

  // 6. DEFECTO D1 (2.14): autorizada, pero el retiro no cabe en el cajón y no se registra.
  r.paso('autorizada y no se pudo registrar');
  if (!turno) return;
  const motivo2 = `Retiro sin efectivo ${letras(4)}`;
  const centavos2 = Number(turno.esperado) + 1000 + Math.floor(Math.random() * 99);
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  const segunda = await pedirAlTelefono(centavos2, motivo2);
  await segunda.d.getByRole('button', { name: 'Seguir atendiendo' }).click();
  await desaparece(ger.getByRole('dialog').first(), T.ui);
  await autorizar(motivo2, centavos2);
  // La operación se intenta sola y la API la rechaza: el diálogo vuelve con el porqué.
  const rechazo = ger.getByRole('dialog').getByText(/No hay tanto efectivo en la caja/);
  const vioElPorque = await aparece(rechazo, T.respuesta);
  r.ok(vioElPorque && (await turnoCon(motivo2)) === null, `con ${pesos(centavos2)} (más de lo que hay en el cajón) la dueña autoriza, el retiro NO se registra y el mostrador ve por qué`);
  await r.captura(ger, 'firma-franja-5-sin-efectivo');
  const porque = limpio(await rechazo.innerText().catch(() => ''));
  r.ok(vioElPorque && !/centavos/.test(porque), `el porqué se dice en pesos, no en centavos: «${porque}»${/centavos/.test(porque) ? ' (DEFECTO D1b, ver 2.14-recorridos.md)' : ''}`);
  const enFranja = limpio(await franjaDe(centavos2).first().innerText({ timeout: 1_000 }).catch(() => ''));
  r.ok(!/la operación siguió/.test(enFranja), `la franja no dice que la operación siguió${/la operación siguió/.test(enFranja) ? `: «${enFranja}» (DEFECTO D1, ver 2.14-recorridos.md)` : ''}`);
  const fila2 = await resuelta(motivo2);
  await r.captura(tel, 'firma-franja-6-resueltas-sin-registro');
  r.ok(fila2 !== '' && !/La operación se registró con esa firma/.test(fila2), `«Resueltas hoy» no le dice a la dueña que la operación se registró cuando no se registró${/se registró con esa firma/.test(fila2) ? `: «${fila2.slice(0, 220)}» (DEFECTO D1, ver 2.14-recorridos.md)` : ''}`);
}, { erroresDePagina: 'falla' });
