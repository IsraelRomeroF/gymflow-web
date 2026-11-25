'use client';

import { CalendarClock, History, Hourglass, MessageCircle, Pencil, Phone, PhoneCall, RotateCcw, Send, UserPlus, UserX } from 'lucide-react';
import type { Prospect } from '@gymflow/core/contracts';
import { UNCONTACTED_ALERT_DAYS } from '@gymflow/core/captacion';
import { ESTADO_DE_INTERESADO } from '@gymflow/core/vocabulario';
import { fecha, hace, telefono } from '@gymflow/ui/format';
import { Badge, Button, MenuMas } from '@/components/ui';
import { UltimoContacto } from '@/components/seguimiento';

type Prospecto = Prospect;

/** La palabra sale del vocabulario del núcleo; aquí solo el color. */
const TONO: Record<Prospecto['status'], 'ok' | 'warn' | 'info' | 'volt' | undefined> = {
  NEW: 'volt', CONTACTED: 'info', VISITED: 'info', TRIAL: 'warn', CONVERTED: 'ok', LOST: undefined,
};

export type AccionesDeFila = {
  /** Sin el permiso de dar de alta no se ofrecen acciones: solo se consulta. */
  puede: boolean;
  /** El módulo de Altas digitales está encendido: se ofrece mandar el enlace. */
  conAltas: boolean;
  contactar: (p: Prospecto) => void;
  inscribir: (p: Prospecto) => void;
  cerrar: (p: Prospecto) => void;
  corregir: (p: Prospecto) => void;
  historial: (p: Prospecto) => void;
  mandarAlta: (p: Prospecto) => void;
  reabrir: (p: Prospecto) => void;
  verFicha: (memberId: string) => void;
};

const MS_DIA = 86_400_000;

/** Cuándo toca: lo que ordena la bandeja, dicho en la fila (10-16). */
function Toca({ p, hoy }: { p: Prospecto; hoy: string }) {
  if (p.queue === 'UNCONTACTED') {
    const dias = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / MS_DIA);
    return <Badge tone={dias >= UNCONTACTED_ALERT_DAYS ? 'danger' : 'neutral'}>Registrado {hace(p.createdAt)}</Badge>;
  }
  if (!p.dueOn) return null;
  // Contactado y sin próximo paso: toca decidir qué sigue.
  if (!p.nextStepOn) return <Badge tone="warn"><CalendarClock size={12} />Sin próximo paso</Badge>;
  if (p.nextStepOn > hoy) return <Badge><CalendarClock size={12} />Próximo: {fecha(p.nextStepOn)}</Badge>;
  return <Badge tone="warn"><CalendarClock size={12} />{p.nextStepOn < hoy ? `Tocaba el ${fecha(p.nextStepOn)}` : 'Toca hoy'}</Badge>;
}

/**
 * Las filas de un grupo de la bandeja (o de «Cerrados»). Una acción a la
 * vista, «Contactar»; «Inscribir» al lado; lo demás, en «Más» (10-16: antes
 * eran un `select` y tres botones por fila, 52 controles en pantalla).
 */
export function FilasDeInteresados({ items, hoy, variasSedes, sedeDe, a }: {
  items: readonly Prospecto[]; hoy: string; variasSedes: boolean; sedeDe: (id: string) => string; a: AccionesDeFila;
}) {
  return (
    <div className="table-wrap">
      <table className="table table-stack">
        <thead><tr><th>Persona</th><th>De dónde viene</th><th>{items[0]?.queue ? 'Cuándo toca' : 'Cómo quedó'}</th><th /></tr></thead>
        <tbody>
          {items.map((p) => {
            const completo = `${p.firstName} ${p.lastName}`;
            const cerrado = p.status === 'CONVERTED' || p.status === 'LOST';
            return (
              <tr key={p.id} data-etapa={p.status}>
                <td className="stack-full">
                  <div className="row wrap gap-6">
                    <span className="strong small">{completo}</span>
                    <Badge tone={TONO[p.status]}>{ESTADO_DE_INTERESADO[p.status] ?? p.status}</Badge>
                  </div>
                  <div className="tiny muted row wrap gap-12">
                    {p.phoneE164 && <a href={`tel:${p.phoneE164}`} className="row gap-3 enlace-contacto"><Phone size={11} />{telefono(p.phoneE164)}</a>}
                    {p.phoneE164 && <a href={`https://wa.me/${p.phoneE164.replace('+', '')}`} target="_blank" rel="noreferrer" className="row gap-3 enlace-contacto"><MessageCircle size={11} />WhatsApp</a>}
                    {p.email && <span>{p.email}</span>}
                  </div>
                  {/* El plan que preguntó (D-31): al inscribirlo, la venta abre con él. */}
                  {p.interestPlanName && <div className="tiny muted" data-testid="plan-de-interes">Le interesa: {p.interestPlanName}</div>}
                  {p.notes && <div className="tiny muted">{p.notes}</div>}
                  {p.status !== 'CONVERTED' && <UltimoContacto c={p.lastFollowUp} total={p.followUps} sinProximo />}
                </td>
                <td className="small" data-label="De dónde viene">
                  {p.source ?? '—'}
                  {p.referredByName ? <div className="tiny muted">Lo recomendó {p.referredByName}</div> : null}
                  {variasSedes ? <div className="tiny muted">{sedeDe(p.branchId)}</div> : null}
                </td>
                <td className="small" data-label={cerrado ? 'Cómo quedó' : 'Cuándo toca'}>
                  {cerrado
                    ? (p.status === 'LOST'
                      // El que nadie cerró (D-31): se dice que fue solo, para no buscar quién lo marcó.
                      ? <span className="muted">{p.autoClosed ? `Se cerró solo: ${p.lostReason ?? 'sin contacto'}` : p.lostReason ?? 'Sin motivo anotado'}{p.closedAt ? <span className="tiny"> · {hace(p.closedAt)}</span> : null}</span>
                      : <span className="muted">{p.closedAt ? `Se inscribió ${hace(p.closedAt)}` : 'Se inscribió'}</span>)
                    : <div className="row wrap gap-6">
                        <Toca p={p} hoy={hoy} />
                        {/* A una semana de cerrarse solo (D-31): contactarlo o ponerle fecha lo deja en la lista. */}
                        {p.autoCloseSoon && p.autoCloseOn && (
                          <span data-testid="se-cierra-solo" className="badge-que-se-parte"><Badge tone="danger"><Hourglass size={12} />{p.autoCloseOn <= hoy ? 'Se cierra solo por falta de contacto' : `Se cierra solo el ${fecha(p.autoCloseOn)}`}</Badge></span>
                        )}
                      </div>}
                </td>
                {/* En el teléfono las acciones van en su propio renglón DENTRO de la tarjeta (10-02). */}
                <td className="right text-right acciones-fila">
                  {p.status === 'CONVERTED'
                    ? (p.convertedMemberId ? <Button size="sm" variant="ghost" onClick={() => a.verFicha(p.convertedMemberId!)}>Ver ficha</Button> : null)
                    : !a.puede ? null
                    : p.status === 'LOST'
                      ? <div className="row gap-6 justify-end flex-wrap">
                          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => a.reabrir(p)}>Reabrir</Button>
                          <MenuMas tam="sm" etiqueta={`Más acciones de ${completo}`} items={[{ label: 'Historial de contactos', icon: <History />, onClick: () => a.historial(p) }]} />
                        </div>
                      : <div className="row gap-6 justify-end flex-wrap acciones-en-linea">
                          <Button size="sm" variant="secondary" icon={<PhoneCall />} onClick={() => a.contactar(p)}>Contactar</Button>
                          <Button size="sm" variant="ghost" icon={<UserPlus />} onClick={() => a.inscribir(p)}>Inscribir</Button>
                          {/* Lo que no es de todos los días, y lo que cierra el seguimiento, en «Más». */}
                          <MenuMas tam="sm" etiqueta={`Más acciones de ${completo}`} items={[
                            a.conAltas && { label: 'Mandar alta digital', icon: <Send />, onClick: () => a.mandarAlta(p) },
                            { label: 'Historial de contactos', icon: <History />, onClick: () => a.historial(p) },
                            { label: 'Corregir datos', icon: <Pencil />, onClick: () => a.corregir(p) },
                            { label: 'Ya no se va a inscribir', icon: <UserX />, peligro: true, onClick: () => a.cerrar(p) },
                          ]} />
                        </div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
