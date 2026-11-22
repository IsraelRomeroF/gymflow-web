'use client';

import { useState } from 'react';
import { Download, UserMinus, ShieldOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession, useToast, errorText } from './session';
import type { MemberPrivacyRequests } from '@gymflow/core/contracts';
import { MOTIVOS_DE_PRIVACIDAD } from '@gymflow/core/privacidad';
import { Button, Callout, Card, CampoMotivo, Dialog } from './ui';
import { AutorizacionDialog } from './autorizacion';

type Socio = { id: string; memberCode: string; firstName: string; status: string; homeBranchId: string | null; anonymizedAt?: string | null };
type Accion = 'exportar' | 'baja' | 'anonimizar';

/**
 * Datos personales del socio (LFPDPPP): entregarle todo lo que se guarda de
 * él (acceso), darlo de baja y, ya de baja, anonimizarlo (cancelación). Lo
 * contable se conserva siempre: lo exige la ley fiscal.
 */
export function PrivacidadCard({ socio, onDone }: { socio: Socio; onDone: () => void }) {
  const { can } = useSession();
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const baja = socio.status === 'ARCHIVED';
  const anonimo = !!socio.anonymizedAt;
  const acciones = [
    can('members:export') && !anonimo && 'exportar',
    can('members:archive') && !baja && 'baja',
    can('members:anonymize') && baja && !anonimo && 'anonimizar',
  ].filter(Boolean) as Accion[];
  if (acciones.length === 0) return null;

  return (
    <Card title="Datos personales y baja" sub="Derechos ARCO del socio. Lo contable se conserva siempre.">
      <div className="row wrap gap-8">
        {acciones.includes('exportar') && <Button size="sm" variant="secondary" icon={<Download />} onClick={() => setAbierta('exportar')}>Descargar sus datos</Button>}
        {acciones.includes('baja') && <Button size="sm" variant="ghost" icon={<UserMinus />} onClick={() => setAbierta('baja')}>Dar de baja</Button>}
        {acciones.includes('anonimizar') && <Button size="sm" variant="danger-ghost" icon={<ShieldOff />} onClick={() => setAbierta('anonimizar')}>Anonimizar</Button>}
      </div>
      {abierta && <AccionDialog socio={socio} accion={abierta} onClose={() => setAbierta(null)} onListo={() => { setAbierta(null); onDone(); }} />}
    </Card>
  );
}

const TEXTO: Record<Accion, { titulo: string; sub: string; boton: string; placeholder: string }> = {
  exportar: {
    titulo: 'Descargar sus datos', boton: 'Descargar',
    sub: 'Un archivo de datos (JSON) con su ficha, firmas, membresías, cobros, visitas, clases y rutinas, para entregárselo; sus notas de salud, solo si tú puedes verlas. La plantilla de su rostro no va en el archivo: se dice dónde se guarda. Queda registrado quién lo descargó.',
    placeholder: 'Lo pidió por escrito en recepción',
  },
  baja: {
    titulo: 'Dar de baja', boton: 'Dar de baja',
    sub: 'Deja de ser socio: su portal, sus credenciales y su rostro dejan de servir en el acto, y sus membresías se cancelan al cierre del día. Su historia se conserva.',
    placeholder: 'Se mudó de ciudad',
  },
  anonimizar: {
    titulo: 'Anonimizar', boton: 'Pedir autorización',
    sub: 'Se borran su nombre, teléfono, correo, notas y salud; se revoca su biometría y la plantilla de su rostro se borra en el acto. No se puede deshacer.',
    placeholder: 'Solicitud de cancelación ARCO por escrito',
  },
};

function AccionDialog({ socio, accion, onClose, onListo }: { socio: Socio; accion: Accion; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const t = TEXTO[accion];

  /** La solicitud de acceso que procede y falta entregar: la descarga la cierra (1.10, 21-03). */
  async function accesoPendiente(): Promise<string | null> {
    if (!can('members:consent:read')) return null;
    try {
      const { requests } = await api<MemberPrivacyRequests>(`/members/${socio.id}/privacy-requests`);
      return requests.find((r) => r.kind === 'ACCESS' && r.status === 'EFFECT_PENDING')?.id ?? null;
    } catch { return null; /* sin la lista, la descarga sigue; la solicitud se marca a mano */ }
  }

  async function ejecutar(approvalToken?: string) {
    setEnviando(true);
    try {
      if (accion === 'exportar') {
        const solicitud = await accesoPendiente();
        const datos = await api<unknown>(`/members/${socio.id}/export?reason=${encodeURIComponent(motivo.trim())}${solicitud ? `&requestId=${solicitud}` : ''}`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = `datos-${socio.memberCode}.json`; a.click();
        URL.revokeObjectURL(url);
        toast('ok', solicitud ? 'Archivo descargado: su solicitud de acceso quedó hecha' : 'Archivo descargado');
      } else if (accion === 'baja') {
        await api(`/members/${socio.id}/archive`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
        toast('ok', `${socio.firstName} quedó dado de baja`);
      } else {
        await api(`/members/${socio.id}/anonymize`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim(), approvalToken }) });
        toast('ok', 'Socio anonimizado');
      }
      onListo();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) setAutorizando(true);
      else toast('error', errorText(e, 'No se pudo'));
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Dialog open onClose={onClose} title={t.titulo} sub={t.sub}
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={accion === 'exportar' ? 'primary' : 'danger'} loading={enviando} disabled={motivo.trim().length < 3}
            onClick={() => (accion === 'anonimizar' ? setAutorizando(true) : void ejecutar())}>{t.boton}</Button></>}>
        <div className="stack">
          {accion === 'anonimizar' && <Callout tone="warn">Los cargos, pagos y asistencias se quedan con su código de socio, que ya no dirá quién es.</Callout>}
          {/* Lo que hace la baja con su deuda (3-02): al cancelarse sus membresías esa noche, el gancho de billing anula las cuotas sin ningún pago. */}
          {accion === 'baja' && (
            <Callout tone="warn" title="Su deuda sin pagar se anula">
              Al cancelarse sus membresías, las cuotas que no tienen ningún pago se anulan y ya no se le cobran; lo que pagó en parte queda como adeudo.
              Si debe algo, cóbralo antes de darlo de baja.
            </Callout>
          )}
          <CampoMotivo id="arco-mot" autoFocus value={motivo} onChange={setMotivo} placeholder={accion === 'exportar' ? undefined : t.placeholder}
            motivos={accion === 'exportar' ? MOTIVOS_DE_PRIVACIDAD.descargarDatos : undefined} />
        </div>
      </Dialog>
      {autorizando && (
        <AutorizacionDialog permission="members:anonymize" branchId={socio.homeBranchId} operacion={{ resourceId: socio.id }} motivo={motivo} titulo="Autorizar la anonimización"
          onClose={() => setAutorizando(false)}
          onAutorizado={(token) => { setAutorizando(false); void ejecutar(token); }} />
      )}
    </>
  );
}
