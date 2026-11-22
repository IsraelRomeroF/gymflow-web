'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen, ChevronRight, ShieldCheck, Activity, LogIn, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { hora } from '@/lib/format';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession } from '@/components/session';
import { Avatar, Badge, Card, Empty, PageHeader, Stat } from '@/components/ui';

/**
 * Monitor de acceso en vivo.
 *
 * Se mira de lejos: nombre grande, motivo del rechazo en lenguaje llano. Un
 * rechazo es pulsable y lleva a la pantalla de excepción, que es donde el
 * conflicto se convierte en transacción.
 */

type Decision = {
  id: string;
  outcome: 'GRANTED' | 'DENIED';
  denialReason: string | null;
  memberName: string | null;
  memberCode: string | null;
  branchId: string;
  at: string;
  overrideReason: string | null;
  credentialKind: string;
};

/** Cómo entró: es lo que el subtítulo aporta, en vez de repetir "Entró". */
const MODO_DE_ENTRADA: Record<string, string> = {
  FACE: 'Con su rostro', FINGERPRINT: 'Con su huella', MANUAL: 'Registrado en recepción',
  QR: 'Con código QR', RFID: 'Con tarjeta', PIN: 'Con PIN',
};

export default function AccesoPage() {
  const router = useRouter();
  const { branches } = useSession();
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? '');
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId) return;
    let vigente = true;
    setDecisions(null);
    // Primero las 30 más recientes; después, solo lo nuevo desde la última
    // (`since`). Sin pestaña visible no se pregunta nada, y si no hay
    // movimiento el intervalo se alarga a 15 s (OPT2-02).
    let ultima: string | null = null;
    let quietas = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const cargar = async () => {
      if (document.hidden) { t = setTimeout(() => void cargar(), 5000); return; }
      try {
        const r = await api<{ decisions: Decision[] }>(`/access/monitor?branchId=${branchId}&limit=30${ultima ? `&since=${encodeURIComponent(ultima)}` : ''}`);
        if (!vigente) return;
        if (ultima === null) setDecisions(r.decisions);
        else if (r.decisions.length) setDecisions((prev) => [...r.decisions, ...(prev ?? [])].slice(0, 30));
        quietas = r.decisions.length || ultima === null ? 0 : quietas + 1;
        ultima = r.decisions[0]?.at ?? ultima ?? new Date().toISOString();
        setError(null);
      } catch (e) {
        if (vigente) setError(e instanceof Error ? e.message : 'Error');
      }
      if (vigente) t = setTimeout(() => void cargar(), quietas >= 3 ? 15000 : 5000);
    };
    void cargar();
    const alVolver = () => { if (!document.hidden && t) { clearTimeout(t); void cargar(); } };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vigente = false; if (t) clearTimeout(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [branchId]);

  const entradas = decisions?.filter((d) => d.outcome === 'GRANTED').length ?? 0;
  const rechazos = decisions?.filter((d) => d.outcome === 'DENIED').length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={<span className="row gap-6"><span className="dot dot-live" />En vivo</span>}
        title="Accesos"
        sub="Quién entra y a quién se le negó el paso. Pulsa un rechazo para resolverlo."
        actions={
          <select className="select" style={{ width: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        }
      />

      <div className="grid grid-3 mb-24">
        <Stat icon={<Activity />} label="Últimos movimientos" value={decisions?.length ?? '—'} />
        <Stat icon={<LogIn />} label="Entraron" value={entradas} />
        <Stat icon={<Ban />} label="Rechazados" value={rechazos} danger={rechazos > 0} />
      </div>

      {error && <p className="small text-danger mb-12">{error}</p>}

      <Card pad={false}>
        {decisions && decisions.length === 0 ? (
          <Empty icon={<DoorOpen />} title="Sin accesos todavía" text="Cuando el torniquete de esta sucursal registre un paso, aparecerá aquí al momento." />
        ) : (
          <ul className="list">
            {(decisions ?? []).map((d) => {
              const negado = d.outcome === 'DENIED';
              const accionable = negado && !!d.memberName;
              return (
                <li key={d.id} className={`list-item${accionable ? ' is-link' : ''}`}
                  onClick={() => accionable && router.push(`/acceso/excepcion/${d.id}`)}
                  style={negado ? { background: 'color-mix(in srgb, var(--danger-soft) 55%, transparent)' } : undefined}>
                  <span className={`dot ${negado ? 'dot-danger' : 'dot-ok'}`} />
                  <Avatar name={d.memberName ?? '?'} size={38} />
                  <div className="flex-1 min-w-0">
                    {accionable
                      ? <button type="button" className="strong ellipsis row-link" style={{ fontSize: 15.5 }} onClick={(e) => { e.stopPropagation(); router.push(`/acceso/excepcion/${d.id}`); }}>{d.memberName}</button>
                      : <div className="strong ellipsis" style={{ fontSize: 15.5 }}>{d.memberName ?? 'No reconocido'}</div>}
                    <div className="small muted">
                      {negado ? (DENIAL_REASON[d.denialReason ?? ''] ?? d.denialReason) : (MODO_DE_ENTRADA[d.credentialKind] ?? 'Entró')}
                      {d.overrideReason && <> · <ShieldCheck size={12} style={{ verticalAlign: -2 }} /> paso concedido por recepción</>}
                    </div>
                  </div>
                  {negado ? <Badge tone="danger">Rechazado</Badge> : <Badge tone="ok">Entró</Badge>}
                  <span className="tiny muted num" style={{ minWidth: 44, textAlign: 'right', whiteSpace: 'nowrap' }}>{hora(d.at)}</span>
                  {accionable && <ChevronRight size={16} className="faint" />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
