'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Camera, CircleCheck, CircleX, FileSignature, RefreshCw, ScanFace, Server, ShieldCheck } from 'lucide-react';
import type { FaceEngineStatus, FaceEnrollmentResult } from '@gymflow/core/contracts';
import { api, motivoDe } from '@/lib/api';
import { comprobarCamara } from '../camara-rostro';
import { useSession, errorText } from '../session';
import { Badge, Button, Callout, Dialog, IconTile, Skeleton, Switch } from '../ui';
import { CapturaDeFrente, type Captura } from './captura-de-frente';
import { textoBiometricoVigente, type DocVigente, type Enrollment } from './comun';

/**
 * ASISTENTE «REGISTRAR EL ROSTRO» (auditoría 8, bloque 2.3; 6-04, 6-05, 6-09, 6-14).
 *
 * Antes eran tres pasos (modalidad, firma y motivo, captura) y el socio
 * firmaba antes de saber si se podía capturar: con el motor apagado o la
 * cámara negada por el navegador, «ya firmé y no sirvió». Ahora:
 *
 *  0. COMPROBACIÓN PREVIA, antes de pedirle nada al socio: el motor facial
 *     responde, este navegador presta la cámara y hay un texto biométrico
 *     publicado. Si algo falla se dice en palabras de mostrador y NO se firma.
 *  1. Consentimiento: el texto vigente y la aceptación. Sin motivo (D6-06):
 *     la firma es el motivo. Se salta al «Actualizar» si ya firmó el vigente.
 *  2. Captura de frente, revisada por el motor antes de habilitar el botón.
 *
 * «Actualizar» (`actualiza`) usa el mismo asistente: el rostro nuevo sustituye
 * al anterior en una operación, sin revocar aparte.
 */
type Revision = {
  motor: { ok: boolean; motivo: string | null };
  camara: { ok: boolean; motivo: string | null };
  texto: { ok: boolean; motivo: string | null };
  doc: DocVigente | null;
};

async function revisar(): Promise<Revision> {
  const [motor, camara, doc] = await Promise.all([
    api<FaceEngineStatus>('/access/face/status').catch((e: unknown) => ({ disponible: false, motivo: errorText(e, 'No se pudo preguntar por el motor facial.') })),
    comprobarCamara(),
    textoBiometricoVigente().then((d) => ({ ok: true as const, d })).catch((e: unknown) => ({ ok: false as const, d: null, motivo: errorText(e, 'No se pudo consultar el texto de consentimiento.') })),
  ]);
  return {
    motor: { ok: motor.disponible, motivo: motor.disponible ? null : `${motor.motivo ?? 'El motor facial no responde.'} Avisa a la gerencia: sin él no se registran rostros.` },
    camara: { ok: camara.ok, motivo: camara.ok ? null : camara.motivo },
    texto: doc.ok
      ? { ok: doc.d !== null, motivo: doc.d ? null : 'No hay un texto de consentimiento biométrico publicado: sin él no hay nada que el socio pueda firmar.' }
      : { ok: false, motivo: doc.motivo },
    doc: doc.d,
  };
}

export function RegistrarRostroDialog({
  memberId, memberName, branchId, actualiza, debeFirmar = true, onClose, onDone,
}: {
  memberId: string; memberName: string; branchId: string;
  /** El rostro vivo que se sustituye («Actualizar»). Sin él, es un registro nuevo. */
  actualiza?: Enrollment | null;
  /** Al actualizar: ¿tiene que firmar el texto vigente? (firmó uno anterior). Un registro nuevo siempre firma. */
  debeFirmar?: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const { branchName, can } = useSession();
  const [revision, setRevision] = useState<Revision | null>(null);
  const [paso, setPaso] = useState<'consentimiento' | 'captura'>('consentimiento');
  const [acepta, setAcepta] = useState(false);
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<FaceEnrollmentResult | null>(null);
  // Si la API dice que el texto cambió mientras tanto, se le pide la firma aunque la ficha creyera que no hacía falta.
  const [firmaPedida, setFirmaPedida] = useState(false);

  const firma = !actualiza || debeFirmar || firmaPedida;
  const comprobar = useCallback(async () => { setRevision(null); setRevision(await revisar()); }, []);
  useEffect(() => { void comprobar(); }, [comprobar]);

  const todoListo = !!revision && revision.motor.ok && revision.camara.ok && revision.texto.ok;
  const verbo = actualiza ? 'Actualizar' : 'Registrar';
  const titulo = actualiza ? `Actualizar el rostro de ${memberName}` : `Registrar el rostro de ${memberName}`;

  async function enviar() {
    if (!captura || !revision?.doc) return;
    setEnviando(true); setError(null);
    try {
      const r = actualiza
        ? await api<FaceEnrollmentResult>(`/biometric-enrollments/${actualiza.id}/renew`, {
          method: 'POST', body: JSON.stringify({ frames: captura.frames, ...(firma ? { documentVersion: revision.doc.version } : {}) }),
        })
        : await api<FaceEnrollmentResult>(`/members/${memberId}/biometric-enrollments/face`, {
          method: 'POST', body: JSON.stringify({ branchId, frames: captura.frames }),
        });
      setHecho(r);
    } catch (e) {
      if (motivoDe(e) === 'CONSENT_TEXT_CHANGED') {
        // El texto cambió: vuelve al paso de la firma con el vigente a la vista.
        setFirmaPedida(true); setAcepta(false); setPaso('consentimiento');
        void comprobar();
      }
      setError(errorText(e, actualiza ? 'No se pudo actualizar el rostro' : 'No se pudo registrar el rostro'));
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    return (
      <Dialog open onClose={() => void onDone()} title={actualiza ? 'Rostro actualizado' : 'Rostro registrado'}>
        <div className="bio-cierre" data-testid="rostro-registrado">
          <IconTile tone="ok" size="lg"><CircleCheck /></IconTile>
          <p className="empty-title">{memberName} ya entra con su rostro en {branchName(branchId)}</p>
          <p className="empty-text">
            {actualiza ? 'El rostro anterior se borró en el acto.' : `Firmó la versión ${hecho.consentVersion ?? revision?.doc?.version ?? ''} del consentimiento biométrico.`}{' '}
            {can('access:monitor') ? <>Puede probarlo ahora en la <Link href="/estacion" className="row-link">Estación de acceso</Link>.</> : 'Puede probarlo ahora en la Estación de acceso.'}
          </p>
        </div>
        <Button block className="mt-10" onClick={() => void onDone()}>Listo</Button>
      </Dialog>
    );
  }

  // Paso 0: todavía revisando, o algo falta. Aquí no se le pide nada al socio.
  if (!todoListo) {
    return (
      <Dialog open size="lg" onClose={onClose} title={titulo} sub="Antes de pedirle nada, se comprueba que se puede registrar."
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          {revision && <Button icon={<RefreshCw />} onClick={() => void comprobar()}>Volver a comprobar</Button>}
        </>}>
        {!revision ? (
          <div className="stack" aria-busy data-testid="bio-comprobando"><Skeleton h={56} r={12} /><Skeleton h={56} r={12} /><Skeleton h={56} r={12} /></div>
        ) : (
          <div className="stack" data-testid="bio-no-se-puede">
            <Callout tone="warn" title="Ahora no se puede registrar su rostro">
              No le pidas que firme todavía. {memberName} entra por recepción mientras tanto.
            </Callout>
            <ul className="bio-revision">
              <Renglon icono={<Server />} titulo="Motor facial" estado={revision.motor} bien="Encendido" />
              <Renglon icono={<Camera />} titulo="Cámara de esta computadora" estado={revision.camara} bien="Disponible" />
              <Renglon icono={<FileSignature />} titulo="Texto de consentimiento biométrico" estado={revision.texto} bien={`Publicado${revision.doc ? ` · versión ${revision.doc.version}` : ''}`}
                accion={!revision.texto.ok && can('settings:org') ? <Link href="/consentimientos" className="row-link">Publicarlo en Textos de consentimiento</Link> : null} />
            </ul>
          </div>
        )}
      </Dialog>
    );
  }

  const doc = revision.doc!;
  const enCaptura = !firma || paso === 'captura';
  return (
    <Dialog
      open size="lg" onClose={() => { if (!enviando) onClose(); }}
      title={titulo}
      sub={actualiza ? `El rostro nuevo sustituye al anterior en ${branchName(branchId)}.` : `En ${branchName(branchId)}. Primero su consentimiento, después la captura.`}
      error={error}
      footer={
        <>
          {firma && enCaptura && <Button variant="ghost" onClick={() => { setPaso('consentimiento'); setError(null); }} disabled={enviando}>Atrás</Button>}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          {enCaptura
            ? <Button onClick={() => void enviar()} disabled={!captura} loading={enviando} icon={<ShieldCheck />}>{verbo} rostro</Button>
            : <Button onClick={() => { setPaso('captura'); setError(null); }} disabled={!acepta}>Continuar</Button>}
        </>
      }
    >
      {firma && (
        <div className="steps">
          {(['Consentimiento', 'Captura'] as const).map((p, i) => {
            const actual = enCaptura ? 1 : 0;
            return (
              <div key={p} className="step" data-state={i < actual ? 'done' : i === actual ? 'current' : 'todo'}>
                <div className="step-bar" />
                <span className="step-label">{i + 1}. {p}</span>
              </div>
            );
          })}
        </div>
      )}

      {!enCaptura && (
        <div className="stack">
          <div className="row-between">
            <div className="row gap-8">
              <FileSignature size={16} className="muted" />
              <span className="strong small">{doc.title}</span>
            </div>
            <Badge>Versión {doc.version}</Badge>
          </div>
          <div className="doc">{doc.bodyText}</div>
          <Switch checked={acepta} onChange={(v) => setAcepta(v)}><strong>{memberName}</strong> leyó este texto y acepta de forma expresa que se registre su rostro.</Switch>
          <p className="tiny muted">Si no acepta, no pasa nada: sigue entrando por recepción. Esa alternativa es lo que hace libre su consentimiento.</p>
        </div>
      )}

      {enCaptura && (
        <div className="stack">
          {actualiza && !firma && (
            <p className="small muted row gap-6"><ScanFace size={15} /> Ya firmó la versión vigente del consentimiento: no hace falta que firme otra vez.</p>
          )}
          <CapturaDeFrente branchId={branchId} valor={captura} onChange={(c) => { setCaptura(c); setError(null); }} />
        </div>
      )}
    </Dialog>
  );
}

function Renglon({ icono, titulo, estado, bien, accion }: {
  icono: React.ReactNode; titulo: string; estado: { ok: boolean; motivo: string | null }; bien: string; accion?: React.ReactNode;
}) {
  return (
    <li className="bio-revision-fila" data-ok={estado.ok}>
      <span className="bio-slot-icon">{icono}</span>
      <div className="flex-1 min-w-0">
        <p className="small strong">{titulo}</p>
        <p className="tiny muted">{estado.ok ? bien : estado.motivo}</p>
        {accion && <p className="tiny">{accion}</p>}
      </div>
      {estado.ok ? <Badge tone="ok" dot>Listo</Badge> : <Badge tone="warn" dot><CircleX size={12} aria-hidden /> Falta</Badge>}
    </li>
  );
}
