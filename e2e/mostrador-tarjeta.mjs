// La tarjeta del socio en el mostrador (fase 2, bloques 2.1 y 2.13).
// Recepción busca a un socio en su Inicio y lo atiende ahí mismo, sin pasar
// por la ficha: sale su tarjeta con lo que debe y «Cobrar $…»; se cobra y la
// tarjeta queda al corriente. Con un suspendido que tiene dinero a favor que
// cubre lo que debe, la tarjeta no ofrece cobrar: «Entrada» → «No puede
// pasar» → «Aplicar su saldo a favor y abrir» → puede pasar y queda al
// corriente, sin cobrarle nada. Y el Inicio del gerente trae «Hoy te toca».
//
// Datos propios: los dos suspendidos son de esta corrida (lib/datos.mjs). No
// cambia nada compartido: un cobro por transferencia (no toca ningún turno de
// caja) y una entrada.
import { recorrido, socioSuspendido, socioSuspendidoConSaldoAFavor, motivoDeExcepcion, accion, asentado, aparece, sufijo, T } from './lib/index.mjs';

/** Como `pesos()` del panel: «$1,250.00». */
const pesos = (centavos) => `$${(centavos / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

await recorrido('mostrador-tarjeta', async (r) => {
  const g = await r.api('gerencia');
  const deudor = await socioSuspendido(g, { sede: 'CEN', mesesAtras: 0 });
  const conSaldo = await socioSuspendidoConSaldoAFavor(g, { sede: 'CEN', sobra: 5000 });
  const debe = BigInt((await g.get(`/members/${deudor.id}`)).balanceCents);
  r.ok(debe > 0n && conSaldo.aFavorCents > conSaldo.debeCents, `datos de la corrida: ${deudor.memberCode} debe ${pesos(Number(debe))}; ${conSaldo.memberCode} debe ${pesos(conSaldo.debeCents)} y tiene ${pesos(conSaldo.aFavorCents)} a favor`);

  const rec = await r.como('recepcion');
  const buscador = rec.getByTestId('buscar-inicio');
  const tarjeta = rec.getByTestId('tarjeta-socio');
  const buscar = async (socio) => {
    await buscador.getByLabel('Buscar socio').fill(socio.memberCode);
    await rec.locator(`[data-testid="tarjeta-socio"][data-socio="${socio.memberCode}"]`).waitFor({ timeout: T.respuesta });
    await asentado(rec);
  };

  // ── 1. Buscar en el Inicio: sale su tarjeta, con lo que debe y «Cobrar $…» ──
  r.paso('la tarjeta del que debe');
  await buscador.waitFor({ timeout: T.respuesta });
  await buscar(deudor);
  r.ok(new URL(rec.url()).pathname === '/panel', 'recepción busca en su Inicio y la tarjeta del socio sale ahí mismo');
  r.ok(await tarjeta.getByRole('heading', { name: `${deudor.firstName} ${deudor.lastName}` }).count() === 1, 'la tarjeta lleva su nombre');
  const dinero = tarjeta.getByTestId('tarjeta-dinero');
  r.ok(await aparece(dinero.getByText(`debe ${pesos(Number(debe))}`), T.respuesta), `la línea de dinero dice «debe ${pesos(Number(debe))}»`);
  const cobrar = tarjeta.getByRole('button', { name: /^Cobrar \$/ });
  r.ok(await aparece(cobrar, T.respuesta) && (await cobrar.innerText()).includes(pesos(Number(debe))), `y trae el botón «Cobrar ${pesos(Number(debe))}»`);
  r.ok(await tarjeta.getByRole('button', { name: 'Entrada', exact: true }).count() === 1 && await tarjeta.getByRole('link', { name: /Ver su ficha/ }).count() === 1, 'con «Entrada» y «Ver su ficha» a la mano');
  await r.captura(rec, 'mostrador-tarjeta-1-debe');

  // ── 2. Cobrar desde la tarjeta ────────────────────────────────────────────
  r.paso('cobrar desde la tarjeta');
  await cobrar.click();
  const dlg = rec.getByRole('dialog', { name: `Cobrar a ${deudor.firstName}` });
  await dlg.waitFor({ timeout: T.ui });
  await asentado(rec);
  // Por transferencia: no depende de qué turnos de caja haya abiertos hoy.
  await dlg.getByText('Transferencia', { exact: true }).click();
  await dlg.getByLabel('Referencia de la transferencia').fill(`REC${sufijo().toUpperCase()}`);
  r.ok(await aparece(dlg.getByText('Con este cobro queda al corriente y puede entrar.'), T.ui), 'antes de cobrar dice que con ese cobro queda al corriente');
  const pago = await accion(rec, () => dlg.getByRole('button', { name: /^Cobrar \$/ }).click(), `/api/members/${deudor.id}/payments`, { metodo: 'POST', que: 'el cobro desde la tarjeta' });
  r.ok(pago.status() === 201 || pago.status() === 200, `el cobro se registra (${pago.status()})`);
  const hecho = rec.getByRole('dialog', { name: 'Cobro registrado' });
  r.ok(await aparece(hecho.getByText(`${deudor.firstName} ya puede entrar`), T.respuesta), `«${deudor.firstName} ya puede entrar»`);
  await r.captura(rec, 'mostrador-tarjeta-2-cobrado');
  await hecho.getByRole('button', { name: 'Listo' }).click();
  // La tarjeta sigue ahí, ya sin deuda: no hay que volver a buscarlo.
  r.ok(await aparece(dinero.getByText(/no debe nada/), T.respuesta), 'la tarjeta sigue a la vista y ahora dice «no debe nada»');
  r.ok(await tarjeta.getByRole('button', { name: /^Cobrar/ }).count() === 0, 'y ya no ofrece cobrar');
  r.ok((await g.get(`/members/${deudor.id}`)).balanceCents === '0', 'por la API: su saldo quedó en cero');

  // ── 3. Suspendido con saldo a favor que cubre su deuda ────────────────────
  r.paso('saldo a favor en la puerta');
  await buscar(conSaldo);
  r.ok(await aparece(dinero.getByText(`${pesos(conSaldo.aFavorCents - conSaldo.debeCents)} a favor`), T.respuesta), `su tarjeta dice «${pesos(conSaldo.aFavorCents - conSaldo.debeCents)} a favor»`);
  r.ok(await tarjeta.getByRole('button', { name: /^Cobrar/ }).count() === 0, 'y no ofrece cobrarle: no hay nada que cobrar');
  await tarjeta.getByRole('button', { name: 'Entrada', exact: true }).click();
  await motivoDeExcepcion(rec);
  const entrada = rec.getByRole('dialog', { name: `Entrada · ${conSaldo.firstName}` });
  r.ok(await aparece(entrada.getByText('No puede pasar'), T.respuesta), 'la puerta lo rechaza: «No puede pasar»');
  r.ok(await aparece(entrada.getByText('Lo que tiene a favor cubre lo que debe'), T.ui), 'y dice que lo que tiene a favor cubre lo que debe');
  r.ok(await entrada.getByRole('button', { name: /^Cobrar .* y abrir$/ }).count() === 0, 'sin «Cobrar y abrir»');
  await r.captura(rec, 'mostrador-tarjeta-3-rechazo-con-saldo');
  const aplicar = entrada.getByTestId('aplicar-saldo-y-abrir');
  r.ok(await aplicar.count() === 1 && (await aplicar.innerText()).trim() === 'Aplicar su saldo a favor y abrir', 'ofrece «Aplicar su saldo a favor y abrir»');
  const aplicado = await accion(rec, () => aplicar.click(), `/api/members/${conSaldo.id}/credit/apply`, { metodo: 'POST', que: 'aplicar el saldo a favor' });
  r.ok(aplicado.ok(), `el saldo se aplica (${aplicado.status()})`);
  const resuelto = entrada.getByTestId('rechazo-resuelto');
  r.ok(await aparece(resuelto, T.respuesta) && /Se aplicaron \$[\d,.]+ de su saldo a favor\. Puede pasar\./.test(await resuelto.innerText()), `«${(await resuelto.innerText().catch(() => '')).split('\n')[0]}»`);
  const texto = await resuelto.innerText().catch(() => '');
  r.ok(/No se cobró nada\./.test(texto) && texto.includes(`Le quedan ${pesos(conSaldo.aFavorCents - conSaldo.debeCents)} a favor.`), `no se cobró nada y le quedan ${pesos(conSaldo.aFavorCents - conSaldo.debeCents)} a favor`);
  r.ok(/Quedó al corriente/.test(texto), 'y «Quedó al corriente»: la próxima vez entra sin pasar por aquí');
  await r.captura(rec, 'mostrador-tarjeta-4-saldo-aplicado');
  await entrada.getByRole('button', { name: /^Listo/ }).click();
  await entrada.waitFor({ state: 'hidden', timeout: T.ui });
  const despues = await g.get(`/members/${conSaldo.id}`);
  r.ok(despues.balanceCents === String(-(conSaldo.aFavorCents - conSaldo.debeCents)), `por la API: ya no debe y conserva lo que sobró (saldo ${despues.balanceCents})`);
  const entradas = await g.get(`/access/decisions?memberId=${conSaldo.id}&outcome=GRANTED&limit=1`);
  r.ok(entradas.decisions.length === 1, 'y su entrada quedó registrada');

  // ── 4. El Inicio del gerente: «Hoy te toca» ───────────────────────────────
  r.paso('hoy te toca');
  const ger = await r.como('gerente');
  const toca = ger.getByTestId('hoy-te-toca');
  await toca.waitFor({ timeout: T.respuesta });
  await asentado(ger);
  r.ok(await toca.getByText('Hoy te toca', { exact: true }).count() === 1, 'el Inicio del gerente trae «Hoy te toca»');
  const asuntos = await toca.locator('[data-asunto]').count();
  r.ok(asuntos > 0 || await toca.getByText('Todo al día').count() === 1, asuntos > 0 ? `con ${asuntos} asunto(s) por resolver` : 'con «Todo al día» (nada pendiente)');
  r.ok(await ger.getByTestId('cifras-de-hoy').count() === 1, 'y las cifras de hoy');
  await r.captura(ger, 'mostrador-tarjeta-5-hoy-te-toca');
}, { erroresDePagina: 'falla' });
