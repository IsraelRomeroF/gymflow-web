'use client';

import { useState } from 'react';
import { Undo2, Percent, Ban, HandHeart, SlidersHorizontal } from 'lucide-react';
import { MOTIVOS, OTRO, revisarMotivo } from '@gymflow/core/motivos';
import { METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import type { Charge, OpenCashSessionsLite, StatementPayment } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { concepto, fechaHora, hora, pesos } from '@/lib/format';
import { useSession, useToast, errorText } from './session';
import { Button, Callout, CampoMotivo, Dialog, Field, Opciones } from './ui';
import { InputPesos } from './input-pesos';
import { AutorizacionDialog, type Operacion } from './autorizacion';

/**
 * CORRECCIONES DEL ESTADO DE CUENTA (auditoría 8, bloque 2.2; 3-03, 3-07, 3-08, 3-13).
 *
 * Dos diálogos, uno por renglón:
 *  - «Devolver dinero» sobre un PAGO: fusiona «Revertir» y «Reembolsar». El
 *    pago va arriba como contexto y el camino lo decide cómo se cobró.
 *  - «Corregir» sobre un CARGO que se debe: Descontar, Condonar o Anular, cada
 *    uno con su catálogo de motivos (los de perdonar no son los de descontar).
 *
 * Las reglas: la reversa deshace el cobro completo y siempre pide firma; el
 * reembolso (tarjeta en línea) y la devolución de una parte de un cobro de
 * mostrador (D-13: efectivo de la caja abierta, transferencia con referencia)
 * siempre piden firma; el descuento pasa solo dentro del tope del puesto; la
 * condonación pasa sola hasta una mensualidad del socio y arriba pide firma
 * (D-12); la anulación siempre pide firma.
 */

type Turno = OpenCashSessionsLite['sessions'][number];
/** Lo que las acciones necesitan del cargo: un recorte del contrato del núcleo. */
type CargoFila = Pick<Charge, 'id' | 'concept' | 'status' | 'amountCents' | 'balanceCents' | 'branchId'>;

/** La reversa pasa por caja cuando el cobro pasó por caja (la misma regla que `requiresCashSession` del núcleo). */
const pasaPorCaja = (method: string) => method === 'CASH' || method === 'CARD_TERMINAL';
const porTransferencia = (method: string) => method === 'SPEI_TRANSFER' || method === 'OXXO_REF';

/**
 * Ejecuta una operación que PUEDE requerir la autorización de otra persona:
 * primero se intenta sin ella (un descuento dentro del límite del rol pasa
 * solo); si la API responde que la exige, se pide ahí mismo y se reintenta.
 */
function useAutorizacion() {
  const [pendiente, setPendiente] = useState<{ permission: string; branchId: string | null; operacion: Operacion & { motivo?: string }; titulo: string; run: (t: string) => Promise<void> } | null>(null);
  async function ejecutar(permission: string, branchId: string | null, operacion: Operacion & { motivo?: string }, titulo: string, run: (token?: string) => Promise<void>, siempre = false) {
    if (siempre) { setPendiente({ permission, branchId, operacion, titulo, run }); return; }
    try { await run(); } catch (e) {
      if (e instanceof ApiError && e.status === 428) setPendiente({ permission, branchId, operacion, titulo, run });
      else throw e;
    }
  }
  const dialogo = pendiente && (
    <AutorizacionDialog permission={pendiente.permission} branchId={pendiente.branchId} operacion={pendiente.operacion} motivo={pendiente.operacion.motivo} titulo={pendiente.titulo}
      onClose={() => setPendiente(null)}
      onAutorizado={(token) => { const p = pendiente; setPendiente(null); void p.run(token); }} />
  );
  return { ejecutar, dialogo };
}

/**
 * Qué pasa con el dinero al deshacer un cobro, según cómo se cobró (3-08). La
 * API solo saca el dinero de la caja abierta cuando el cobro fue en efectivo o
 * con la terminal en una sucursal que lleva Caja; una transferencia no toca
 * la caja.
 */
function queHaceLaReversa(method: string, conCaja: boolean): string {
  const pendiente = 'El cargo vuelve a quedar pendiente.';
  switch (method) {
    case 'CASH':
      return conCaja
        ? `El efectivo sale de la caja abierta hoy. ${pendiente}`
        : `Esta sucursal no lleva Caja: devuélvele el efectivo en mano. ${pendiente}`;
    case 'CARD_TERMINAL':
      return conCaja
        ? `Se resta del total de tarjeta de la caja abierta hoy; la devolución a su tarjeta se hace en la terminal del banco. ${pendiente}`
        : `La devolución a su tarjeta se hace en la terminal del banco. ${pendiente}`;
    case 'SPEI_TRANSFER':
    case 'OXXO_REF':
      return `No sale de la caja: devuélvelo por transferencia desde la cuenta del gimnasio. ${pendiente}`;
    case 'CREDIT_NOTE':
      return 'Es saldo a favor (nota de crédito): no sale dinero de ninguna caja. Se quita ese saldo a favor y lo que cubría vuelve a quedar pendiente.';
    default:
      return pendiente;
  }
}

/** Qué pasa al devolver UNA PARTE de un cobro de mostrador (D-13): el cargo no vuelve a deber por ese importe. */
function queHaceLaParte(method: string, conCaja: boolean): string {
  const noDebe = 'Ese importe deja de cobrársele: el cargo no vuelve a quedar pendiente y su membresía no cambia.';
  switch (method) {
    case 'CASH': return conCaja ? `El efectivo sale de la caja abierta hoy, con su folio. ${noDebe}` : `Esta sucursal no lleva Caja: devuélvele el efectivo en mano. ${noDebe}`;
    case 'CARD_TERMINAL': return `${conCaja ? 'Se resta del total de tarjeta de la caja abierta hoy; la' : 'La'} devolución a su tarjeta se hace en la terminal del banco. ${noDebe}`;
    default: return `No sale de la caja: devuélvelo por transferencia y anota su referencia. ${noDebe}`;
  }
}

/** Devolver dinero de un pago: deshacer el cobro (mostrador) o reembolsar a la tarjeta (en línea). */
export function PagoAcciones({ pago, onDone }: { pago: StatementPayment; onDone: () => void }) {
  const { can, activoEn } = useSession();
  const [abierto, setAbierto] = useState(false);
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  if (pago.status !== 'SUCCEEDED' || BigInt(pago.amountCents) <= 0n) return null;
  const tarjeta = pago.method === 'CARD_ON_FILE';
  if (!can(tarjeta ? 'payments:refund' : 'payments:reverse') && !can('payments:refund')) return null;

  // Los turnos abiertos se cargan ANTES de abrir el diálogo: la caja aparece desde el primer pintado, sin saltos.
  async function abrir() {
    let abiertos: Turno[] | null = null;
    if (!tarjeta && pago.branchId && activoEn('cash', pago.branchId) && pasaPorCaja(pago.method)) {
      try { abiertos = (await api<OpenCashSessionsLite>(`/cash-sessions/open-lite?branchId=${pago.branchId}`)).sessions; } catch { abiertos = []; }
    }
    setTurnos(abiertos);
    setAbierto(true);
  }
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => void abrir()}>Devolver</Button>
      {abierto && <DevolverDialog pago={pago} turnos={turnos} onClose={() => setAbierto(false)} onListo={() => { setAbierto(false); onDone(); }} />}
    </>
  );
}

type Cuanto = 'todo' | 'parte';

function DevolverDialog({ pago, turnos, onClose, onListo }: { pago: StatementPayment; turnos: Turno[] | null; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { activoEn, me, branchName } = useSession();
  const { ejecutar, dialogo } = useAutorizacion();
  const tarjeta = pago.method === 'CARD_ON_FILE';
  const total = BigInt(pago.amountCents);
  const [cuanto, setCuanto] = useState<Cuanto>('todo');
  const [parte, setParte] = useState<bigint | null>(null);
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const conCaja = !!pago.branchId && activoEn('cash', pago.branchId);
  // Con dos turnos abiertos en la sede, la devolución en efectivo o terminal dice
  // de qué caja sale el dinero, igual que el cobro dice en cuál entra (D1 de 1.17a).
  const pideCaja = !tarjeta && !!turnos && turnos.length > 1;
  const cents = cuanto === 'todo' ? total : parte;
  const importeBien = cents !== null && cents > 0n && cents <= total;
  const valido = motivo.trim().length >= 3 && importeBien && (!pideCaja || !!cajaId) && (!(cuanto === 'parte' && !tarjeta && porTransferencia(pago.method)) || referencia.trim().length >= 3);
  // D-13 (bloque 3.5): una PARTE de un cobro de mostrador es una devolución (`/return`), siempre con firma;
  // la referencia de la transferencia tiene su campo y es obligatoria. «Todo» sigue siendo la reversa.
  const parcial = !tarjeta && cuanto === 'parte';
  const pideReferencia = parcial && porTransferencia(pago.method);
  // En la reversa completa la clave de rastreo no tiene campo propio: viaja en el motivo y queda en la bitácora.
  const motivoCompleto = [motivo.trim(), !tarjeta && !parcial && porTransferencia(pago.method) && referencia.trim() ? `devuelto por transferencia, ref. ${referencia.trim()}` : '']
    .filter(Boolean).join(' · ').slice(0, 300);
  // Una llave por diálogo: el doble clic o el reintento no sacan dinero dos veces.
  const [llave] = useState(() => crypto.randomUUID());

  function enviar() {
    if (!valido || cents === null) return;
    setFallo(null);
    void ejecutar(tarjeta || parcial ? 'payments:refund' : 'payments:reverse', pago.branchId ?? null,
      { resourceType: 'Payment', resourceId: pago.id, amountCents: cents, motivo: motivoCompleto },
      tarjeta ? `Autorizar reembolso de ${pesos(cents)}` : `Autorizar la devolución de ${pesos(parcial ? cents : total)}`,
      async (token) => {
        setEnviando(true);
        try {
          await api(`/payments/${pago.id}/${tarjeta ? 'refund' : parcial ? 'return' : 'reverse'}`, {
            method: 'POST',
            body: JSON.stringify({
              reason: motivoCompleto,
              ...(tarjeta || parcial ? { amountCents: cents.toString() } : {}),
              ...(parcial ? { requestKey: llave, ...(pideReferencia ? { returnRef: referencia.trim() } : {}) } : {}),
              ...(!tarjeta && cajaId ? { cashSessionId: cajaId } : {}),
              ...(token ? { approvalToken: token } : {}),
            }),
          });
          toast('ok', tarjeta ? 'Reembolso enviado al banco' : parcial ? `Se devolvieron ${pesos(cents)}: ese importe ya no se le cobra` : 'Pago revertido: el cargo vuelve a estar pendiente');
          onListo();
        } catch (e) { setFallo(errorText(e, 'No se pudo devolver')); } finally { setEnviando(false); }
      }, true);
  }

  return (
    <>
      <Dialog open onClose={onClose} title="Devolver dinero" error={fallo}
        sub="Deshace un cobro o regresa dinero al socio. Siempre lo autoriza otra persona, con su contraseña."
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" loading={enviando} disabled={!valido} onClick={enviar}>Pedir autorización</Button></>}>
        <div className="stack">
          {/* El pago, como contexto: qué se va a devolver se lee antes de decidir cuánto. */}
          <div className="pago-contexto" data-testid="devolver-pago">
            <div className="row gap-10 items-start">
              <div className="flex-1 min-w-0">
                <p className="strong">{etiqueta(METODO_DE_PAGO, pago.method, pago.method)} · {fechaHora(pago.receivedAt)}</p>
                <p className="tiny muted">
                  {[pago.folio ? `Folio ${pago.folio}` : '', pago.externalRef ? `Ref. ${pago.externalRef}` : '', pago.branchId ? branchName(pago.branchId) : '',
                    pago.collectedByName ? `Cobró ${pago.collectedByName}` : ''].filter(Boolean).join(' · ')}
                </p>
                {pago.covers.length > 0 && <p className="tiny muted">Cubrió: {pago.covers.map((x) => `${concepto(x.concept)} (${pesos(x.amountCents)})`).join(' · ')}</p>}
              </div>
              <p className="pago-contexto-importe num">{pesos(pago.amountCents)}</p>
            </div>
          </div>

          <div>
            <p className="label mb-8" id="dev-cuanto">¿Cuánto se devuelve?</p>
            <Opciones forma="tarjetas" etiquetadaPor="dev-cuanto" value={cuanto} onChange={setCuanto}
              opciones={[
                { value: 'todo' as const, label: `Todo el cobro · ${pesos(total)}`, texto: tarjeta ? 'Se reembolsa completo a su tarjeta.' : 'Se deshace el cobro completo.' },
                { value: 'parte' as const, label: 'Una parte', disabled: pago.method === 'CREDIT_NOTE',
                  texto: tarjeta ? 'Un importe menor, a su tarjeta.'
                    : pago.method === 'CREDIT_NOTE' ? 'El saldo a favor se devuelve desde «Devolver saldo a favor».'
                      : 'Un importe menor: se le regresa y ese importe deja de cobrársele.' },
              ]} />
          </div>
          {cuanto === 'parte' && (
            <Field label="Importe a devolver" htmlFor="dev-importe" required hint={`Hasta ${pesos(total)}.`}
              error={parte !== null && !importeBien ? `Debe ser mayor que cero y no pasar de ${pesos(total)}.` : null}>
              <div className="input-money"><span>$</span><InputPesos id="dev-importe" valueCents={parte} onChange={(c) => setParte(c)} autoFocus /></div>
            </Field>
          )}

          <Callout tone="warn" title="Lo que va a pasar">
            {tarjeta
              ? 'Se devuelve a la tarjeta del socio por el procesador. Lo reembolsado deja de cobrarse.'
              : parcial ? queHaceLaParte(pago.method, conCaja)
                : <>{queHaceLaReversa(pago.method, conCaja)} {pago.method !== 'CREDIT_NOTE' && 'Si ese pago había activado una membresía, vuelve a deber y entra en mora.'}</>}
          </Callout>

          {pideCaja && turnos && (
            <Field label="Caja" htmlFor="caja" required hint="Hay varias abiertas: el dinero sale del corte de la que elijas.">
              <select id="caja" className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                <option value="">Elige la caja…</option>
                {turnos.map((t) => {
                  const quien = t.openedByUserId === me.userId ? 'tu turno' : `turno de ${t.openedByName ?? 'otra persona'}`;
                  return <option key={t.id} value={t.id}>{t.registerCode} · {t.registerName} — {quien}, desde {hora(t.openedAt)}</option>;
                })}
              </select>
            </Field>
          )}
          {!tarjeta && porTransferencia(pago.method) && (
            <Field label="Referencia de la devolución" htmlFor="dev-ref" required={pideReferencia}
              hint={pideReferencia ? 'La clave de rastreo de la transferencia con la que se le devolvió. Obligatoria.' : 'Si ya se la transferiste, anota la clave de rastreo: queda en la bitácora junto al motivo.'}>
              <input id="dev-ref" className="input" value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </Field>
          )}
          <CampoMotivo id="dev-motivo" value={motivo} onChange={setMotivo} autoFocus={cuanto === 'todo'} maxLength={220}
            motivos={tarjeta ? ['No pudo usar el servicio', 'Se cobró dos veces'] : ['Se cobró al socio equivocado', 'Se cobró dos veces', 'Importe mal capturado']} />
        </div>
      </Dialog>
      {dialogo}
    </>
  );
}

type Correccion = 'descontar' | 'condonar' | 'anular';
const PERMISO: Record<Correccion, string> = { descontar: 'billing:discount:apply', condonar: 'billing:waiver:apply', anular: 'billing:charge:void' };

/** Corregir un cargo que se debe: descontar, condonar o, si nunca se pagó, anular. */
export function CargoAcciones({ cargo, onDone }: { cargo: CargoFila; onDone: () => void }) {
  const { can } = useSession();
  const [abierto, setAbierto] = useState(false);
  const pendiente = BigInt(cargo.balanceCents) > 0n && !['VOID', 'WRITTEN_OFF'].includes(cargo.status);
  const sinPagos = cargo.balanceCents === cargo.amountCents;
  // Condonar lo pide quien puede descontar y lo firma quien puede condonar (como antes, dentro de «Ajustar»).
  const caminos: Correccion[] = [
    ...(can('billing:discount:apply') ? ['descontar' as const, 'condonar' as const] : []),
    ...(sinPagos && can('billing:charge:void') ? ['anular' as const] : []),
  ];
  if (!pendiente || caminos.length === 0) return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<SlidersHorizontal />} onClick={() => setAbierto(true)}>Corregir</Button>
      {abierto && <CorregirDialog cargo={cargo} caminos={caminos} onClose={() => setAbierto(false)} onListo={() => { setAbierto(false); onDone(); }} />}
    </>
  );
}

const CAMINO: Record<Correccion, { label: string; texto: string; icono: React.ReactNode }> = {
  descontar: { label: 'Descontar', icono: <Percent />, texto: 'Una promoción o un convenio. Dentro de tu tope no pide autorización.' },
  condonar: { label: 'Condonar', icono: <HandHeart />, texto: 'Perdonar una deuda que sí existía. Hasta una mensualidad del socio no pide autorización; arriba, sí.' },
  anular: { label: 'Anular', icono: <Ban />, texto: 'El cargo nunca debió existir (error de captura). Siempre pide autorización.' },
};

function CorregirDialog({ cargo, caminos, onClose, onListo }: { cargo: CargoFila; caminos: Correccion[]; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { ejecutar, dialogo } = useAutorizacion();
  const [modo, setModo] = useState<Correccion | null>(caminos.length === 1 ? caminos[0]! : null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [cents, setCents] = useState<bigint | null>(null);
  // El campo de importe se vuelve a montar cuando un atajo lo llena.
  const [vuelta, setVuelta] = useState(0);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const saldo = BigInt(cargo.balanceCents);
  const anular = modo === 'anular';
  const catalogo = modo === 'condonar' ? MOTIVOS.condonacion : MOTIVOS.descuento;
  const motivoRevisado = modo && !anular && codigo ? revisarMotivo(modo === 'condonar' ? 'condonacion' : 'descuento', { codigo, nota }) : null;
  const importeBien = cents !== null && cents > 0n && cents <= saldo;
  const valido = modo === null ? false : anular ? nota.trim().length >= 3 : !!motivoRevisado?.ok && importeBien;

  function elegir(m: Correccion) { setModo(m); setCodigo(null); setNota(''); setFallo(null); }
  function atajo(c: bigint) { setCents(c); setVuelta((v) => v + 1); }

  function enviar() {
    if (!modo || !valido) return;
    setFallo(null);
    const motivo = anular ? nota.trim() : motivoRevisado && motivoRevisado.ok ? motivoRevisado.texto : '';
    void ejecutar(PERMISO[modo], cargo.branchId, { resourceType: 'Charge', resourceId: cargo.id, amountCents: anular ? null : cents, motivo },
      anular ? 'Autorizar anulación' : modo === 'condonar' ? 'Autorizar condonación' : 'Autorizar descuento',
      async (token) => {
        setEnviando(true);
        try {
          await api(anular ? `/charges/${cargo.id}/void` : `/charges/${cargo.id}/adjustments`, {
            method: 'POST',
            body: JSON.stringify(anular
              ? { reason: motivo, ...(token ? { approvalToken: token } : {}) }
              : { adjustmentType: modo === 'condonar' ? 'WAIVER' : 'DISCOUNT', amountCents: cents!.toString(), reason: motivo, reasonCode: codigo, ...(token ? { approvalToken: token } : {}) }),
          });
          toast('ok', anular ? 'Cargo anulado' : modo === 'condonar' ? 'Deuda condonada' : 'Descuento aplicado');
          onListo();
        } catch (e) {
          // El descuento que pasa del tope y el perdón que pasa de una mensualidad (D-12) piden firma: lo atiende `ejecutar`.
          if (e instanceof ApiError && e.status === 428) throw e;
          setFallo(errorText(e, 'No se pudo aplicar'));
        } finally { setEnviando(false); }
      }, anular).catch((e) => setFallo(errorText(e, 'No se pudo aplicar')));
  }

  return (
    <>
      {/* El título nombra el cargo, con sus fechas legibles (26-06, 3-16). */}
      <Dialog open onClose={onClose} title={`Corregir «${concepto(cargo.concept)}»`} sub={`Pendiente ${pesos(cargo.balanceCents)} de ${pesos(cargo.amountCents)}`} error={fallo}
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={modo === 'descontar' ? 'primary' : 'danger'} loading={enviando} disabled={!valido} onClick={enviar}>
            {modo === 'descontar' ? 'Aplicar descuento' : modo === 'condonar' ? 'Condonar' : 'Pedir autorización'}</Button></>}>
        <div className="stack">
          {caminos.length > 1 && (
            <div>
              <p className="label mb-8" id="cor-que">¿Qué corrección es?</p>
              <Opciones forma="tarjetas" columnas={caminos.length === 3 ? 3 : 2} etiquetadaPor="cor-que" value={modo} onChange={elegir}
                opciones={caminos.map((c) => ({ value: c, label: CAMINO[c].label, icono: CAMINO[c].icono, texto: CAMINO[c].texto }))} />
            </div>
          )}
          {modo && !anular && (
            <>
              <div>
                <p className="label mb-8" id="cor-motivo">{modo === 'condonar' ? '¿Por qué se le perdona?' : '¿Qué descuento es?'}</p>
                <Opciones forma="chips" etiquetadaPor="cor-motivo" value={codigo} onChange={setCodigo}
                  opciones={catalogo.motivos.map((m) => ({ value: m.codigo, label: m.texto }))} />
              </div>
              <Field label="Importe" htmlFor="cor-importe" required
                hint={cents !== null && importeBien ? `Queda pendiente ${pesos(saldo - cents)}.` : `Hasta ${pesos(saldo)}.`}
                error={cents !== null && !importeBien ? `Debe ser mayor que cero y no pasar de ${pesos(saldo)}.` : null}>
                <div className="row wrap gap-8">
                  <div className="input-money cor-importe"><span>$</span><InputPesos key={vuelta} id="cor-importe" valueCents={cents} onChange={(c) => setCents(c)} /></div>
                  <div className="row gap-6" role="group" aria-label="Atajos de importe">
                    {modo === 'descontar' && <button type="button" className="chip" onClick={() => atajo(BigInt(cargo.amountCents) / 10n)}>10 %</button>}
                    <button type="button" className="chip" onClick={() => atajo(saldo / 2n)}>La mitad</button>
                    <button type="button" className="chip" onClick={() => atajo(saldo)}>Todo</button>
                  </div>
                </div>
              </Field>
              <Field label={codigo === OTRO ? 'Explicación' : 'Explicación (opcional)'} htmlFor="cor-nota" required={codigo === OTRO}
                hint="Queda en la bitácora con tu nombre, junto al motivo.">
                <input id="cor-nota" className="input" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)}
                  placeholder={modo === 'condonar' ? 'Incapacidad del 3 al 20 de noviembre' : 'Promoción de aniversario'} />
              </Field>
            </>
          )}
          {anular && (
            <CampoMotivo id="cor-nota" value={nota} onChange={setNota} motivos={['Cargo duplicado', 'Se capturó al socio equivocado']}
              hint="Si la deuda existía y se le perdona, no es anular: es condonar. Queda en la bitácora con tu nombre." />
          )}
        </div>
      </Dialog>
      {dialogo}
    </>
  );
}
