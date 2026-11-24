// Las reglas de la entrada (fase 3, bloque 3.3 · D-06, D-07 y D-08), en el navegador:
//
//  1. Pase de prueba: alguien con celular y sin plan entra una vez con «Pase de
//     prueba (gratis)»; otra ficha con el MISMO celular ya no lo tiene, y la
//     pantalla dice por qué.
//  2. «Entrar solo con rostro»: la gerencia ve cuántos faltan y quiénes, y la
//     enciende con motivo.
//  3. Reentrada: la segunda entrada del mismo día de un socio al corriente dice
//     «Ya había entrado hoy: esta reentrada no cuenta otra visita ni descuenta»,
//     también con la regla encendida y sin rostro.
//  4. Recepción registra la entrada de un socio al
//     corriente sin rostro: «No puede pasar: falta su rostro», sin «Dejar
//     pasar». El gerente la autoriza desde «Por resolver en la puerta» y el
//     diálogo de recepción sigue solo. La gerencia apaga la regla.
//
// Datos propios: cuatro socios «Zavala…» de la corrida en Centro. Lo único
// compartido que cambia es la regla del rostro del gimnasio: llega apagada, se
// enciende en el paso 2 y se apaga al terminar (también si el recorrido se cae).
import { recorrido, crearSocio, socioAlCorriente, sedeDe, celular, motivoDeExcepcion, accion, asentado, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('entrada-reglas', async (r) => {
  const g = await r.api('gerencia');
  const cen = await sedeDe(g, 'CEN');
  const apagar = async (motivo) => { if ((await g.get('/access/face-rule')).enabled) { await g.put('/access/face-rule', { enabled: false, reason: motivo }); return true; } return false; };
  if (await apagar('Empieza el recorrido entrada-reglas (prueba)')) r.nota('la regla del rostro estaba encendida (una corrida que no terminó): se apagó antes de empezar');
  r.alFinal(() => apagar('Termina el recorrido entrada-reglas (prueba)'));

  const reentra = await socioAlCorriente(g, { sede: 'CEN' });
  const sinRostro = await socioAlCorriente(g, { sede: 'CEN' });
  const tel = celular();
  const prueba = await crearSocio(g, { sede: 'CEN', telefono: tel });
  const repite = await crearSocio(g, { sede: 'CEN', telefono: tel, responsable: { kind: 'MEMBER', memberId: prueba.id } });
  r.nota(`socios de la corrida: ${reentra.memberCode} (reentrada), ${sinRostro.memberCode} (sin rostro), ${prueba.memberCode} y ${repite.memberCode} (mismo celular, sin plan)`);

  const rec = await r.como('recepcion');
  /** Busca al socio en el Inicio de recepción y pulsa «Entrada» en su tarjeta. Devuelve el diálogo. */
  async function entrada(socio) {
    await rec.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
    await rec.getByTestId('buscar-inicio').getByLabel('Buscar socio').fill(socio.memberCode);
    const tarjeta = rec.locator(`[data-testid="tarjeta-socio"][data-socio="${socio.memberCode}"]`);
    await tarjeta.waitFor({ timeout: T.respuesta });
    await tarjeta.getByRole('button', { name: 'Entrada', exact: true }).click();
    await motivoDeExcepcion(rec);
    return rec.getByRole('dialog', { name: `Entrada · ${socio.firstName}` });
  }

  // La primera entrada del día de quien después reentra. La reentrada va más
  // abajo, con la regla del rostro ya encendida: la puerta no acepta dos pasos
  // del mismo socio en ocho segundos («Doble paso»), y entre una y otra pasan
  // los pasos del pase de prueba y de la regla.
  r.paso('primera entrada del día');
  let d = await entrada(reentra);
  await rec.getByTestId('vigencia-entrada').waitFor({ timeout: T.respuesta });
  const primeraA = Date.now();
  r.ok(await d.getByTestId('entrada-reentrada').count() === 0, 'la primera entrada del día no dice «reentrada»');
  await d.waitFor({ state: 'hidden', timeout: T.ui });

  // ── 1. Pase de prueba ─────────────────────────────────────────────────────
  r.paso('pase de prueba');
  d = await entrada(prueba);
  const pase = d.getByTestId('pase-de-prueba');
  r.ok(await aparece(pase, T.respuesta), 'a quien no tiene plan y trae celular se le ofrece «Pase de prueba (gratis)»');
  r.ok(await aparece(d.getByText('¿Viene a probar? Tiene un pase de prueba gratis, una sola vez.'), T.ui), 'y dice que es una sola vez');
  await r.captura(rec, 'entrada-reglas-1-pase');
  const dado = await accion(rec, () => pase.click(), /\/api\/members\/[^/]+\/trial-pass$/, { metodo: 'POST', que: 'el pase de prueba' });
  r.ok(dado.ok(), `el pase se da (${dado.status()})`);
  r.ok(await aparece(d.getByText(`${prueba.firstName} entra hoy con su pase de prueba.`), T.respuesta), `y la entrada queda registrada: «${prueba.firstName} entra hoy con su pase de prueba.»`);
  r.ok((await d.innerText()).includes(`celular terminado en ${tel.slice(-4)}`), `dice que es su único pase y con qué celular (terminado en ${tel.slice(-4)})`);
  await r.captura(rec, 'entrada-reglas-2-pase-dado');

  d = await entrada(repite);
  const no = d.getByTestId('pase-de-prueba-no');
  r.ok(await aparece(no, T.respuesta), `otra ficha con el mismo celular ya no tiene pase, y dice por qué: «${(await no.innerText().catch(() => '')).trim()}»`);
  r.ok(await d.getByTestId('pase-de-prueba').count() === 0, 'sin botón de pase de prueba');
  await r.captura(rec, 'entrada-reglas-3-pase-usado');

  // ── 2. «Entrar solo con rostro» ───────────────────────────────────────────
  r.paso('encender la regla del rostro');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/biometria`, { waitUntil: 'networkidle' });
  const regla = ger.getByTestId('bio-regla');
  await regla.getByTestId('bio-regla-sedes').waitFor({ timeout: T.respuesta });
  const api = await g.get('/access/face-rule');
  const centro = api.branches.find((b) => b.branchId === cen.id);
  r.ok(await regla.getByText('Apagada', { exact: true }).count() === 1, 'la regla llega «Apagada»');
  r.ok((await regla.getByTestId('bio-regla-sedes').innerText()).replace(/\s+/g, ' ').includes(`Centro: sin rostro ${centro.withoutFace} de ${centro.canEnter}`), `dice cuántos faltan en Centro (${centro.withoutFace} de ${centro.canEnter}), como la API`);
  await regla.getByTestId('bio-regla-sedes').getByRole('button', { name: 'ver quiénes' }).first().click();
  const quienes = ger.getByRole('dialog', { name: /^Sin rostro · / });
  r.ok(await aparece(quienes.getByTestId('bio-regla-faltan').locator('li').first(), T.respuesta), `«ver quiénes» abre la lista (${await quienes.getByTestId('bio-regla-faltan').locator('li').count()} a la vista)`);
  await quienes.getByRole('button', { name: 'Cerrar' }).last().click();
  await regla.getByTestId('bio-regla-cambiar').click();
  const enc = ger.getByRole('dialog', { name: 'Encender «entrar solo con rostro»' });
  const total = api.branches.reduce((a, b) => a + b.withoutFace, 0);
  r.ok(await aparece(enc.getByText(`${total} socios que hoy entran no tienen su rostro`), T.ui), `antes de encender avisa: «${total} socios que hoy entran no tienen su rostro»`);
  await enc.getByTestId('bio-regla-confirmar').click();
  r.ok(await aparece(enc.getByText('Escribe el motivo del cambio.'), T.ui), 'sin motivo no se enciende');
  await enc.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Ya se registran rostros en recepción' }).click();
  await r.captura(ger, 'entrada-reglas-5-encender');
  const puesta = await accion(ger, () => enc.getByTestId('bio-regla-confirmar').click(), '/api/access/face-rule', { metodo: 'PUT', que: 'encender la regla' });
  r.ok(puesta.ok() && await aparece(regla.getByText('Encendida', { exact: true }), T.respuesta), `con motivo queda «Encendida» (${puesta.status()})`);

  // ── 3. Reentrada del mismo día (con la regla encendida y sin rostro) ──────
  r.paso('reentrada');
  // El «doble paso» dura ocho segundos desde la primera entrada: si los pasos de en medio fueron más rápidos, se espera lo que falte (es una regla del producto, con su cifra).
  const falta8 = 9000 - (Date.now() - primeraA);
  if (falta8 > 0) await new Promise((ok) => setTimeout(ok, falta8));
  d = await entrada(reentra);
  r.ok(await aparece(d.getByTestId('entrada-reentrada'), T.respuesta), 'la segunda del mismo día: «Ya había entrado hoy: esta reentrada no cuenta otra visita ni descuenta.»');
  r.ok(await d.getByTestId('entrada-sin-rostro').count() === 0, 'y con la regla encendida la reentrada de quien no tiene rostro no pide autorización: ya había entrado');
  await r.captura(rec, 'entrada-reglas-4-reentrada', { red: false });

  // ── 4. Entrada sin rostro ─────────────────────────────────────────────────
  r.paso('entrada sin rostro');
  d = await entrada(sinRostro);
  const falta = d.getByTestId('entrada-sin-rostro');
  r.ok(await aparece(falta.getByText('No puede pasar: falta su rostro'), T.respuesta), 'recepción registra la entrada de un socio al corriente sin rostro: «No puede pasar: falta su rostro»');
  r.ok(await d.getByRole('button', { name: /^Dejar pasar/ }).count() === 0, 'recepción ya no tiene «Dejar pasar»');
  r.ok(await falta.getByText('Esta entrada solo la autoriza la gerencia').count() === 1, 'y dice que solo la autoriza la gerencia');
  await r.captura(rec, 'entrada-reglas-6-falta-rostro');

  const gte = await r.como('gerente');
  const puerta = gte.getByTestId('por-resolver-puerta');
  await puerta.waitFor({ timeout: T.respuesta });
  const fila = puerta.locator('button.puerta-fila').filter({ hasText: sinRostro.lastName });
  r.ok(await aparece(fila, T.respuesta), 'el gerente lo ve en «Por resolver en la puerta» de su inicio');
  await fila.click();
  const res = gte.getByRole('dialog', { name: /^En la puerta · / });
  await res.getByTestId('sin-rostro-autorizar').click();
  const confirmar = res.getByTestId('sin-rostro-confirmar');
  await confirmar.click();
  r.ok(await aparece(res.getByText('Elige o escribe el motivo: queda en la bitácora.'), T.ui), 'sin motivo no se autoriza');
  await res.getByRole('group', { name: 'De un toque' }).getByRole('button').first().click();
  await r.captura(gte, 'entrada-reglas-7-autorizar');
  const permiso = await accion(gte, () => confirmar.click(), /\/api\/access\/decisions\/[^/]+\/grant$/, { metodo: 'POST', que: 'la autorización de la visita' });
  r.ok(permiso.ok(), `«Autorizar y registrar la entrada» pasa (${permiso.status()})`);
  r.ok(await aparece(res.getByTestId('sin-rostro-autorizada'), T.respuesta), `el gerente ve: «${(await res.getByTestId('sin-rostro-autorizada').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120)}»`);
  // El diálogo de recepción pregunta cada 4 segundos: cambia solo.
  const sola = d.getByTestId('sin-rostro-autorizada');
  r.ok(await aparece(sola, T.respuesta), `y el diálogo de recepción sigue solo: «${(await sola.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120)}»`);
  r.ok(/autorizó la entrada/.test(await sola.innerText().catch(() => '')), 'dice quién autorizó la entrada');
  await r.captura(rec, 'entrada-reglas-8-sigue-sola');

  r.paso('apagar la regla');
  await ger.reload({ waitUntil: 'networkidle' });
  await regla.getByTestId('bio-regla-cambiar').click();
  const apg = ger.getByRole('dialog', { name: 'Apagar «entrar solo con rostro»' });
  await apg.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Todavía no se pueden registrar rostros' }).click();
  const quitada = await accion(ger, () => apg.getByTestId('bio-regla-confirmar').click(), '/api/access/face-rule', { metodo: 'PUT', que: 'apagar la regla' });
  r.ok(quitada.ok() && await aparece(regla.getByText('Apagada', { exact: true }), T.respuesta), `la gerencia la apaga con motivo (${quitada.status()})`);
  r.ok((await g.get('/access/face-rule')).enabled === false, 'y por la API quedó apagada, como llegó');
});
