'use client';

import { useCallback, useEffect } from 'react';
import { Banknote, CreditCard, Landmark } from 'lucide-react';
import type { OpenCashSessionLite, OpenCashSessionsLite } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { hora } from '@/lib/format';
import { useCarga } from '@/lib/carga';
import { Callout, Field, Opciones, type Opcion } from '../ui';
import { useSession } from '../session';

/*
 * LA PIEZA DE COBRO (fase 1.4): cómo se cobra y a qué cajón entra.
 *
 * Es la misma en la ficha, en Caja, en la puerta («Cobrar y abrir»), en la
 * venta, al renovar, en la clase suelta y en la tienda. Antes cada pantalla
 * armaba su cuerpo y la de la excepción cobraba efectivo sin caja (5-11).
 */

export type Metodo = 'CASH' | 'CARD_TERMINAL' | 'SPEI_TRANSFER';
export type Cobro = {
  method: Metodo; cashSessionId: string | null; externalRef: string;
  /** La sede no lleva Caja (ADR-036): no hay turno que elegir. */
  sinCaja?: boolean;
  /** No se pudo saber qué cajas hay porque el puesto no las ve: el servidor pone el cobro en la caja abierta de la sede. */
  cajaAutomatica?: boolean;
};

/** Un cobro recién abierto: efectivo, sin caja elegida todavía. */
export const COBRO_INICIAL: Cobro = { method: 'CASH', cashSessionId: null, externalRef: '' };

const METODOS: ReadonlyArray<Opcion<Metodo>> = [
  { value: 'CASH', label: 'Efectivo', icono: <Banknote /> },
  { value: 'CARD_TERMINAL', label: 'Tarjeta', icono: <CreditCard /> },
  { value: 'SPEI_TRANSFER', label: 'Transferencia', icono: <Landmark /> },
];

const SIN_SESIONES: OpenCashSessionLite[] = [];

/** Efectivo y tarjeta de mostrador pasan por una caja; la transferencia no. */
const usaCaja = (m: Metodo) => m !== 'SPEI_TRANSFER';

/** ¿Está completo el cobro para enviarse? Una transferencia sin referencia no (BE2-02). */
export function cobroListo(c: Cobro): boolean {
  if (c.method === 'SPEI_TRANSFER') return c.externalRef.trim().length > 0;
  return c.sinCaja === true || c.cajaAutomatica === true || !!c.cashSessionId;
}

/** Lo que el cobro manda a la API, igual en todas las rutas que cobran: la caja y la referencia solo si las hay. */
export function cuerpoDelCobro(c: Cobro): { method: Metodo; cashSessionId?: string; externalRef?: string } {
  return {
    method: c.method,
    ...(c.cashSessionId ? { cashSessionId: c.cashSessionId } : {}),
    // La autorización o la clave de rastreo se GUARDA (UXA-09): antes se pedía y se tiraba.
    ...(c.externalRef.trim() ? { externalRef: c.externalRef.trim() } : {}),
  };
}

/**
 * Cómo se cobra: método y, si pasa por caja, en cuál.
 *
 * Con una sola caja abierta se elige sola —es el caso normal—; con varias,
 * se pregunta, porque el corte de cada una tiene que cuadrar. Sin ninguna, lo
 * dice antes de que alguien intente cobrar y reciba un error.
 *
 * Las cajas abiertas llegan por `GET /cash-sessions/open-lite` (7-03): las ve
 * quien cobra, lleve Caja o no, y solo con nombres. Antes, a quien el dueño le
 * quitó Caja no se le preguntaba nada y, con dos cajas abiertas, cada cobro
 * suyo fallaba con «indica en cuál» sin tener dónde indicarlo.
 */
export function CobroFields({ branchId, value, onChange, errores = {} }: {
  branchId: string; value: Cobro; onChange: (c: Cobro) => void;
  /** Errores del servidor por campo (`externalRef`, `cashSessionId`): van debajo del campo, no en un aviso. */
  errores?: Record<string, string>;
}) {
  const { me, activoEn, can } = useSession();
  // Sin el módulo de Caja en esta sede, el efectivo y la terminal se
  // registran sin turno ni corte: no hay nada que elegir ni que abrir.
  const conCaja = activoEn('cash', branchId);

  // Un fallo de red NO es «no hay caja abierta» (MC-04, 26-01): se dice y se
  // reintenta. Un 403 sí tiene salida: el servidor elige la caja abierta.
  const cargarCajas = useCallback(() => api<OpenCashSessionsLite>(`/cash-sessions/open-lite?branchId=${branchId}`)
    .then((r) => r.sessions as OpenCashSessionLite[] | null)
    .catch((e: unknown) => { if (e instanceof ApiError && e.status === 403) return null; throw e; }), [branchId]);
  const cajasCarga = useCarga(conCaja ? cargarCajas : null);
  const sinPermiso = conCaja && cajasCarga.datos === null;
  const eligeCaja = conCaja && !sinPermiso;
  const falloCajas = eligeCaja && !!cajasCarga.error;
  const sesiones = !eligeCaja || falloCajas ? SIN_SESIONES : cajasCarga.datos ?? null;
  const volverARevisar = () => { void cajasCarga.recargar(); };

  useEffect(() => {
    if ((conCaja ? value.sinCaja : !value.sinCaja) || (value.cajaAutomatica ?? false) !== sinPermiso) {
      onChange({ ...value, sinCaja: !conCaja, cajaAutomatica: sinPermiso, cashSessionId: eligeCaja ? value.cashSessionId : null });
    }
  }, [conCaja, eligeCaja, sinPermiso, value, onChange]);

  // Una sola caja abierta: se elige sola. Con varias, la que abrió QUIEN
  // cobra (UXA-08): antes había que elegir cada vez y era fácil cobrar en el
  // turno de otra persona, que después respondía por un dinero ajeno.
  useEffect(() => {
    if (!sesiones || !usaCaja(value.method) || value.cashSessionId) return;
    const mias = sesiones.filter((x) => x.openedByUserId === me.userId);
    const propia = sesiones.length === 1 ? sesiones[0] : mias.length === 1 ? mias[0] : undefined;
    if (propia) onChange({ ...value, cashSessionId: propia.id });
  }, [sesiones, value, onChange, me.userId]);
  // La caja elegida se cerró mientras tanto (otro equipo hizo el corte): se vuelve a elegir.
  useEffect(() => {
    if (sesiones && value.cashSessionId && !sesiones.some((x) => x.id === value.cashSessionId)) onChange({ ...value, cashSessionId: null });
  }, [sesiones, value, onChange]);
  const elegida = sesiones?.find((x) => x.id === value.cashSessionId);
  const ajena = !!elegida && (sesiones?.length ?? 0) > 1 && elegida.openedByUserId !== me.userId;

  return (
    <div className="stack-sm">
      <Opciones forma="tarjetas" compactas columnas={3} className="metodos-cobro" etiqueta="Cómo paga" opciones={METODOS} value={value.method}
        onChange={(m) => onChange({ ...value, method: m, cashSessionId: usaCaja(m) ? value.cashSessionId : null })} />

      {usaCaja(value.method) && !conCaja && (
        <p className="small muted">Esta sucursal no lleva Caja: el cobro se registra sin turno ni corte.</p>
      )}
      {usaCaja(value.method) && sinPermiso && (
        <p className="small muted">El cobro entra a la caja abierta de esta sucursal; el corte lo hace quien lleva la caja.</p>
      )}
      {usaCaja(value.method) && falloCajas && (
        <Callout tone="danger" title="No se pudo consultar la caja">
          <span>Revisa la conexión y vuelve a intentar; mientras, puedes cobrar por transferencia. </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={volverARevisar}>Volver a revisar</button>
        </Callout>
      )}
      {usaCaja(value.method) && eligeCaja && !falloCajas && sesiones !== null && sesiones.length === 0 && (
        <Callout tone="warn" title="No hay caja abierta en esta sucursal">
          {can('cash:session:open')
            ? <span><a href="/caja" target="_blank" rel="noreferrer" className="strong">Abre el turno en Caja</a> para cobrar en efectivo o con tarjeta, o cobra por transferencia. </span>
            : <span>Pide a quien lleva la caja que abra su turno para cobrar en efectivo o con tarjeta, o cobra por transferencia. </span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={volverARevisar}>{can('cash:session:open') ? 'Ya la abrí: volver a revisar' : 'Volver a revisar'}</button>
        </Callout>
      )}
      {usaCaja(value.method) && sesiones && sesiones.length > 1 && (
        <Field label="Caja" htmlFor="caja" required hint="Hay varias abiertas: el cobro entra al corte de la que elijas." error={errores.cashSessionId}>
          <select id="caja" className="select" value={value.cashSessionId ?? ''} onChange={(e) => onChange({ ...value, cashSessionId: e.target.value || null })}>
            <option value="">Elige la caja…</option>
            {sesiones.map((s) => {
              const quien = s.openedByUserId === me.userId ? 'tu turno' : `turno de ${s.openedByName ?? 'otra persona'}`;
              return <option key={s.id} value={s.id}>{s.registerCode ? `${s.registerCode} · ${s.registerName}` : s.registerName} — {quien}, desde {hora(s.openedAt)}</option>;
            })}
          </select>
        </Field>
      )}
      {usaCaja(value.method) && ajena && (
        <Callout tone="warn">Este cobro entra al corte de <strong>{elegida.openedByName ?? 'otra persona'}</strong>, no al tuyo.</Callout>
      )}
      {value.method !== 'CASH' && (
        <Field label={value.method === 'SPEI_TRANSFER' ? 'Referencia de la transferencia' : 'Número de autorización (opcional)'} htmlFor="ref"
          required={value.method === 'SPEI_TRANSFER'} error={errores.externalRef}
          hint={value.method === 'SPEI_TRANSFER' ? 'Es lo que se cruza con el estado de cuenta del banco.' : undefined}>
          <input id="ref" className="input" value={value.externalRef} maxLength={120}
            placeholder={value.method === 'SPEI_TRANSFER' ? 'Clave de rastreo' : 'Del voucher de la terminal'}
            onChange={(e) => onChange({ ...value, externalRef: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
