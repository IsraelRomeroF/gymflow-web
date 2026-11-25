'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { ScanFace, Fingerprint, Plus, Building2, RefreshCw, Trash2, FileSignature } from 'lucide-react';
import type { FaceEngineStatus } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { fecha, hace } from '@gymflow/ui/format';
import { MODALITY } from '@/lib/labels';
import { useSession, useToast, errorText } from '../session';
import { Badge, Button, Callout, Card, Empty, Skeleton } from '../ui';
import { esDeLaCamara, PLAZO_BORRADO_DIAS, type Enrollment, type FirmaPorRenovar } from './comun';
import { FirmarTextoVigenteDialog } from './firmar';
import { RevocarDialog } from './revocar';

// El asistente trae la cámara y la captura: se carga cuando alguien lo abre, no con la ficha.
const RegistrarRostroDialog = dynamic(() => import('./registrar').then((m) => m.RegistrarRostroDialog), { ssr: false });

const ICONO = { FACE: ScanFace, FINGERPRINT: Fingerprint } as const;

function diasParaBorrar(revokedAt: string): number {
  const vence = new Date(revokedAt).getTime() + PLAZO_BORRADO_DIAS * 86_400_000;
  return Math.ceil((vence - Date.now()) / 86_400_000);
}

/**
 * PESTAÑA BIOMETRÍA DE LA FICHA: «Cómo entra» (auditoría 8, bloque 2.3).
 *
 * Por sucursal mientras el rostro valga donde se tomó (`alcance: branch`, lo
 * de hoy): así se ve por qué alguien registrado en Centro no entra con su
 * rostro en Norte. Cuando el gimnasio pase a reconocer en todas las
 * sucursales (`organization`, después de medir el umbral), un solo rostro
 * basta y la pestaña lo dice.
 *
 * Solo se ofrece registrar ROSTRO: no hay lector de huella en ninguna
 * sucursal, y ofrecerla hacía firmar para nada (6-04). Una huella que ya
 * exista se sigue viendo y se puede revocar.
 */
export function BiometriaTab({
  memberId, memberName, homeBranchId, onLoaded, porRenovar, onFirmado,
}: {
  memberId: string; memberName: string; homeBranchId: string | null;
  /** Para que la ficha actualice su resumen después de registrar o revocar. */
  onLoaded?: (items: Enrollment[]) => void;
  /** Su firma biométrica es de un texto anterior al vigente: hay que volver a firmar. */
  porRenovar?: FirmaPorRenovar | null;
  /** Después de que firmó el texto vigente. */
  onFirmado?: () => void;
}) {
  const { branches, can, branchName, inScope, activoEn } = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const [items, setItems] = useState<Enrollment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState<{ branchId: string; actualiza: Enrollment | null } | null>(null);
  const [revocar, setRevocar] = useState<Enrollment | null>(null);
  const [firmar, setFirmar] = useState(false);
  const [motor, setMotor] = useState<FaceEngineStatus | null>(null);
  const abiertoSolo = useRef(false);

  const cargar = useCallback(async (): Promise<Enrollment[] | null> => {
    try {
      const r = await api<{ enrollments: Enrollment[] }>(`/members/${memberId}/biometric-enrollments`);
      setItems(r.enrollments);
      onLoaded?.(r.enrollments);
      setError(null);
      return r.enrollments;
    } catch (e) {
      setError(errorText(e, 'No se pudo cargar su biometría'));
      return null;
    }
  }, [memberId, onLoaded]);

  useEffect(() => { void cargar(); }, [cargar]);

  const puedeRegistrar = can('access:biometric:enroll');
  const veElMotor = can('access:monitor');
  // El estado del motor se sabe ANTES de ofrecer el botón (6-04): si está apagado, se dice aquí.
  useEffect(() => {
    if (!puedeRegistrar || !veElMotor) return;
    api<FaceEngineStatus>('/access/face/status').then(setMotor).catch(() => setMotor(null));
  }, [puedeRegistrar, veElMotor]);

  // Sedes donde este usuario puede registrar: la de casa primero.
  const sedes = [...branches.filter((b) => b.isActive)].sort((a, b) =>
    (a.id === homeBranchId ? -1 : 0) - (b.id === homeBranchId ? -1 : 0) || a.name.localeCompare(b.name));
  const vivos = (items ?? []).filter((e) => e.revokedAt === null);
  const sedeParaRegistrar = sedes.find((b) => inScope(b.id) && activoEn('biometrics', b.id) && !vivos.some((e) => e.branchId === b.id && e.modality === 'FACE'))?.id ?? null;

  // «Registrar su rostro» desde el cierre del alta (`?registrar=rostro`): el asistente se abre solo, una vez.
  const pidioRegistrar = params.get('registrar') === 'rostro';
  useEffect(() => {
    if (!pidioRegistrar || abiertoSolo.current || items === null || !puedeRegistrar) return;
    abiertoSolo.current = true;
    if (sedeParaRegistrar && !vivos.some((e) => e.modality === 'FACE')) setRegistrar({ branchId: sedeParaRegistrar, actualiza: null });
    // Solo al terminar la primera carga: `vivos` y la sede salen de `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidioRegistrar, items, puedeRegistrar]);

  async function confirmarBorrado(e: Enrollment) {
    try {
      await api(`/biometric-enrollments/${e.id}/template-deleted`, { method: 'POST', body: '{}' });
      toast('ok', 'Borrado confirmado. La obligación queda cumplida.');
      await cargar();
    } catch (err) {
      toast('error', errorText(err));
    }
  }

  if (error) return <Callout tone="danger" title="Sin datos">{error}</Callout>;
  if (!items) return <div className="grid grid-2"><Skeleton h={200} r={16} /><Skeleton h={200} r={16} /></div>;

  const historial = items.filter((e) => e.revokedAt !== null);
  const enTodoElGimnasio = motor?.alcance === 'organization';
  const conAlgo = new Set(vivos.map((e) => e.branchId));
  const propias = sedes.filter((b) => b.id === homeBranchId || conAlgo.has(b.id));
  // Sin sucursal de casa a la vista ni registros: se enseña la primera donde se le puede registrar.
  const visibles = propias.length > 0 ? propias : sedes.filter((b) => b.id === sedeParaRegistrar);
  // Solo se ofrecen las sucursales donde este usuario puede registrar: ofrecer
  // otra y que la API la rechace al final del asistente es la peor forma de enterarse.
  const otras = sedes.filter((b) => !visibles.includes(b) && inScope(b.id) && activoEn('biometrics', b.id));
  const sinNada = vivos.length === 0;

  return (
    <div className="stack">
      {porRenovar && vivos.length > 0 && (
        <div data-testid="bio-por-renovar">
          <Callout tone="warn" title="Debe volver a firmar su consentimiento">
            <p className="small">
              {memberName} firmó la versión <strong>{porRenovar.signedVersion}</strong> del texto biométrico y la vigente es la <strong>{porRenovar.currentVersion}</strong>.
              Pídele que la lea y la firme. Mientras tanto su rostro sigue funcionando.
            </p>
            {puedeRegistrar && <Button size="sm" variant="secondary" icon={<FileSignature />} className="mt-10" onClick={() => setFirmar(true)}>Leer y firmar la versión {porRenovar.currentVersion}</Button>}
          </Callout>
        </div>
      )}

      {puedeRegistrar && motor && !motor.disponible && (
        <div data-testid="bio-motor-apagado">
          <Callout tone="warn" title="Ahora no se pueden registrar rostros">
            {motor.motivo ?? 'El motor facial no responde.'} Avisa a la gerencia. Mientras tanto {memberName} entra por recepción.
          </Callout>
        </div>
      )}

      <div className="grid grid-main">
        <Card title="Cómo entra" sub={sinNada ? `${memberName} entra por recepción.` : enTodoElGimnasio ? 'Su rostro se reconoce en todas las sucursales; que pase o no lo decide su plan.' : 'Su rostro se reconoce en la sucursal donde se registró; en otra, entra por recepción.'} pad={false}>
          <div className="bio-branch" data-testid="bio-como-entra">
            {visibles.length === 0 && !puedeRegistrar && <Empty icon={<ScanFace />} title="Sin biometría registrada" text={`${memberName} entra por recepción.`} />}
            {visibles.map((b) => {
              const rostro = vivos.find((e) => e.branchId === b.id && e.modality === 'FACE');
              const huella = vivos.find((e) => e.branchId === b.id && e.modality === 'FINGERPRINT');
              const puedeAqui = puedeRegistrar && inScope(b.id);
              return (
                <div key={b.id} className="bio-sede">
                  <div className="row gap-8 mb-8">
                    <Building2 size={16} className="muted" />
                    <span className="strong small">{b.name}</span>
                    {b.id === homeBranchId && <Badge tone="volt">Casa</Badge>}
                  </div>
                  {rostro ? (
                    <Registro e={rostro} acciones={puedeAqui && (
                      <>
                        {esDeLaCamara(rostro) && <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => setRegistrar({ branchId: b.id, actualiza: rostro })}>Actualizar</Button>}
                        <Button variant="ghost" size="sm" onClick={() => setRevocar(rostro)}>Revocar</Button>
                      </>
                    )} />
                  ) : (
                    <div className="bio-slot is-empty">
                      <span className="bio-slot-icon"><ScanFace /></span>
                      <div className="flex-1 min-w-0">
                        <span className="strong">Rostro</span>
                        <p className="tiny muted">Sin registrar en esta sucursal</p>
                      </div>
                      {puedeAqui && activoEn('biometrics', b.id) && (
                        <Button variant={sinNada ? 'primary' : 'secondary'} size="sm" icon={<Plus />} onClick={() => setRegistrar({ branchId: b.id, actualiza: null })}>Registrar rostro</Button>
                      )}
                    </div>
                  )}
                  {huella && <Registro e={huella} acciones={puedeAqui && <Button variant="ghost" size="sm" onClick={() => setRevocar(huella)}>Revocar</Button>} />}
                </div>
              );
            })}
            {puedeRegistrar && !enTodoElGimnasio && otras.length > 0 && (
              <div className="bio-otra">
                <span className="tiny muted flex-1">¿Entrena también en otra sucursal? Su rostro se registra en cada una.</span>
                {otras.map((b) => (
                  <Button key={b.id} variant="ghost" size="sm" icon={<Plus />} onClick={() => setRegistrar({ branchId: b.id, actualiza: null })}>Registrar en {b.name}</Button>
                ))}
              </div>
            )}
            <p className="tiny muted bio-nota">Registro cifrado en el servidor del gimnasio. La imagen no se guarda. Se borra al revocar.</p>
          </div>
        </Card>

        <Card title="Historial" sub="Lo que ya se revocó." pad={false}>
          {historial.length === 0 ? <p className="card-body small muted">Sin registros revocados.</p> : (
            <ul className="bio-historial" data-testid="bio-historial">
              {historial.map((e) => {
                const dias = diasParaBorrar(e.revokedAt!);
                return (
                  <li key={e.id}>
                    <div className="row-between gap-8">
                      <span className="small strong">{MODALITY[e.modality]} · {branchName(e.branchId)}</span>
                      {e.templateDeletedAt
                        ? <Badge tone="ok" dot>Borrado</Badge>
                        : dias < 0
                          ? <Badge tone="danger" dot>Vencido hace {-dias} días</Badge>
                          : <Badge tone="warn" dot>Pendiente · quedan {dias} días</Badge>}
                    </div>
                    <p className="tiny muted">
                      Registrado el {fecha(e.enrolledAt)} · revocado el {fecha(e.revokedAt)}
                      {e.templateDeletedAt ? ` · su registro se borró el ${fecha(e.templateDeletedAt)}` : ' · falta que la sucursal borre el registro del lector'}
                    </p>
                    {!e.templateDeletedAt && can('access:device:manage') && (
                      <Button variant="secondary" size="sm" icon={<Trash2 />} className="mt-10" onClick={() => void confirmarBorrado(e)}>Confirmar borrado</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {registrar && (
        <RegistrarRostroDialog
          memberId={memberId} memberName={memberName} branchId={registrar.branchId}
          actualiza={registrar.actualiza} debeFirmar={!registrar.actualiza || !!porRenovar}
          onClose={() => setRegistrar(null)}
          onDone={async () => { setRegistrar(null); await cargar(); }}
        />
      )}

      <RevocarDialog
        enrollment={revocar}
        memberName={memberName}
        onClose={() => setRevocar(null)}
        onDone={async () => {
          const id = revocar?.id;
          setRevocar(null);
          // Lo que pasó con el registro lo dice la base, no una suposición:
          // el de la cámara se borra en el acto; el de un lector, en 30 días.
          const despues = await cargar();
          const borrada = !!despues?.find((x) => x.id === id)?.templateDeletedAt;
          toast('ok', borrada ? 'Revocado: su registro se borró en el acto.' : `Revocado. La sucursal tiene ${PLAZO_BORRADO_DIAS} días para borrar el registro del lector y confirmarlo.`);
        }}
      />

      {firmar && porRenovar && (
        <FirmarTextoVigenteDialog memberId={memberId} memberName={memberName}
          onClose={() => setFirmar(false)} onDone={() => { setFirmar(false); onFirmado?.(); }} />
      )}
    </div>
  );
}

/** Un rostro o una huella vivos: estado, desde cuándo y con qué texto firmó. */
function Registro({ e, acciones }: { e: Enrollment; acciones: React.ReactNode }) {
  const Icono = ICONO[e.modality];
  return (
    <div className="bio-slot is-live" data-testid={`bio-${e.modality === 'FACE' ? 'rostro' : 'huella'}-vivo`}>
      <span className="bio-slot-icon"><Icono /></span>
      <div className="flex-1 min-w-0">
        <div className="row gap-8">
          <span className="strong">{MODALITY[e.modality]}</span>
          {e.gaps.length === 0 ? <Badge tone="ok" dot>Activo</Badge> : <Badge tone="warn" dot>Incompleto</Badge>}
        </div>
        <p className="tiny muted">
          Registrado {hace(e.enrolledAt)}{e.consentVersion ? ` · consentimiento versión ${e.consentVersion}` : ' · consentimiento firmado'}
          {!esDeLaCamara(e) ? ' · en el lector de la sucursal' : ''}
        </p>
      </div>
      {acciones && <div className="row gap-6">{acciones}</div>}
    </div>
  );
}
