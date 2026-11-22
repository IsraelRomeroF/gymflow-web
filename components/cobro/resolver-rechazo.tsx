'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Banknote, CircleCheck, DoorOpen, ShoppingBag, Wallet, X } from 'lucide-react';
import type { AccessAttemptResult, ApplyCreditResult, CollectAndOpenResult } from '@gymflow/core/contracts';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { AVISO_PASE_DEL_DIA } from '@gymflow/core/vocabulario';
import { api, motivoDe } from '@/lib/api';
import { parsePesos, textoPesos } from '@/lib/pesos';
import { fecha, pesos } from '@/lib/format';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession, useToast, errorText, erroresPorCampo } from '../session';
import { Button, Callout, CampoMotivo, faltaMotivo } from '../ui';
import { VenderDialog } from '../venta';
import { CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro } from './campos';
import { CambioEfectivo } from './cambio';

/*
 * RESOLVER UN RECHAZO DE LA PUERTA (fase 1.4; 5-05, 5-11, 5-25, 4-09, 4-18).
 *
 * Una sola pieza para lo que antes eran dos: los pasos de cobro y motivo del
 * diálogo «Entrada» y la pantalla `/acceso/excepcion/[id]`, que cobraba todo
 * en efectivo y sin caja. Aquí las salidas son las mismas se abra desde donde
 * se abra, y siempre sobre el rechazo ORIGINAL (un rechazo se resuelve una vez):
 *
 *   · Cobrar y abrir: propone el NETO (lo que debe menos lo que tiene a favor,
 *     que se aplica primero), dice el mínimo para entrar hoy, deja elegir
 *     método, caja y referencia, y al terminar da el veredicto: si quedó al
 *     corriente o cuánto le falta.
 *   · Aplicar su saldo a favor y abrir (2.13): cuando lo que tiene a favor
 *     cubre TODO lo que debe no hay nada que cobrar; su saldo se reparte sin
 *     cobro, queda al corriente y la entrada se registra sobre este rechazo.
 *   · Renovar (o vender) y abrir: cuando no tiene membresía vigente, la venta
 *     se hace aquí y la entrada queda ligada al mismo rechazo.
 *   · Dejar pasar con motivo, de un toque.
 *   · No pasa.
 */

/** El rechazo que se resuelve: lo que ya dijo la puerta (`POST /access/attempts`) o la pantalla de excepción. */
export type Rechazo = {
  decisionId: string;
  memberId: string;
  memberName: string;
  branchId: string;
  reason: string | null;
  /** ¿Lo puede levantar el mostrador? Una baja o una credencial revocada, no. */
  overridable: boolean;
  /** Lo que debe (bruto), lo mínimo para entrar hoy y cuántas cuotas; `null` si el rechazo no es por adeudo. */
  outstandingCents: string | null;
  minimumCents: string | null;
  periodsOwed: number | null;
  /** Saldo a favor sin aplicar. */
  creditCents: string;
};

export type RechazoResuelto = {
  /** Cómo se resolvió, para decirlo en grande. */
  titulo: string;
  /** El detalle: folio, lo que quedó pendiente. */
  detalle: string | null;
  /** El veredicto tras cobrar (4-09): si mañana entra sin que nadie le abra. */
  veredicto: { canEnter: boolean; paidThrough: string | null; toEnterCents: string | null } | null;
  paymentId: string | null;
};

const SIN_MEMBRESIA = new Set(['MEMBERSHIP_ENDED', 'NO_MEMBERSHIP']);
/** El porqué estable del catálogo (`ERROR_REASONS`), no el código HTTP ni el texto. */
const esYaResuelto = (e: unknown) => motivoDe(e) === 'ALREADY_RESOLVED';

export function useResolverRechazo(rechazo: Rechazo | null, opciones: {
  /** «No pasa»: el rechazo se queda como está. */
  onNoPasa: () => void;
  /** Sucursal de casa del socio, para la venta de «Renovar y abrir». */
  homeBranchId?: string | null;
}): {
  cuerpo: ReactNode; pie: ReactNode;
  /** Ya quedó resuelto aquí (cobró, renovó o se dejó pasar). */
  resuelto: RechazoResuelto | null;
  /** Lo había resuelto otra persona (u otro clic): quién y cuándo. */
  yaResuelto: string | null;
} {
  const { can } = useSession();
  const toast = useToast();
  const [modo, setModo] = useState<'veredicto' | 'motivo' | 'cobro' | 'venta'>('veredicto');
  const [motivo, setMotivo] = useState('');
  const [faltaElMotivo, setFaltaElMotivo] = useState(false);
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);
  const [monto, setMonto] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enCurso, setEnCurso] = useState(false);
  const [resuelto, setResuelto] = useState<RechazoResuelto | null>(null);
  const [yaResuelto, setYaResuelto] = useState<string | null>(null);
  // La venta no alcanzó para abrir (quedó pendiente de pago): se dice y se sigue en el rechazo.
  const [ventaSinEntrada, setVentaSinEntrada] = useState<string | null>(null);
  // El saldo a favor ya se aplicó aquí (y la puerta todavía no abrió): no se ofrece otra vez.
  const [saldoAplicado, setSaldoAplicado] = useState(false);
  // Una clave por entrada tras la venta: reintentar devuelve la misma decisión.
  const claveEntrada = useRef(crypto.randomUUID());

  if (!rechazo) return { cuerpo: null, pie: null, resuelto: null, yaResuelto: null };

  // ── Las cifras: el neto es lo que de verdad se cobra (4-18) ────────────────
  const credito = BigInt(rechazo.creditCents);
  const bruto = rechazo.outstandingCents ? BigInt(rechazo.outstandingCents) : 0n;
  const neto = (x: bigint) => (x > credito ? x - credito : 0n);
  const debe = neto(bruto);
  const minimo = rechazo.minimumCents ? neto(BigInt(rechazo.minimumCents)) : debe;
  const aFavorCubre = bruto > 0n && debe === 0n;
  const parcialPosible = minimo < debe;
  const aCobrar = monto === null ? debe : parsePesos(monto);
  const montoValido = aCobrar !== null && aCobrar > 0n && aCobrar <= debe && aCobrar >= minimo;
  const sinMembresia = SIN_MEMBRESIA.has(rechazo.reason ?? '');
  const puedeVender = sinMembresia && can('memberships:create');
  const puedeCobrar = debe > 0n && can('payments:record');
  const puedeDejarPasar = rechazo.overridable && can('access:manual_grant');
  // Su saldo a favor cubre todo: se aplica sin cobro, con el permiso de quien cobra.
  const puedeAplicarSaldo = aFavorCubre && !saldoAplicado && can('payments:record');
  const r = rechazo;

  async function dejarPasar() {
    if (faltaMotivo(motivo)) { setFaltaElMotivo(true); return; }
    setEnCurso(true);
    try {
      await api(`/access/decisions/${r.decisionId}/grant`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      setResuelto({ titulo: 'Paso concedido. Queda registrado con tu nombre y el motivo.', detalle: null, veredicto: null, paymentId: null });
    } catch (e) {
      if (esYaResuelto(e)) setYaResuelto(errorText(e));
      else toast('error', errorText(e, 'No se pudo conceder el paso'));
    } finally { setEnCurso(false); }
  }

  async function cobrarYAbrir() {
    if (aCobrar === null || !montoValido) return;
    setEnCurso(true);
    try {
      const c = await api<CollectAndOpenResult>(`/access/decisions/${r.decisionId}/collect`, {
        method: 'POST', body: JSON.stringify({ amountCents: aCobrar.toString(), ...cuerpoDelCobro(cobro) }),
      });
      const resto = debe - aCobrar;
      setResuelto({
        titulo: `Cobrados ${pesos(aCobrar)}${c.folio ? ` · folio ${c.folio}` : ''}. Puede pasar.`,
        detalle: [
          BigInt(c.creditAppliedCents) > 0n ? `Además se usaron ${pesos(c.creditAppliedCents)} de su saldo a favor.` : null,
          resto > 0n ? `Le quedan ${pesos(resto)} por decidir en su ficha.` : null,
        ].filter(Boolean).join(' ') || null,
        veredicto: c.membership ? { canEnter: c.membership.canEnter, paidThrough: c.membership.paidThrough, toEnterCents: c.toEnterCents } : null,
        paymentId: c.paymentId,
      });
    } catch (e) {
      // Ya resuelto: no se cobró nada (la API lo revisa antes de tocar el dinero).
      if (esYaResuelto(e)) { setYaResuelto(errorText(e)); return; }
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo cobrar'));
    } finally { setEnCurso(false); }
  }

  /**
   * Aplicar su saldo a favor y abrir (2.13). No entra dinero: lo que tiene a
   * favor se reparte entre lo que debe, y la entrada se registra sobre el MISMO
   * rechazo. La puerta decide de verdad: si aun así no pasa, se dice por qué.
   */
  async function aplicarSaldoYAbrir() {
    setEnCurso(true);
    try {
      const a = await api<ApplyCreditResult>(`/members/${r.memberId}/credit/apply`, { method: 'POST', body: JSON.stringify({ branchId: r.branchId }) });
      setSaldoAplicado(true);
      const i = await api<AccessAttemptResult>('/access/attempts', {
        method: 'POST',
        body: JSON.stringify({
          branchId: r.branchId, memberId: r.memberId, credentialKind: 'MANUAL', requestKey: claveEntrada.current,
          reason: 'Se aplicó su saldo a favor', resolvesDecisionId: r.decisionId,
        }),
      });
      if (i.outcome === 'GRANTED') {
        setResuelto({
          titulo: BigInt(a.appliedCents) > 0n ? `Se aplicaron ${pesos(a.appliedCents)} de su saldo a favor. Puede pasar.` : 'Su saldo a favor ya estaba aplicado. Puede pasar.',
          detalle: ['No se cobró nada.', BigInt(a.creditCents) > 0n ? `Le quedan ${pesos(a.creditCents)} a favor.` : null].filter(Boolean).join(' '),
          veredicto: a.membership ? { canEnter: a.membership.canEnter, paidThrough: a.membership.paidThrough, toEnterCents: a.toEnterCents } : null,
          paymentId: null,
        });
      } else {
        claveEntrada.current = crypto.randomUUID();
        setVentaSinEntrada(i.reason === 'DUPLICATE_SCAN'
          ? 'Su entrada ya estaba registrada hace un momento.'
          : `Su saldo a favor quedó aplicado${BigInt(a.outstandingCents) > 0n ? ` y todavía debe ${pesos(a.outstandingCents)}` : ''}, pero todavía no puede pasar: ${(DENIAL_REASON[i.reason ?? ''] ?? 'revisa su ficha').toLowerCase()}.${puedeDejarPasar ? ' Puedes dejarlo pasar con motivo.' : ''}`);
      }
    } catch (e) {
      if (esYaResuelto(e)) setYaResuelto(errorText(e));
      else toast('error', errorText(e, 'No se pudo aplicar su saldo a favor'));
    } finally { setEnCurso(false); }
  }

  /** Tras la venta: la entrada se registra sobre el MISMO rechazo (5-25). La puerta decide de verdad. */
  async function entrarTrasLaVenta() {
    setModo('veredicto');
    setEnCurso(true);
    try {
      const i = await api<AccessAttemptResult>('/access/attempts', {
        method: 'POST',
        body: JSON.stringify({
          branchId: r.branchId, memberId: r.memberId, credentialKind: 'MANUAL', requestKey: claveEntrada.current,
          reason: 'Renovó en el mostrador', resolvesDecisionId: r.decisionId,
        }),
      });
      if (i.outcome === 'GRANTED') {
        // Lo que se le vendió fue un pase del día (1.8): no tiene membresía, entra hoy.
        const conPase = i.warning === AVISO_PASE_DEL_DIA;
        setResuelto({
          titulo: conPase ? `${r.memberName} entra hoy con su pase del día.` : `${r.memberName} ya tiene su membresía y puede pasar.`,
          detalle: conPase ? 'La entrada quedó registrada. El pase vale hoy, en esta sucursal.' : 'La entrada quedó registrada.', veredicto: null, paymentId: null,
        });
      } else {
        claveEntrada.current = crypto.randomUUID();
        setVentaSinEntrada(i.reason === 'DUPLICATE_SCAN'
          ? 'Su entrada ya estaba registrada hace un momento.'
          : `La venta quedó registrada, pero todavía no puede pasar: ${(DENIAL_REASON[i.reason ?? ''] ?? 'falta el pago').toLowerCase()}. Cóbrala desde su ficha o déjalo pasar con motivo.`);
      }
    } catch (e) {
      if (esYaResuelto(e)) setYaResuelto(errorText(e));
      else toast('error', errorText(e, 'La venta quedó registrada, pero no se pudo registrar la entrada. Regístrala desde el buscador'));
    } finally { setEnCurso(false); }
  }

  // ── Cuerpo ────────────────────────────────────────────────────────────────
  let cuerpo: ReactNode;
  if (yaResuelto) {
    cuerpo = (
      <div className="entrada-veredicto" data-estado="neutro" aria-live="polite" data-testid="entrada-ya-resuelta">
        <CircleCheck />
        <div>
          <p className="entrada-titulo">Este rechazo ya se había resuelto</p>
          <p className="small muted">{yaResuelto}</p>
        </div>
      </div>
    );
  } else if (resuelto) {
    const v = resuelto.veredicto;
    cuerpo = (
      <div className="stack" data-testid="rechazo-resuelto">
        <div className="entrada-veredicto" data-ok="true" aria-live="polite">
          <CircleCheck />
          <div className="flex-1">
            <p className="entrada-titulo">{resuelto.titulo}</p>
            {resuelto.detalle && <p className="small">{resuelto.detalle}</p>}
          </div>
        </div>
        {/* El veredicto (4-09): la puerta se abrió por esta vez; esto dice qué pasa mañana. */}
        {v && (v.canEnter
          ? <Callout tone="ok" title="Quedó al corriente">{v.paidThrough ? `Pagado hasta el ${fecha(v.paidThrough)}. ` : ''}La próxima vez entra sin pasar por aquí.</Callout>
          : v.toEnterCents && BigInt(v.toEnterCents) > 0n
            ? <Callout tone="warn" title="Hoy pasa, pero sigue sin quedar al corriente">Le faltan {pesos(v.toEnterCents)} para volver a entrar por su cuenta.{v.paidThrough ? ` Pagado hasta el ${fecha(v.paidThrough)}.` : ''}</Callout>
            : null)}
      </div>
    );
  } else if (modo === 'motivo') {
    cuerpo = (
      <CampoMotivo id="mot-entrada" label="Motivo (queda registrado con tu nombre)" hint={null} autoFocus value={motivo}
        onChange={(m) => { setMotivo(m); setFaltaElMotivo(false); }} motivos={textosDeMotivo('dejarPasar')}
        error={faltaElMotivo ? 'Escribe por qué pasa: queda en la bitácora con tu nombre.' : null} />
    );
  } else if (modo === 'cobro') {
    cuerpo = (
      <div className="stack">
        <div className="row-between items-end">
          <span className="label">A cobrar</span>
          {parcialPosible
            ? <input className="input num cobro-importe" inputMode="decimal" aria-label="Importe a cobrar"
                value={monto ?? textoPesos(debe)} onChange={(e) => { setMonto(e.target.value); setErrores({}); }} />
            : <strong className="num cobro-total">{pesos(debe)}</strong>}
        </div>
        {credito > 0n && (
          <p className="small muted" data-testid="cobro-neto">
            Debe {pesos(bruto)} y tiene {pesos(credito)} a favor, que se aplica primero: se cobran {pesos(debe)}.
          </p>
        )}
        {parcialPosible && (
          <p className="small muted">
            {credito === 0n && <>Debe {pesos(bruto)}{r.periodsOwed && r.periodsOwed > 1 ? ` (${r.periodsOwed} periodos)` : ''}. </>}
            Para abrir hoy basta con {pesos(minimo)}, la cuota más antigua; lo demás se <Link href={`/socios/${r.memberId}?tab=cuenta`} className="row-link">decide en su ficha</Link>.
            {!montoValido && <span className="danger"> El importe va de {pesos(minimo)} a {pesos(debe)}.</span>}
          </p>
        )}
        {errores.amountCents && <p className="field-error">{errores.amountCents}</p>}
        <CobroFields branchId={r.branchId} value={cobro} onChange={cambiarCobro} errores={errores} />
        {cobro.method === 'CASH' && aCobrar !== null && montoValido && <CambioEfectivo totalCents={aCobrar} />}
      </div>
    );
  } else {
    cuerpo = (
      <div className="stack">
        <div className="entrada-veredicto" data-ok="false">
          <X />
          <div>
            <p className="entrada-titulo">No puede pasar</p>
            <p className="small">{DENIAL_REASON[r.reason ?? ''] ?? r.reason}</p>
          </div>
        </div>
        {bruto > 0n && !saldoAplicado && (
          <div className="row-between">
            <span className="label">Debe</span>
            <span className="cobro-debe">
              <strong className="num cobro-total">{pesos(debe > 0n ? debe : bruto)}</strong>
              {credito > 0n && debe > 0n && <span className="tiny muted block">{pesos(bruto)} menos {pesos(credito)} que tiene a favor</span>}
            </span>
          </div>
        )}
        {aFavorCubre && !saldoAplicado && (
          <Callout tone="info" title="Lo que tiene a favor cubre lo que debe">
            Tiene {pesos(credito)} a favor y debe {pesos(bruto)}: no hay nada que cobrar aquí.{' '}
            {puedeAplicarSaldo
              ? 'Aplica su saldo a favor: queda al corriente y pasa, sin cobrarle nada.'
              : <>{puedeDejarPasar ? 'Déjalo pasar con motivo; ' : ''}su saldo lo aplica quien cobra en esta sucursal.</>}
          </Callout>
        )}
        {ventaSinEntrada && <Callout tone="warn">{ventaSinEntrada}</Callout>}
        {!r.overridable && !puedeVender && <p className="small muted">Este motivo no se puede levantar desde recepción.</p>}
        {sinMembresia && !can('memberships:create') && <p className="small muted">Para que entre hay que venderle una membresía: lo hace quien vende en esta sucursal.</p>}
      </div>
    );
  }

  // ── Pie ───────────────────────────────────────────────────────────────────
  let pie: ReactNode = null;
  if (!resuelto && !yaResuelto) {
    if (modo === 'motivo') {
      pie = <><Button variant="secondary" onClick={() => setModo('veredicto')} disabled={enCurso}>Atrás</Button>
        <Button icon={<DoorOpen />} loading={enCurso} onClick={() => void dejarPasar()}>Dejar pasar</Button></>;
    } else if (modo === 'cobro') {
      pie = <><Button variant="secondary" onClick={() => setModo('veredicto')} disabled={enCurso}>Atrás</Button>
        <Button icon={<Banknote />} loading={enCurso} disabled={!cobroListo(cobro) || !montoValido} onClick={() => void cobrarYAbrir()}>Cobrar {aCobrar !== null && montoValido ? pesos(aCobrar) : ''} y dejar pasar</Button></>;
    } else {
      const principal = puedeCobrar ? 'cobro' : puedeAplicarSaldo ? 'saldo' : puedeVender ? 'venta' : 'motivo';
      pie = <>
        <Button variant="ghost" onClick={opciones.onNoPasa} disabled={enCurso}>No pasa</Button>
        {puedeDejarPasar && <Button variant={principal === 'motivo' ? 'primary' : 'secondary'} icon={<DoorOpen />} disabled={enCurso} onClick={() => setModo('motivo')}>Dejar pasar con motivo</Button>}
        {puedeVender && <Button variant={principal === 'venta' ? 'primary' : 'secondary'} icon={<ShoppingBag />} loading={enCurso} onClick={() => { setVentaSinEntrada(null); setModo('venta'); }}>{r.reason === 'NO_MEMBERSHIP' ? 'Vender y abrir' : 'Renovar y abrir'}</Button>}
        {puedeAplicarSaldo && <Button icon={<Wallet />} loading={enCurso} data-testid="aplicar-saldo-y-abrir" onClick={() => { setVentaSinEntrada(null); void aplicarSaldoYAbrir(); }}>Aplicar su saldo a favor y abrir</Button>}
        {puedeCobrar && <Button icon={<Banknote />} disabled={enCurso} onClick={() => setModo('cobro')}>Cobrar {pesos(debe)} y abrir</Button>}
      </>;
    }
  }

  // La venta va en su propio diálogo, encima: al terminar, la entrada queda sobre este rechazo.
  if (modo === 'venta' && !resuelto && !yaResuelto) {
    cuerpo = <>{cuerpo}
      <VenderDialog memberId={r.memberId} memberName={r.memberName} homeBranchId={opciones.homeBranchId ?? r.branchId} sedeFija={r.branchId}
        onClose={() => setModo('veredicto')} onDone={() => void entrarTrasLaVenta()} /></>;
  }

  return { cuerpo, pie, resuelto, yaResuelto };
}

/** La pieza completa, para una página (la pantalla de excepción): cuerpo y acciones, una debajo de otra. */
export function ResolverRechazo({ rechazo, onNoPasa, onListo, homeBranchId }: {
  rechazo: Rechazo; onNoPasa: () => void;
  /** Ya resuelto (aquí o por otra persona): el botón que cierra. */
  onListo: () => void; homeBranchId?: string | null;
}) {
  const { cuerpo, pie, resuelto, yaResuelto } = useResolverRechazo(rechazo, { onNoPasa, homeBranchId });
  return (
    <div className="stack" data-testid="resolver-rechazo">
      {cuerpo}
      <div className="resolver-pie">
        {resuelto || yaResuelto
          ? <>
              {resuelto?.paymentId && <a className="btn btn-secondary" href={`/recibo/${resuelto.paymentId}`} target="_blank" rel="noreferrer">Comprobante</a>}
              <Button autoFocus onClick={onListo}>Listo</Button>
            </>
          : pie}
      </div>
    </div>
  );
}
