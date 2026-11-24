'use client';

import { useState } from 'react';
import { CalendarClock, Check, MessageCircle } from 'lucide-react';
import type { PlatformCollections, PlatformNotice } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { enlaceWhatsapp } from '@/lib/entrega-temporal';
import { fecha, masDias, telefono } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { errorText, useToast } from '@/components/session';
import { Badge, Button, Callout, CampoFecha, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Field } from '@/components/ui';
import { dias, hoyDeCobro } from './textos';

/**
 * LA ESCALERA DE COBRANZA EN LA CONSOLA (D-37, bloque 3.11; ADR-046).
 * El servidor decide (`tenants/cobranza-reglas.ts`): aquí se lee cuándo se
 * suspende una marca y por qué todavía no, se le manda al dueño el aviso que
 * no le ha llegado, y se da una prórroga cuando ya se habló con él.
 */
export type Cobranza = PlatformCollections;
export type Aviso = PlatformNotice;
export type Dueno = { id: string; fullName: string; phoneE164: string | null };

const CLASE_DE_AVISO: Record<Aviso['kind'], string> = {
  INVOICE_ISSUED: 'Factura emitida', INVOICE_OVERDUE: 'Factura vencida', SERVICE_SUSPENDED: 'Servicio suspendido',
  PRICE_CHANGE: 'Cambio de mensualidad', PRICE_CHANGE_CANCELED: 'Cambio cancelado',
};
export const claseDeAviso = (a: Pick<Aviso, 'kind'>): string => CLASE_DE_AVISO[a.kind];

/** Qué va a pasar con el servicio de una marca que debe, en una frase. Nada si no debe nada vencido. */
export function fraseDeCobranza(c: Cobranza): { texto: string; tono: 'danger' | 'warn' } | null {
  switch (c.state) {
    case 'EN_PLAZO': return { tono: 'danger', texto: `Si no se registra el pago de ${c.folio}, el servicio se suspende solo el ${fecha(c.suspendsOn!)} (${dias(c.suspendsAfterDays)} de atraso desde que se le avisó; lleva ${c.noticedDays}).` };
    case 'SUSPENDER': return { tono: 'danger', texto: `Ya cumplió ${dias(c.suspendsAfterDays)} de atraso avisado por ${c.folio}: el cierre de hoy suspende el servicio.` };
    case 'PRORROGA': return { tono: 'warn', texto: `En prórroga hasta el ${fecha(c.holdUntil!)}: el sistema no la suspende antes. Si sigue sin pagar ${c.folio}, se suspende el ${fecha(c.suspendsOn!)}.` };
    case 'AVISO_SIN_ENTREGAR': return { tono: 'warn', texto: `${c.folio} lleva ${dias(c.overdueDays)} vencida, pero no hay constancia de que el aviso le llegó al dueño: el sistema no suspende hasta que le llegue. Mándaselo desde aquí.` };
    default: return null;
  }
}

/** Por dónde hay constancia de que el aviso le llegó, o que todavía no. */
export function EntregaDeAviso({ aviso }: { aviso: Aviso }) {
  if (aviso.closedAt && !aviso.deliveredOn) return <Badge tone="neutral">Ya no hizo falta</Badge>;
  if (!aviso.deliveredOn) return <Badge tone="warn" dot>Sin constancia de entrega</Badge>;
  const vias = [aviso.pushedAt && 'notificación a su teléfono', aviso.seenAt && 'lo vio en su panel', aviso.sentAt && 'se le mandó desde aquí'].filter(Boolean).join(' · ');
  return <span><Badge tone="ok" dot>Le llegó el {fecha(aviso.deliveredOn)}</Badge><span className="tiny muted"> {vias}</span></span>;
}

/**
 * Mandarle el aviso al dueño. Con celular, abre WhatsApp con el texto ya
 * escrito y lo anota; sin celular, se anota cuando se le dijo por otra vía.
 * Como en la bandeja de salida (ADR-045): nada sale solo, y queda quién y cuándo.
 */
export function MandarAviso({ aviso, duenos, onHecho }: { aviso: Aviso; duenos: Dueno[]; onHecho: () => void }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const conCelular = duenos.find((d) => enlaceWhatsapp(d.phoneE164, 'x')) ?? null;
  async function anotar() {
    setEnviando(true);
    try {
      await api(`/platform/notices/${aviso.id}/sent`, { method: 'POST' });
      toast('ok', 'Anotado: desde hoy hay constancia de que se le avisó.');
      onHecho();
    } catch (e) { toast('error', errorText(e, 'No se pudo anotar el aviso')); } finally { setEnviando(false); }
  }
  if (aviso.sentAt || aviso.closedAt) return null;
  return (
    <span className="row gap-6 flex-wrap justify-end">
      {conCelular && (
        <Button size="sm" variant="secondary" icon={<MessageCircle />} loading={enviando} title={`${conCelular.fullName} · ${telefono(conCelular.phoneE164)}`}
          onClick={() => { window.open(enlaceWhatsapp(conCelular.phoneE164, `${aviso.title}. ${aviso.body}`)!, '_blank', 'noopener'); void anotar(); }}>Mandar por WhatsApp</Button>
      )}
      <Button size="sm" variant="ghost" icon={<Check />} loading={enviando} onClick={() => void anotar()}>{conCelular ? 'Ya se lo avisé de otra forma' : 'Ya se lo avisé'}</Button>
    </span>
  );
}

/** Los avisos que GymFlow le ha dado al dueño de una marca, con su constancia de entrega. */
export function AvisosDeMarca({ avisos, duenos, onCambio }: { avisos: Aviso[]; duenos: Dueno[]; onCambio: () => void }) {
  if (avisos.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table table-stack" data-testid="avisos-al-dueno">
        <thead><tr><th>Aviso al dueño</th><th>Del</th><th>Constancia</th><th /></tr></thead>
        <tbody>
          {avisos.map((a) => (
            <tr key={a.id} data-aviso={a.kind}>
              <td data-label="Aviso"><span className="strong small">{claseDeAviso(a)}</span><div className="tiny muted">{a.body}</div></td>
              <td data-label="Del" className="small">{fecha(a.noticeOn)}</td>
              <td data-label="Constancia"><EntregaDeAviso aviso={a} /></td>
              <td className="right"><MandarAviso aviso={a} duenos={duenos} onHecho={onCambio} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * PRÓRROGA: hasta ese día, incluido, la suspensión automática no toca a la
 * marca. Es para cuando ya se habló con el dueño; queda con motivo.
 */
export function Prorroga({ organizationId, tradeName, actual, onClose, onHecho }: { organizationId: string; tradeName: string; actual: string | null; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const hoy = hoyDeCobro();
  const tope = masDias(hoy, 60);
  const [hasta, setHasta] = useState(actual ?? masDias(hoy, 7));
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario<'hasta' | 'motivo'>({
    hasta: !hasta ? 'Escribe hasta qué día.' : hasta < hoy ? 'No puede ser anterior a hoy.' : hasta > tope && 'No puede pasar de 60 días.',
    motivo: faltaMotivo(motivo) && ERROR_MOTIVO,
  });
  async function guardar(until: string | null) {
    setError(null);
    try {
      await api(`/platform/organizations/${organizationId}/collections-hold`, { method: 'PUT', body: JSON.stringify({ until, reason: motivo.trim() }) });
      toast('ok', until ? `Prórroga hasta el ${fecha(until)}: el sistema no la suspende antes.` : 'Prórroga quitada.');
      onHecho();
    } catch (e) { setError(errorText(e, 'No se pudo guardar la prórroga')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} error={error} title={`Prórroga para ${tradeName}`}
      sub="Hasta ese día, incluido, el sistema no suspende el servicio por adeudo. Al día siguiente, si sigue debiendo, se suspende."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Volver</Button>
        {actual && <Button variant="danger-ghost" loading={f.enviando} onClick={() => { if (faltaMotivo(motivo)) { void f.enviar(async () => {}); return; } void guardar(null); }}>Quitar prórroga</Button>}
        <Button loading={f.enviando} onClick={() => void f.enviar(() => guardar(hasta))}>Dar prórroga</Button>
      </>}>
      <div className="stack">
        <Field label="No suspender hasta" htmlFor="pr-h" {...f.campo('hasta')}>
          <CampoFecha id="pr-h" className="campo-corto" value={hasta} min={hoy} max={tope} hoy={hoy} onChange={(v) => { setHasta(v); f.limpiar('hasta'); }} />
        </Field>
        <CampoMotivo id="pr-m" value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca."
          motivos={['El dueño confirmó que paga esta semana', 'El pago ya salió y falta que llegue', 'Acuerdo de pago en partes']} />
      </div>
    </Dialog>
  );
}

/** El renglón de cobranza de la tarjeta Cobro de una marca: qué va a pasar y el botón de la prórroga. */
export function RenglonDeCobranza({ cobranza, onProrroga }: { cobranza: Cobranza; onProrroga: () => void }) {
  const frase = fraseDeCobranza(cobranza);
  if (!frase) return null;
  return (
    <div data-testid="cobranza-estado" data-cobranza={cobranza.state}>
      <Callout tone={frase.tono} title={cobranza.state === 'AVISO_SIN_ENTREGAR' ? 'El aviso no le ha llegado al dueño' : 'Suspensión automática por adeudo'}>
        <p>{frase.texto}</p>
        <p className="mt-8"><Button size="sm" variant="secondary" icon={<CalendarClock />} onClick={onProrroga}>{cobranza.holdUntil ? 'Cambiar prórroga' : 'Dar prórroga'}</Button></p>
      </Callout>
    </div>
  );
}
