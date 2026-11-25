'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ScanFace, ShieldCheck, Trash2, CircleAlert, Server, FileSignature, Gauge } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha } from '@gymflow/ui/format';
import { useSession, useToast, errorText } from '@/components/session';
import { Avatar, Badge, Button, Card, Empty, ErrorCarga, PageHeader, Skeleton, Stat, EsqueletoTabla } from '@/components/ui';
import { useCarga } from '@gymflow/ui/carga';
import { ReglaDelRostro } from '@/components/biometria';
import type { BiometricsSummary, FaceEngineStatus, PendingTemplateDeletion } from '@gymflow/core/contracts';

/** Un borrado de plantilla pendiente: contrato del núcleo (6-17). */
type Pendiente = PendingTemplateDeletion;
type PorRenovar = { memberId: string; memberCode: string; fullName: string; branchIds: string[]; signedVersion: string; signedAt: string };

const PLAZO = 30;

/**
 * LA BIOMETRÍA DEL GIMNASIO (bloque 2.3; antes «obligaciones de borrado»).
 *
 * Cifras reales (6-06): cuántos rostros hay registrados y dónde, quién firmó
 * un texto biométrico anterior al vigente y debe volver a firmarlo (6-03,
 * 21-09), y con qué decide hoy la Estación (motor, umbral, dónde vale un
 * rostro). Las obligaciones de borrado son de los registros de un LECTOR de
 * sucursal: con la cámara (ADR-040) revocar borra en el acto, así que esa
 * tabla solo aparece cuando hay algo de lector.
 */
export default function BiometriaPage() {
  const { can, branchName } = useSession();
  const toast = useToast();
  // Sin red no es «Todo en orden» ni «Ninguna obligación incumplida» (26-01):
  // son obligaciones de ley, y un vacío falso las esconde.
  const carga = useCarga(useCallback(() => api<{ overdue: Pendiente[]; waiting: Pendiente[] }>('/biometric-enrollments/pending-deletion'), []));
  const data = carga.datos ?? null;
  const renovar = useCarga(useCallback(() => api<{ currentVersion: string | null; members: PorRenovar[] }>('/members/biometric-renewals'), []));
  const resumen = useCarga(useCallback(() => api<BiometricsSummary>('/biometric-enrollments/summary'), []));
  // El estado del motor lo ve quien opera la entrada; quien no, no lo pregunta.
  const veElMotor = can('access:monitor');
  const pedirMotor = useCallback(() => api<FaceEngineStatus>('/access/face/status'), []);
  const motor = useCarga(veElMotor ? pedirMotor : null);
  const pendientes = data ? data.overdue.length + data.waiting.length : 0;
  const hayLector = pendientes > 0 || (resumen.datos?.deviceLive ?? 0) > 0;

  async function confirmar(id: string) {
    try {
      await api(`/biometric-enrollments/${id}/template-deleted`, { method: 'POST', body: '{}' });
      toast('ok', 'Borrado confirmado.');
      await carga.recargar();
    } catch (e) {
      toast('error', errorText(e));
    }
  }

  const fila = (p: Pendiente, vencido: boolean) => {
    // El nombre viene con la obligación: el dueño no lee expedientes, pero sí sabe de quién es el borrado.
    const m = p.memberCode ? { memberCode: p.memberCode } : null;
    const nombre = p.memberName ?? 'Socio';
    const dias = p.revokedAt ? Math.ceil((new Date(p.revokedAt).getTime() + PLAZO * 86_400_000 - Date.now()) / 86_400_000) : 0;
    return (
      <tr key={p.id}>
        <td>
          <Link href={`/socios/${p.memberId}?tab=biometria`} className="row gap-10 no-underline">
            <Avatar name={nombre} size={30} />
            <span className="nowrap"><span className="strong">{nombre}</span>{m && <span className="tiny muted block">{m.memberCode}</span>}</span>
          </Link>
        </td>
        <td className="small">{branchName(p.branchId)}</td>
        {/* Revocado y plazo en una celda: la tabla cabe en escritorio y en el teléfono (UI2-03). */}
        <td>
          {vencido ? <Badge tone="danger" dot>Vencido hace {-dias} días</Badge> : <Badge tone="warn" dot>Quedan {dias} días</Badge>}
          <div className="tiny muted mt-2">Revocado {fecha(p.revokedAt)}</div>
        </td>
        <td className="right">
          {can('access:device:manage') && (
            <Button variant="secondary" size="sm" icon={<Trash2 />} aria-label={`Confirmar borrado de ${nombre}`} onClick={() => void confirmar(p.id)}>Confirmar</Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <PageHeader
        title="Biometría"
        sub="Los rostros registrados del gimnasio, quién debe volver a firmar el texto vigente y con qué decide la Estación. Con la cámara de recepción, revocar un rostro lo borra en el acto."
        actions={<Link href="/biometria/medicion" className="btn btn-secondary"><Gauge />Medir el reconocimiento</Link>}
      />

      {carga.error && <div className="mb-24"><ErrorCarga titulo="No se pudieron revisar los borrados pendientes" mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>}
      {!carga.error && <div className="grid grid-3 mb-24">
        {data ? (
          <>
            <Stat feature icon={<ScanFace />} label="Rostros registrados"
              value={resumen.error ? '—' : resumen.datos ? resumen.datos.facesLive : '…'}
              note={resumen.error ? 'No se pudo consultar'
                : !resumen.datos ? ' '
                  : `${resumen.datos.membersWithFace} ${resumen.datos.membersWithFace === 1 ? 'socio' : 'socios'} · ${resumen.datos.enrolledLast30Days} en los últimos 30 días`} />
            <Stat icon={<CircleAlert />} label="Borrados de lector pendientes" value={pendientes} danger={data.overdue.length > 0}
              note={data.overdue.length > 0 ? `${data.overdue.length} con el plazo vencido: requieren acción hoy` : pendientes > 0 ? 'En plazo (30 días)' : hayLector ? 'Ninguna obligación incumplida' : 'Sin registros de lector'} />
            <Stat icon={<FileSignature />} label="Deben volver a firmar"
              value={renovar.error ? '—' : renovar.datos ? renovar.datos.members.length : '…'}
              note={renovar.error ? 'No se pudo consultar'
                : !renovar.datos ? ' '
                  : renovar.datos.currentVersion === null ? 'Sin texto biométrico publicado'
                    : renovar.datos.members.length === 0 ? `Todos firmaron la versión ${renovar.datos.currentVersion}`
                      : `Firmaron un texto anterior a la versión ${renovar.datos.currentVersion}`} />
          </>
        ) : [0, 1, 2].map((i) => <Skeleton key={i} h={112} r={16} />)}
      </div>}

      <div className="grid grid-main">
        <div className="stack">
        <Card title="Rostros por sucursal" sub={motor.datos?.alcance === 'organization' ? 'Un rostro vale en todas las sucursales; aquí, dónde se tomó cada uno.' : 'Cada rostro se reconoce en la sucursal donde se registró.'} pad={false}>
          {resumen.error ? <div className="card-body"><ErrorCarga titulo="No se pudieron contar los rostros" mensaje={resumen.error} onReintentar={() => void resumen.recargar()} /></div>
            : !resumen.datos ? <EsqueletoTabla filas={2} columnas={2} />
              : resumen.datos.byBranch.length === 0
                ? <Empty icon={<ScanFace />} title="Todavía no hay rostros registrados" text="Se registran desde la ficha de cada socio, en la pestaña Biometría, o al terminar su alta." />
                : (
                  <div className="table-wrap">
                    <table className="table tabla-cifras" data-testid="bio-por-sucursal">
                      <thead><tr><th>Sucursal</th><th className="right">Rostros</th>{resumen.datos.deviceLive > 0 && <th className="right">De lector</th>}</tr></thead>
                      <tbody>
                        {resumen.datos.byBranch.map((b) => (
                          <tr key={b.branchId}><td>{branchName(b.branchId)}</td><td className="right num">{b.facesLive}</td>{resumen.datos!.deviceLive > 0 && <td className="right num">{b.deviceLive}</td>}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          {resumen.datos && <p className="card-body tiny muted">Revocados en los últimos 30 días: {resumen.datos.revokedLast30Days}.</p>}
        </Card>

        {(hayLector || carga.error) && <Card title="Obligaciones de borrado" sub="Registros de un lector de sucursal ya revocados: la sucursal tiene 30 días para borrarlos y confirmarlo." pad={false}>
          {carga.error ? <p className="card-body small muted">No se sabe qué falta borrar hasta que la consulta responda.</p>
            : !data ? <EsqueletoTabla filas={3} />
            : data.overdue.length + data.waiting.length === 0
              ? <Empty icon={<ShieldCheck />} title="Todo en orden" text="No hay registros de lector revocados pendientes de borrar en ninguna sucursal." />
              : (
                <div className="table-wrap">
                  <table className="table table-stack">
                    <thead><tr><th>Socio</th><th>Sucursal</th><th>Plazo</th><th /></tr></thead>
                    <tbody>
                      {data.overdue.map((p) => fila(p, true))}
                      {data.waiting.map((p) => fila(p, false))}
                    </tbody>
                  </table>
                </div>
              )}
        </Card>}
        </div>

        <div className="stack">
        {/* Fase 3 · bloque 3.3 (D-06): quién entra sin rostro lo decide esta regla. */}
        <ReglaDelRostro />
        {veElMotor && (
          <Card title="Motor facial" data-testid="bio-motor">
            {motor.error ? <ErrorCarga titulo="No se pudo preguntar por el motor" mensaje={motor.error} onReintentar={() => void motor.recargar()} />
              : !motor.datos ? <Skeleton h={96} r={12} />
                : (
                  <div className="stack-sm">
                    <div className="row gap-8">
                      {motor.datos.disponible ? <Badge tone="ok" dot>Encendido</Badge> : <Badge tone="danger" dot>No disponible</Badge>}
                      {motor.datos.modelo && <span className="small muted">Modelo {motor.datos.modelo}</span>}
                    </div>
                    {!motor.datos.disponible && <p className="small">{motor.datos.motivo ?? 'No responde.'} Sin él no se registran ni se reconocen rostros: se entra por recepción.</p>}
                    <dl className="bio-cifras">
                      <div><dt>Parecido mínimo para reconocer</dt><dd>{motor.datos.umbral?.toFixed(2) ?? '—'}</dd></div>
                      <div><dt>Ventaja sobre el segundo</dt><dd>{motor.datos.margen?.toFixed(2) ?? '—'}</dd></div>
                      <div><dt>Dónde vale un rostro</dt><dd>{motor.datos.alcance === 'organization' ? 'Todo el gimnasio' : 'Su sucursal'}</dd></div>
                    </dl>
                    <p className="tiny muted">El parecido mínimo todavía es el de fábrica: falta medirlo con socios del gimnasio. <Link href="/biometria/medicion" className="enlace-en-linea">Medir el reconocimiento</Link></p>
                  </div>
                )}
          </Card>
        )}
        <Card title="Cómo se protege">
          <div className="stack">
            <Principio icon={<Server />} title="La foto no se guarda"
              text="La cámara de recepción manda la imagen al motor facial del gimnasio, que saca una plantilla; se guarda cifrada en el servidor del gimnasio y la imagen se descarta. Revocarla la borra en el acto." />
            <Principio icon={<ShieldCheck />} title="Sin consentimiento no hay registro"
              text="Se firma aparte, contra el texto publicado, antes de capturar nada. Si el texto cambia, se vuelve a firmar." />
            <Principio icon={<ScanFace />} title="Siempre hay alternativa"
              text="Quien no quiera dar su rostro entra por recepción: con un motivo o, si el gimnasio exige el rostro, con la autorización de la gerencia en cada visita." />
          </div>
        </Card>
        </div>
      </div>

      {renovar.datos && renovar.datos.members.length > 0 && (
        <Card title="Deben volver a firmar" sub={`Su firma biométrica es de un texto anterior a la versión ${renovar.datos.currentVersion}. Se firma en recepción, desde su ficha; su rostro sigue funcionando mientras tanto.`} pad={false} className="mt-20">
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Socio</th><th>Firmó</th><th>Sucursal</th></tr></thead>
              <tbody>
                {renovar.datos.members.map((p) => (
                  <tr key={p.memberId}>
                    <td>
                      <Link href={`/socios/${p.memberId}?tab=biometria`} className="row gap-10 no-underline">
                        <Avatar name={p.fullName} size={30} />
                        <span className="nowrap"><span className="strong">{p.fullName}</span><span className="tiny muted block">{p.memberCode}</span></span>
                      </Link>
                    </td>
                    <td className="small">Versión <code>{p.signedVersion}</code><div className="tiny muted mt-2">{fecha(p.signedAt)}</div></td>
                    <td className="small">{p.branchIds.map((b) => branchName(b)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Principio({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="row items-start">
      <span className="choice-icon">{icon}</span>
      <div>
        <p className="strong small">{title}</p>
        <p className="tiny muted">{text}</p>
      </div>
    </div>
  );
}
