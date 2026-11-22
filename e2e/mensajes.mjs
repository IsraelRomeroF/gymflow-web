// Mensajes, la bandeja de salida (fase 2, bloque 2.9): el job `outbound.generate`
// arma la lista; recepción ve la campana con su cuenta, manda uno por WhatsApp
// (pasa a «Mandados hoy»), decide «No mandar» otro con su confirmación, y al
// cobrarle a un socio con el pago vencido su mensaje desaparece solo.
//
// Datos propios: tres socios de la corrida en Centro (dos suspendidos y uno con
// la cuota de hoy vencida). El job se corre a mano contra gymflow_pruebas, SOLO
// `outbound.generate` (no el cierre diario): escribe únicamente en
// `outbound_messages`. La lista enseña 50 por motivo, los más viejos primero:
// los mensajes de la corrida se fechan nueve días atrás (lib/base.mjs, el
// reloj de ESOS registros) para que salgan a la vista haya los que haya.
// Nada sale a internet: wa.me se corta en el navegador.
// Al terminar, lo que quede por mandar de estos socios se descarta por la API.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { recorrido, socioSuspendido, socioEnDiaDeCorte, sql, elegirCaja, asentado, aparece, desaparece, hasta, irPorMenu, PANEL, T } from './lib/index.mjs';

const BACKEND = `${process.env.HOME}/gymflow-backend`;
const ARCHIVOS = new URL('./archivos/', import.meta.url).pathname;

/** Corre SOLO `outbound.generate` para ese gimnasio en gymflow_pruebas (el perfil de pruebas fija la base). */
function generarMensajes(organizationId) {
  mkdirSync(ARCHIVOS, { recursive: true });
  const guion = `${ARCHIVOS}mensajes-generar.mts`;
  writeFileSync(guion, `// Lo escribe e2e/mensajes.mjs en cada corrida: corre solo el job de la bandeja de salida.
import { closeDb } from '${BACKEND}/src/platform/db/client.js';
import { OutboundService } from '${BACKEND}/src/modules/outbound/index.js';
if (!String(process.env.DATABASE_URL).includes('/gymflow_pruebas?')) { console.error('Base equivocada'); process.exit(2); }
const r = await new OutboundService().generar(process.argv[2]!);
console.log('RESULTADO ' + JSON.stringify(r));
await closeDb();
`);
  const salida = execFileSync('bash', ['scripts/perfil.sh', 'pruebas', 'node_modules/.bin/tsx', guion, organizationId],
    { cwd: BACKEND, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const linea = salida.split('\n').find((l) => l.startsWith('RESULTADO '));
  if (!linea) throw new Error(`outbound.generate no dio resultado: ${salida.slice(-300)}`);
  return JSON.parse(linea.slice('RESULTADO '.length));
}

const cuentaDe = (etiqueta) => Number(/Mensajes por mandar: (\d+)/.exec(etiqueta ?? '')?.[1] ?? 0);

await recorrido('mensajes', async (r) => {
  const g = await r.api('gerencia');
  const whats = [];

  // ── 0. Los hechos de la corrida y el job ──────────────────────────────────
  r.paso('preparar socios y generar la lista');
  const aMandar = await socioSuspendido(g, { nombre: 'Marisol' });
  const aDescartar = await socioSuspendido(g, { nombre: 'Rogelio' });
  // El que paga: su cuota de hoy ya marcada como vencida (lo que hace el cierre diario con la mora).
  // Los días 29 a 31 no hay día de corte limpio: se usa otro suspendido, que al pagar se reactiva.
  let aCobrar = await socioEnDiaDeCorte(g, { nombre: 'Leonor' });
  const conVencido = !!aCobrar;
  if (aCobrar) await sql(`update charges set status = 'OVERDUE' where "membershipId" = $1 and status = 'OPEN'`, [aCobrar.membresiaId]);
  else aCobrar = await socioSuspendido(g, { nombre: 'Leonor' });
  const socios = [aMandar, aDescartar, aCobrar];
  const ids = socios.map((s) => s.id);
  r.alFinal(async () => {
    const pendientes = await sql(`select id, "memberId" from outbound_messages where "memberId" = any($1::uuid[]) and status = 'PENDING'`, [ids]);
    for (const m of pendientes) await g.crudo('POST', `/members/${m.memberId}/outbound-messages/mark`, { messageId: m.id, as: 'DISMISSED' });
  });

  const [{ org }] = await sql(`select "organizationId" as org from members where id = $1`, [aMandar.id]);
  const resultado = generarMensajes(org);
  r.ok(resultado.job === 'outbound.generate' && resultado.errors.length === 0, `el job outbound.generate corre sin errores (${resultado.processed} mensajes nuevos${resultado.errors.length ? `; errores: ${JSON.stringify(resultado.errors).slice(0, 200)}` : ''})`);
  const armados = await sql(`select "memberId", kind, status from outbound_messages where "memberId" = any($1::uuid[]) and status = 'PENDING'`, [ids]);
  const motivoDe = (s) => armados.find((m) => m.memberId === s.id)?.kind ?? null;
  r.ok(armados.length === 3 && motivoDe(aMandar) === 'MEMBERSHIP_SUSPENDED' && motivoDe(aDescartar) === 'MEMBERSHIP_SUSPENDED' && motivoDe(aCobrar) === (conVencido ? 'PAYMENT_OVERDUE' : 'MEMBERSHIP_SUSPENDED'),
    `arma un mensaje por socio con su motivo (suspendida, suspendida y ${conVencido ? 'pago vencido' : 'suspendida'}; salieron: ${socios.map(motivoDe).join(', ')})`);
  const otraVez = generarMensajes(org);
  const tras = await sql(`select count(*)::int as n from outbound_messages where "memberId" = any($1::uuid[])`, [ids]);
  r.ok(otraVez.errors.length === 0 && tras[0].n === 3, `correrlo otra vez no duplica nada (${tras[0].n} mensajes de estos tres socios)`);
  // Los más viejos salen primero y la lista corta en 50 por motivo: los de la corrida, al frente.
  await sql(`update outbound_messages set "createdAt" = now() - interval '9 days' where "memberId" = any($1::uuid[]) and status = 'PENDING'`, [ids]);

  // ── 1. Recepción: la campana y la lista ───────────────────────────────────
  r.paso('campana');
  const rec = await r.como('recepcion');
  // Nada sale a internet: lo que iría a WhatsApp se contesta aquí mismo y se anota.
  await rec.context().route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, async (route) => {
    whats.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp (cortado en el recorrido)</p>' });
  });
  const campana = rec.getByTestId('campana-mensajes');
  await campana.waitFor({ timeout: T.respuesta });
  await hasta(rec, () => /Mensajes por mandar: \d+/.test(document.querySelector('[data-testid="campana-mensajes"]')?.getAttribute('aria-label') ?? ''), null, { timeout: T.respuesta, que: 'La cuenta de la campana' });
  const antes = cuentaDe(await campana.getAttribute('aria-label'));
  r.ok(antes >= 3, `recepción ve la campana con su cuenta («Mensajes por mandar: ${antes}»)`);
  await campana.click();
  const panel = rec.getByTestId('campana-panel');
  await panel.waitFor({ timeout: T.ui });
  r.ok(/suspendid/i.test(await panel.innerText()), `la campana dice de qué son (${(await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 140)})`);
  await r.captura(rec, 'mensajes-1-campana');
  await panel.getByRole('link', { name: 'Ir a Mensajes' }).click();
  await rec.waitForURL('**/mensajes', { timeout: T.navegacion });
  await rec.getByRole('heading', { name: 'Mensajes', exact: true }).waitFor({ timeout: T.navegacion });
  r.ok(await aparece(rec.getByTestId('mensaje').first(), T.respuesta) && await rec.getByTestId('campana-panel').count() === 0, '«Ir a Mensajes» abre la lista y cierra la campana');

  const fila = (s) => rec.getByTestId('mensaje').filter({ hasText: s.lastName });
  const enMandados = (s) => rec.getByTestId('mandados-hoy').getByRole('listitem').filter({ hasText: s.lastName });
  await fila(aMandar).waitFor({ timeout: T.respuesta });
  r.ok(await fila(aMandar).count() === 1 && await fila(aDescartar).count() === 1 && await fila(aCobrar).count() === 1, 'los tres socios de la corrida tienen su mensaje en la lista');
  const texto = (await fila(aMandar).getByRole('paragraph').innerText()).trim();
  r.ok(texto.startsWith(`Hola ${aMandar.firstName}`) && /suspendi/i.test(texto), `el mensaje ya viene escrito, con su nombre y su motivo («${texto.slice(0, 90)}…»)`);
  await r.captura(rec, 'mensajes-2-lista');

  // ── 2. Mandar por WhatsApp ────────────────────────────────────────────────
  r.paso('mandar por WhatsApp');
  const [popup] = await Promise.all([
    rec.context().waitForEvent('page', { timeout: T.respuesta }),
    fila(aMandar).getByRole('link', { name: 'Mandar por WhatsApp' }).click(),
  ]);
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  const celular = aMandar.phoneE164.replace(/\D/g, '');
  const enlace = whats.find((u) => u.includes(celular.slice(-10))) ?? '';
  r.ok(whats.length === 1 && /^https:\/\/wa\.me\/\d{10,13}\?text=/.test(enlace), `el toque abre wa.me con su celular (${enlace.slice(0, 60)}…), y el recorrido lo corta`);
  r.ok(decodeURIComponent(enlace.split('?text=')[1] ?? '') === texto, 'el enlace lleva el mismo texto de la fila');
  await popup.close();
  r.ok(await aparece(enMandados(aMandar), T.respuesta) && await desaparece(fila(aMandar), T.respuesta), `${aMandar.firstName} pasa de la lista a «Mandados hoy»`);
  r.ok(/Membresía suspendida · \d{1,2}:\d{2}.* · \S+/.test(await enMandados(aMandar).innerText()), `«Mandados hoy» dice el motivo, la hora y quién lo mandó (${(await enMandados(aMandar).innerText()).replace(/\n+/g, ' | ').slice(0, 110)})`);
  const baja = await hasta(rec, (n) => { const m = /(\d+)/.exec(document.querySelector('[data-testid="campana-mensajes"]')?.getAttribute('aria-label') ?? ''); return !!m && Number(m[1]) < n; }, antes, { timeout: T.respuesta, que: 'La campana tras mandar' }).then(() => true, () => false);
  r.ok(baja, `la campana baja sin recargar (de ${antes} a ${cuentaDe(await campana.getAttribute('aria-label'))})`);
  const [mandado] = await sql(`select status, body, "resolvedByUserId" is not null as quien from outbound_messages where "memberId" = $1`, [aMandar.id]);
  r.ok(mandado.status === 'SENT' && mandado.body === texto && mandado.quien, 'queda anotado como mandado, con el texto que se mandó y quién lo hizo');
  await r.captura(rec, 'mensajes-3-mandado');

  // ── 3. No mandar, con su confirmación ─────────────────────────────────────
  r.paso('no mandar');
  await asentado(rec);
  await fila(aDescartar).getByRole('button', { name: 'No mandar' }).click();
  const dlg = rec.getByRole('dialog', { name: `¿No mandarle este mensaje a ${aDescartar.firstName}?` });
  r.ok(await aparece(dlg, T.ui) && (await dlg.innerText()).includes(`Hola ${aDescartar.firstName}`), '«No mandar» pide confirmar, nombra al socio y enseña el mensaje');
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await fila(aDescartar).count() === 1, 'cancelar lo deja en la lista');
  await fila(aDescartar).getByRole('button', { name: 'No mandar' }).click();
  await r.captura(rec, 'mensajes-4-no-mandar');
  await dlg.getByRole('button', { name: 'No mandar' }).click();
  r.ok(await desaparece(fila(aDescartar), T.respuesta) && await enMandados(aDescartar).count() === 0, 'confirmar lo quita de la lista, sin pasarlo a «Mandados hoy»');
  r.ok(whats.length === 1, 'y no abre WhatsApp');

  // ── 4. Cobrarle: su mensaje deja de hacer falta ───────────────────────────
  r.paso('cobrar y que el mensaje desaparezca');
  await asentado(rec);
  await fila(aCobrar).getByRole('link', { name: new RegExp(aCobrar.lastName) }).click();
  await rec.waitForURL(`**/socios/${aCobrar.id}`, { timeout: T.navegacion });
  await rec.getByRole('tab', { name: /Estado de cuenta/ }).click();
  await rec.getByRole('button', { name: 'Cobrar', exact: true }).first().click();
  const cobro = rec.getByRole('dialog');
  await cobro.getByRole('button', { name: /^Cobrar \$/ }).waitFor({ timeout: T.respuesta });
  await asentado(rec);
  await elegirCaja(cobro);
  await cobro.getByRole('button', { name: /^Cobrar \$/ }).click();
  await rec.getByText('Cobro registrado').waitFor({ timeout: T.respuesta });
  r.ok(true, `recepción le cobra a ${aCobrar.firstName} desde su ficha`);
  await rec.getByRole('button', { name: 'Listo' }).click();
  await irPorMenu(rec, 'Mensajes');
  await rec.waitForURL('**/mensajes', { timeout: T.navegacion });
  await rec.getByRole('heading', { name: 'Mensajes', exact: true }).waitFor({ timeout: T.navegacion });
  await enMandados(aMandar).waitFor({ timeout: T.respuesta });
  await asentado(rec);
  r.ok(await fila(aCobrar).count() === 0 && await enMandados(aCobrar).count() === 0, 'al pagar, su mensaje desaparece de la lista sin que nadie lo toque');
  r.ok(await enMandados(aMandar).count() === 1 && await fila(aDescartar).count() === 0, 'lo mandado sigue en «Mandados hoy» y lo descartado no vuelve');
  await r.captura(rec, 'mensajes-5-tras-cobrar');
  // El job siguiente lo cierra en la base, y no le arma otro.
  const cierre = generarMensajes(org);
  const fin = await sql(`select "memberId", status, "closeReason" from outbound_messages where "memberId" = any($1::uuid[])`, [ids]);
  const de = (s) => fin.filter((m) => m.memberId === s.id);
  r.ok(cierre.errors.length === 0 && de(aCobrar).length === 1 && de(aCobrar)[0].status === 'EXPIRED' && de(aDescartar).length === 1 && de(aDescartar)[0].status === 'DISMISSED',
    `la siguiente corrida del job cierra el del que pagó y no vuelve a armar el descartado (${fin.map((m) => `${m.status}${m.closeReason ? `/${m.closeReason}` : ''}`).join(', ')})`);
}, { erroresDePagina: 'falla' });
