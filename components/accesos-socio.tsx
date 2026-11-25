'use client';

import { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Fingerprint, Hand, ScanFace, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaCorta, hora } from '@gymflow/ui/format';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession, errorText } from './session';
import { Badge, Card, Empty, ErrorCarga, EsqueletoLista } from './ui';

type Decision = {
  id: string; branchId: string; outcome: 'GRANTED' | 'DENIED'; denialReason: string | null; credentialKind: string;
  overrideReason: string | null; recordedByName: string | null; at: string;
};

/** Cómo entró: lo normal es con biometría; el mostrador es la excepción. */
const COMO: Record<string, { label: string; icon: React.ReactNode }> = {
  FACE: { label: 'Rostro', icon: <ScanFace size={14} /> },
  FINGERPRINT: { label: 'Huella', icon: <Fingerprint size={14} /> },
  MANUAL: { label: 'Mostrador', icon: <Hand size={14} /> },
  RFID: { label: 'Tarjeta', icon: <DoorOpen size={14} /> },
  PIN: { label: 'PIN', icon: <DoorOpen size={14} /> },
  QR: { label: 'Código QR', icon: <DoorOpen size={14} /> },
};

/**
 * HISTORIAL DE ACCESOS del socio (2026-10-09): cada vez que entró o se le negó
 * el paso, por dónde y cómo. Las excepciones (entrada por el mostrador, paso
 * concedido) llevan su motivo y quién la registró.
 */
export function AccesosSocio({ memberId }: { memberId: string }) {
  const { branchName, branches } = useSession();
  const [d, setD] = useState<Decision[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [soloExcepciones, setSoloExcepciones] = useState(false);
  const cargar = useCallback(() => {
    setFallo(null); setD(null);
    api<{ decisions: Decision[] }>(`/access/decisions?memberId=${memberId}&limit=200`).then((r) => setD(r.decisions)).catch((e) => setFallo(errorText(e, 'No se pudo cargar el historial')));
  }, [memberId]);
  useEffect(cargar, [cargar]);

  const visibles = (d ?? []).filter((x) => !soloExcepciones || x.overrideReason);
  const entradas = (d ?? []).filter((x) => x.outcome === 'GRANTED').length;
  const excepciones = (d ?? []).filter((x) => x.overrideReason).length;

  if (fallo) return <ErrorCarga mensaje={fallo} onReintentar={cargar} />;
  if (!d) return <Card pad={false}><EsqueletoLista filas={5} /></Card>;
  return (
    <Card pad={false} data-testid="accesos-socio"
      title="Historial de accesos"
      sub={d.length === 0 ? undefined : `${entradas} ${entradas === 1 ? 'entrada' : 'entradas'} · ${excepciones} ${excepciones === 1 ? 'excepción' : 'excepciones'} por el mostrador · lo más reciente primero`}
      actions={excepciones > 0 ? (
        <button type="button" className="chip" aria-pressed={soloExcepciones} onClick={() => setSoloExcepciones((x) => !x)}>Solo excepciones</button>
      ) : undefined}>
      {d.length === 0 ? (
        <Empty icon={<DoorOpen />} title="Todavía no ha entrado" text="Cada entrada con su rostro o huella, y cada excepción por el mostrador, aparecerá aquí con fecha y hora." />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead><tr><th>Fecha</th><th>Resultado</th><th>Cómo</th>{branches.length > 1 && <th>Sucursal</th>}<th>Detalle</th></tr></thead>
            <tbody>
              {visibles.map((x) => {
                const como = COMO[x.credentialKind] ?? { label: x.credentialKind, icon: <DoorOpen size={14} /> };
                return (
                  <tr key={x.id} data-acceso={x.outcome}>
                    <td className="nowrap"><span className="strong">{fechaCorta(x.at)}</span> <span className="muted num">{hora(x.at)}</span></td>
                    <td data-label="Resultado">{x.outcome === 'GRANTED' ? <Badge tone="ok" dot>Entró</Badge> : <Badge tone="danger" dot>No pasó</Badge>}</td>
                    <td data-label="Cómo"><span className="row gap-4 small">{como.icon}{como.label}</span></td>
                    {branches.length > 1 && <td className="small" data-label="Sucursal">{branchName(x.branchId)}</td>}
                    <td className="small stack-full">
                      {x.denialReason && <span className="muted">{DENIAL_REASON[x.denialReason] ?? x.denialReason}</span>}
                      {x.overrideReason && (
                        <span className="row gap-4 items-start"><ShieldAlert size={13} className="text-warn" />
                          <span><strong>Excepción:</strong> «{x.overrideReason}»{x.recordedByName ? ` · la registró ${x.recordedByName}` : ''}</span></span>
                      )}
                      {!x.denialReason && !x.overrideReason && <span className="faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
