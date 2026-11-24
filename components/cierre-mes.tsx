'use client';

import { useCallback, useState } from 'react';
import { Lock } from 'lucide-react';
import type { MonthlyCloseList, MonthlyClosePreview } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, ERROR_MOTIVO, ErrorCarga, faltaMotivo, Field, sePuedeSeguir, VistaPrevia, type CifraPrevia } from '@/components/ui';
import { fecha, nombreMes, pesos } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { useCarga, type Carga } from '@/lib/carga';
import { GLOSARIO } from '@/lib/glosario';
import { AutorizacionDialog, idDeCierreDeMes } from '@/components/autorizacion';

/** Los meses cerrados y los terminados que siguen sin cerrar, según el servidor (14-04). */
export function useCierresDeMes(): Carga<MonthlyCloseList> {
  const cargar = useCallback(() => api<MonthlyCloseList>('/reports/monthly-closes'), []);
  return useCarga(cargar);
}

/** «Octubre de 2026»: el mes con mayúscula, para empezar un renglón. */
const mesConMayuscula = (mes: string) => { const n = nombreMes(mes); return n.charAt(0).toUpperCase() + n.slice(1); };

/** Las cifras que quedan congeladas, una por renglón. Los gastos llegan en negativo y se leen sin signo. */
function cifrasDelCierre(t: MonthlyClosePreview['totals']): CifraPrevia[] {
  const gastos = t.cashExpensesCents !== undefined && t.fixedExpensesCents !== undefined ? -(BigInt(t.cashExpensesCents) + BigInt(t.fixedExpensesCents)) : null;
  return [
    { etiqueta: GLOSARIO.entro.nombre, valor: pesos(t.collectedCents), nota: 'Lo cobrado en el mes, menos devoluciones' },
    { etiqueta: GLOSARIO.ganado.nombre, valor: pesos(t.accruedCents), nota: 'El servicio que ya se dio en el mes' },
    ...(gastos !== null ? [{ etiqueta: GLOSARIO.gastos.nombre, valor: pesos(gastos), nota: 'De caja, faltantes de los cortes y fijos' }] : []),
    // El costo llega en negativo y se lee sin signo; solo si la tienda vendió algo con costo (D-21).
    ...(t.costOfGoodsCents !== undefined && BigInt(t.costOfGoodsCents) !== 0n ? [{ etiqueta: GLOSARIO.costoVendido.nombre, valor: pesos(-BigInt(t.costOfGoodsCents)), nota: 'De la tienda' }] : []),
    ...(t.profitCents !== undefined ? [{ etiqueta: GLOSARIO.utilidad.nombre, valor: pesos(t.profitCents), nota: 'Ganado menos gastos y costo de lo vendido', ...(BigInt(t.profitCents) < 0n ? { tono: 'danger' as const } : {}) }] : []),
    ...(t.ownerDrawsCents !== undefined && BigInt(t.ownerDrawsCents) !== 0n ? [{ etiqueta: 'Retiros del dueño', valor: pesos(t.ownerDrawsCents), nota: 'Se anotan; no restan de la utilidad' }] : []),
    { etiqueta: GLOSARIO.porPrestar.nombre, valor: pesos(t.deferredCents) },
    { etiqueta: GLOSARIO.porCobrar.nombre, valor: pesos(t.outstandingCents), nota: 'Lo que deben los socios al día de hoy' },
    { etiqueta: 'Socios activos', valor: t.activeMembers.toLocaleString('es-MX') },
  ];
}

/**
 * CERRAR EL MES (fase 4; auditoría 8, bloque 1.9): el gerente lo cierra, el
 * dueño firma, y desde ahí la foto del mes no se reescribe. Antes de pedir la
 * firma se ve lo que va a pasar (`GET /reports/monthly-close/preview`): lo
 * que lo impide, lo que conviene saber y las cifras que quedan congeladas.
 *
 * Fase 3, bloque 3.7: las cifras quedan FIJAS y una caja abierta de ese mes
 * impide cerrar (D-22). Sin un gerente que administre, lo cierra la dueña con
 * su contraseña, sin segunda firma (D-23): el servidor dice cuál de los dos
 * caminos toca (`signature`).
 */
export function CerrarMesDialog({ month, onClose, onHecho }: { month: string; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('Cierre contable del mes');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => api<MonthlyClosePreview>(`/reports/monthly-close/preview?month=${month}`), [month]);
  const previa = useCarga(cargar);
  const p = previa.datos;
  const bloqueos = p?.blockers.map((b) => b.message) ?? [];
  // Sin la vista previa (llegando o con error) no se firma a ciegas; con un bloqueo, tampoco.
  const puedeCerrar = !!p && sePuedeSeguir(bloqueos);
  // Sin gerente que administre, cierra la dueña con su contraseña (D-23).
  const sola = p?.signature === 'own-password';
  // El botón queda encendido: si falta el motivo (o su contraseña), el campo lo dice (26-02).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO, clave: sola && !clave && 'Escribe tu contraseña' });

  async function cerrar(approvalToken?: string) {
    setEnviando(true); setError(null);
    try {
      await api('/reports/monthly-close', { method: 'POST', body: JSON.stringify({ month, reason: motivo.trim(), ...(nota.trim() ? { note: nota.trim() } : {}), ...(sola ? { password: clave } : { approvalToken }) }) });
      toast('ok', `${nombreMes(month)} quedó cerrado`);
      onHecho();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      // El error de la acción sale en el pie de su diálogo; la vista previa se vuelve a pedir por si cambió algo.
      else { setError(errorText(e, 'No se pudo cerrar el mes')); if (!(e instanceof ApiError && e.status === 401)) void previa.recargar(); }
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title={`Cerrar ${nombreMes(month)}`} error={error}
        sub={sola ? 'Queda la foto del mes con estas cifras, total y por sucursal. No hay gerente: lo cierras tú con tu contraseña.' : 'Queda la foto del mes con estas cifras, total y por sucursal. El dueño firma.'}
        footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button icon={<Lock />} loading={enviando} disabled={!puedeCerrar} onClick={() => void f.enviar(() => (sola ? cerrar() : setAutorizando(true)))}>Cerrar el mes</Button></>}>
        <div className="stack">
          <VistaPrevia titulo="Las cifras que quedan en la foto" cargando={previa.cargando && !p} error={previa.error} onReintentar={() => void previa.recargar()}
            bloqueos={bloqueos} avisos={p?.warnings.map((w) => w.message) ?? []} cifras={p ? cifrasDelCierre(p.totals) : []} />
          {puedeCerrar && <>
            <Callout tone="info">Un mes cerrado no se reescribe ni se vuelve a abrir: sus cifras quedan fijas. Lo que llegue después se anota en el mes en curso como «ajuste de {nombreMes(month)}».</Callout>
            <CampoMotivo id="cm-m" value={motivo} onChange={setMotivo} error={f.error('motivo')} />
            <Field label="Nota para el contador (opcional)" htmlFor="cm-n"><input id="cm-n" className="input" value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="Faltó registrar la renta de Norte…" /></Field>
            {sola && (
              <Field label="Tu contraseña" htmlFor="cm-c" hint="Con ella firmas el cierre; queda en la bitácora que lo cerraste tú." error={f.error('clave')}>
                <input id="cm-c" className="input" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
              </Field>
            )}
          </>}
        </div>
      </Dialog>
      {autorizando && (
        // La firma va atada a ESTE mes, y así también se puede pedir al teléfono de la dueña (20-01).
        <AutorizacionDialog permission="reports:month:close" branchId={null} operacion={{ resourceType: 'MonthlyClose', resourceId: idDeCierreDeMes(month) }}
          motivo={motivo} titulo={`Autorizar el cierre de ${nombreMes(month)}`}
          onClose={() => setAutorizando(false)} onAutorizado={(token) => { setAutorizando(false); void cerrar(token); }} />
      )}
    </>
  );
}

/**
 * CIERRES DE MES (14-04, 13-19): los meses terminados que siguen sin cerrar
 * —en diciembre todavía se puede cerrar octubre— y los ya cerrados, con quién
 * cerró y quién firmó. La lista la arma el servidor con la fecha de cada sede.
 */
export function CierresDeMes({ cierres, onCerrar }: { cierres: Carga<MonthlyCloseList>; onCerrar: (mes: string) => void }) {
  const { can } = useSession();
  const d = cierres.datos;
  if (cierres.error) return <div className="mt-20"><ErrorCarga titulo="No se pudieron cargar los cierres de mes" mensaje={cierres.error} onReintentar={() => void cierres.recargar()} /></div>;
  if (!d || (d.closes.length === 0 && d.pending.length === 0)) return null;
  // Lo más reciente arriba: primero lo que falta cerrar, luego lo cerrado.
  const porCerrar = [...d.pending].reverse();
  return (
    <div className="mt-20">
    <Card title="Cierres de mes" sub="La foto de cada mes cerrado, con quién lo cerró y quién lo firmó. Sus cifras ya no cambian." pad={false}>
      <ul className="list" data-testid="cierres-de-mes">
        {porCerrar.map((mes) => (
          <li key={mes} className="list-item">
            <div className="flex-1 min-w-0">
              <span className="strong">{mesConMayuscula(mes)}</span>
              <p className="tiny muted">Ya terminó y sigue abierto.</p>
            </div>
            <Badge tone="warn">Sin cerrar</Badge>
            {can('reports:month:close') && <Button variant="secondary" size="sm" aria-label={`Cerrar ${nombreMes(mes)}`} onClick={() => onCerrar(mes)}>Cerrar</Button>}
          </li>
        ))}
        {d.closes.map((c) => (
          <li key={c.id} className="list-item">
            <div className="flex-1 min-w-0">
              <span className="strong">{mesConMayuscula(c.month)}</span>
              <p className="tiny muted">
                Cerrado el {fecha(c.closedAt)}
                {c.closedByName && ` · cerró ${c.closedByName}`}
                {c.approvedByName ? ` · firmó ${c.approvedByName}` : c.totals.version === 2 && c.closedByName ? ' · con su contraseña, sin gerente' : ''}
                {c.note && ` · Nota: ${c.note}`}
              </p>
            </div>
            <span className="num strong">{pesos(c.totals.profitCents ?? c.totals.accruedCents, { decimals: false })}</span>
            <span className="tiny muted">{c.totals.profitCents !== undefined ? 'utilidad' : 'ganado'}</span>
          </li>
        ))}
      </ul>
    </Card>
    </div>
  );
}
