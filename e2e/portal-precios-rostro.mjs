// El portal de la fase 3 que quedó sin recorrido (bloque 3.10):
//
//  1. «Planes y precios» (Pagos → precios): renovar su plan al precio que tiene,
//     los planes de su sucursal y que se paga en recepción; las cifras son las
//     de la API (`GET /portal/offer`).
//  2. Retirar el rostro desde el teléfono: la hoja dice qué pasa y cómo va a
//     entrar desde hoy; «Sí, retirar» lo retira y la ficha ya no tiene ese permiso.
//
// Socio propio de la corrida, con el permiso del rostro firmado al darlo de
// alta. El motor facial está apagado en las pruebas: no hay plantilla que
// borrar, así que se comprueba el permiso (lo de la plantilla lo cubre el backend).
import { recorrido, accion, aparece, desaparece, invitacionPortal, venderMembresia, letras, celular, PORTAL, T } from './lib/index.mjs';

await recorrido('portal-precios-rostro', async (r) => {
  const g = await r.api('gerencia');
  const [sedes, docs] = await Promise.all([g.get('/branches'), g.get('/consent-documents')]);
  const version = (t) => docs.documents.find((d) => d.consentType === t && d.status === 'PUBLISHED')?.version;
  if (!version('BIOMETRIC')) throw new Error('No hay aviso del rostro publicado en las pruebas');
  const socio = await g.post('/members', {
    firstName: 'Rebeca', lastName: `Zavala ${letras(5)}`, phoneE164: `+52${celular()}`, homeBranchId: sedes.find((b) => b.code === 'CEN').id, force: true,
    consents: ['PRIVACY_NOTICE', 'HOUSE_RULES', 'BIOMETRIC'].map((t) => ({ consentType: t, documentVersion: version(t), granted: true })),
  });
  await venderMembresia(g, socio, { plan: 'MEN' });

  const p = await r.nueva({ movil: true });
  await p.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await p.locator('input').first().fill(await invitacionPortal(g, socio));
  await p.getByRole('button', { name: /Activar/ }).click();
  await p.waitForURL(`${PORTAL}/`, { timeout: T.navegacion });

  // ── 1. Planes y precios ───────────────────────────────────────────────────
  r.paso('planes y precios');
  await p.goto(`${PORTAL}/pagos`, { waitUntil: 'networkidle' });
  await p.getByTestId('ir-a-precios').click();
  await p.waitForURL('**/pagos/precios', { timeout: T.navegacion });
  await p.getByRole('heading', { name: 'Planes y precios' }).waitFor({ timeout: T.respuesta });
  const oferta = await p.evaluate(async () => (await fetch('/api/portal/offer')).json());
  const pesos = (c) => `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const renovar = p.getByTestId('renovar');
  r.ok(!!oferta.renewal && await aparece(renovar, T.respuesta), `ofrece renovar su plan (${oferta.renewal?.planName})`);
  const tr = (await renovar.innerText()).replace(/\s+/g, ' ');
  r.ok(tr.includes(oferta.renewal.planName) && tr.replace(/\.00/g, '').includes(pesos(oferta.renewal.priceCents)), `con su precio de hoy: «${tr.slice(0, 200)}»`);
  r.ok(/al precio que tienes hoy/.test(tr), 'y dice que renueva al precio que tiene hoy');
  r.ok(await p.getByTestId('precios-paga-en-recepcion').count() === 1 && oferta.purchasable === false, 'se paga en recepción (desde el teléfono no se compra)');
  const listas = await p.locator('[data-testid^="precios-"]').filter({ has: p.locator('.item-title') }).count();
  r.ok(listas >= 1 && oferta.plans.length >= 1, `y enseña los planes de ${oferta.branchName ?? 'su sucursal'} (${oferta.plans.length})`);
  await r.captura(p, 'portal-precios-rostro-1-precios', { full: true });

  // ── 2. Retirar el rostro ──────────────────────────────────────────────────
  r.paso('retirar el rostro');
  await p.goto(`${PORTAL}/cuenta`, { waitUntil: 'networkidle' });
  const permisos = p.getByTestId('tus-permisos');
  await permisos.locator('li').first().waitFor({ timeout: T.respuesta });
  const rostro = permisos.locator('li').filter({ hasText: /rostro/i });
  r.ok(await rostro.count() === 1, `«Tus permisos» trae el del rostro («${(await rostro.locator('.item-title').innerText().catch(() => '')).trim()}»)`);
  await rostro.getByRole('button', { name: 'Retirar' }).click();
  const hoja = p.getByTestId('confirmar-retiro');
  await hoja.waitFor({ timeout: T.ui });
  r.ok(await hoja.getByTestId('como-entras-sin-rostro').count() === 1, `la hoja dice cómo va a entrar desde hoy: «${(await hoja.getByTestId('como-entras-sin-rostro').innerText()).replace(/\s+/g, ' ').trim().slice(0, 160)}»`);
  r.ok(/registrarlo y firmarlo otra vez en recepción/.test(await hoja.innerText()), 'y cómo volver a darlo');
  await r.captura(p, 'portal-precios-rostro-2-retirar');
  const retiro = await accion(p, () => p.getByRole('button', { name: 'Sí, retirar' }).click(), '/api/portal/consents/BIOMETRIC/revoke', { metodo: 'POST', que: 'retirar el rostro' });
  r.ok(retiro.ok(), `se retira (${retiro.status()})`);
  r.ok(await aparece(p.getByText('Listo: tu rostro ya no se reconoce y su plantilla se borró.'), T.respuesta), 'avisa «Listo: tu rostro ya no se reconoce y su plantilla se borró.»');
  r.ok(await desaparece(rostro, T.respuesta), 'y ya no está en «Tus permisos»');
  const firmas = await g.get(`/members/${socio.id}/consents`);
  const delRostro = firmas.filter((c) => c.consentType === 'BIOMETRIC');
  r.ok(delRostro.length >= 1 && delRostro.every((c) => !c.granted || c.revokedAt), `la ficha ya no tiene el permiso del rostro vigente (${delRostro.map((c) => c.revokedAt ? 'retirado' : c.granted ? 'vigente' : 'negado').join(', ')})`);
}, { erroresDePagina: 'informa' });
