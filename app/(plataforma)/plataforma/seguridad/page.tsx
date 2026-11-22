'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCarga } from '@/lib/carga';
import Link from 'next/link';
import { ShieldCheck, Monitor, LogOut, Clock, KeyRound, Globe, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaHora, hace, hora } from '@/lib/format';
import { ipVisible } from '@/lib/sesion';
import { useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, Card, ErrorCarga, PageHeader, EsqueletoPagina, EsqueletoTabla, Empty } from '@/components/ui';
import { IconTile } from '@/components/compartido';

type Seguridad = {
  policy: { sessionHours: number; idleMinutes: number; stepUpMinutes: number; allowedIps: string[] };
  /** Solo las vivas, con su equipo y a qué hora se cierran (24-05). */
  sessions: Array<{ id: string; ip: string | null; deviceLabel: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; endsAt?: string; current: boolean }>;
  accounts: Array<{ id: string; fullName: string; email: string; isActive: boolean; lastLoginAt: string | null; mustChangePassword: boolean; failedLogins: number; locked: boolean }>;
};
/** Un asiento de la cadena de plataforma (`GET /platform/audit`): quién, qué, sobre qué marca y por qué. */
type Asiento = { id: string; at: string; occurredAt: string; action: string; phrase: string; actor: string | null; organizationId: string | null; tradeName: string | null; reason: string | null };
type Cadena = { entries: Asiento[]; nextCursor: string | null };
type Verificacion = { ok: boolean; entries: number; reason: string | null; links: { linked: number; broken: number; unmirrored: number; previous: number } };

/**
 * SEGURIDAD DE LA PLATAFORMA. Esta consola libera, suspende y cobra a todos
 * los gimnasios: aquí se ve con qué reglas se protege, desde dónde está
 * abierta la cuenta, quién más puede entrar y qué hizo la plataforma en
 * cada marca.
 */
export default function SeguridadPage() {
  const toast = useToast();
  const [d, setD] = useState<Seguridad | null>(null);
  const [fallo, setFallo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const cargar = useCallback(() => { setFallo(false); api<Seguridad>('/platform/security').then(setD).catch(() => setFallo(true)); }, []);
  useEffect(cargar, [cargar]);

  async function cerrarOtras() {
    setCerrando(true);
    try {
      const r = await api<{ closed: number }>('/platform/sessions/close-others', { method: 'POST', body: '{}' });
      toast('ok', r.closed === 0 ? 'No había otras sesiones abiertas.' : `Se cerraron ${r.closed} ${r.closed === 1 ? 'sesión' : 'sesiones'}.`);
      cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudieron cerrar')); } finally { setCerrando(false); }
  }

  if (fallo) return <ErrorCarga mensaje="No se pudo cargar la seguridad de la plataforma." onReintentar={cargar} />;
  if (!d) return <EsqueletoPagina cifras={4} />;
  const otras = d.sessions.filter((s) => !s.current).length;
  return (
    <>
      <PageHeader title="Seguridad" sub="Esta consola libera, suspende y cobra a todos los gimnasios. Estas son las reglas con las que se protege y lo que ha hecho." />

      <div className="grid grid-4 mb-24" data-testid="politica">
        <Regla icon={<ShieldCheck />} titulo="Contraseña" valor="12 caracteres o más" nota="Cinco intentos fallidos bloquean la cuenta" />
        <Regla icon={<KeyRound />} titulo="Reconfirmar cambios" valor={`Cada ${d.policy.stepUpMinutes} min`} nota="Toda acción que modifica pide tu contraseña" />
        {/* Se cierra a lo primero que llegue: los minutos sin uso o las horas desde que se entró (24-04). */}
        <Regla icon={<Clock />} titulo="Sesión" valor={`${d.policy.idleMinutes} min sin uso`}
          nota={`Ahí se cierra. Aunque se use sin parar, dura como máximo ${d.policy.sessionHours} h desde que entraste`} />
        <Regla icon={<Globe />} titulo="Desde dónde" tono={d.policy.allowedIps.length ? 'ok' : 'warn'}
          valor={d.policy.allowedIps.length ? `${d.policy.allowedIps.length} red${d.policy.allowedIps.length === 1 ? '' : 'es'} permitida${d.policy.allowedIps.length === 1 ? '' : 's'}` : 'Cualquier red'}
          nota={d.policy.allowedIps.length ? d.policy.allowedIps.join(', ') : 'Abierta: conviene limitarla a la red de tu oficina (ver la guía de uso local)'} />
      </div>

      <div className="grid grid-2 mb-24">
        <Card title="Tus sesiones abiertas" sub="Dónde está abierta esta cuenta ahora." pad={false} data-testid="sesiones"
          actions={otras > 0 ? <Button size="sm" variant="secondary" icon={<LogOut />} loading={cerrando} onClick={() => void cerrarOtras()}>Cerrar las otras ({otras})</Button> : undefined}>
          <ul className="list">
            {d.sessions.map((s) => (
              <li key={s.id} className="list-item">
                <IconTile tone={s.current ? 'ok' : 'neutral'}><Monitor /></IconTile>
                <div className="flex-1">
                  <p className="small strong">{s.current ? 'Esta sesión' : s.deviceLabel ?? 'Equipo sin identificar'}{s.current && s.deviceLabel ? <span className="muted"> · {s.deviceLabel}</span> : null}{ipVisible(s.ip) ? <span className="muted"> · {s.ip}</span> : null}</p>
                  <p className="tiny muted">Abierta {fechaHora(s.createdAt)} · último uso {hace(s.lastSeenAt)}{s.endsAt ? ` · se cierra a más tardar a las ${hora(s.endsAt)}` : ''}</p>
                </div>
                {s.current && <Badge tone="ok" dot>Actual</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Cuentas de plataforma" sub="Quién puede entrar a esta consola." pad={false} data-testid="cuentas">
          <ul className="list">
            {d.accounts.map((c) => (
              <li key={c.id} className="list-item">
                <div className="flex-1">
                  <p className="small strong">{c.fullName}</p>
                  <p className="tiny muted">{c.email} · {c.lastLoginAt ? `entró ${hace(c.lastLoginAt)}` : 'nunca ha entrado'}</p>
                </div>
                <div className="row gap-6 flex-wrap justify-end">
                  {!c.isActive && <Badge>Dada de baja</Badge>}
                  {c.locked && <Badge tone="danger" dot>Bloqueada por intentos</Badge>}
                  {c.mustChangePassword && <Badge tone="warn" dot>Contraseña temporal</Badge>}
                  {c.isActive && !c.locked && !c.mustChangePassword && <Badge tone="ok" dot>Activa</Badge>}
                </div>
              </li>
            ))}
          </ul>
          <p className="tiny muted card-body pt-0">Las cuentas de plataforma solo se crean desde el servidor, nunca desde esta consola: así nadie con una sesión robada puede crearse otra.</p>
        </Card>
      </div>

      <Actividad />
    </>
  );
}

function Regla({ icon, titulo, valor, nota, tono = 'ok' }: { icon: React.ReactNode; titulo: string; valor: string; nota: string; tono?: 'ok' | 'warn' }) {
  return (
    <div className="card stat" data-tono={tono}>
      <div className="row gap-8"><IconTile tone={tono} size="sm">{icon}</IconTile><span className="stat-label">{titulo}</span></div>
      <div className="stat-value stat-value--text">{valor}</div>
      <div className="stat-note">{nota}</div>
    </div>
  );
}

/**
 * LO QUE HIZO LA PLATAFORMA (24-19, 23-09): se lee de su propia cadena
 * (`GET /platform/audit`), que trae lo que GymFlow hizo en cada marca y lo
 * que solo pasa aquí —entrar, reconfirmar, cambiar la contraseña, precios y
 * planes—, con quién lo hizo. «Verificar» recorre la cadena y su enlace con
 * las bitácoras de las marcas.
 */
function Actividad() {
  const toast = useToast();
  const pedir = useCallback(() => api<Cadena>('/platform/audit?limit=50'), []);
  const carga = useCarga(pedir);
  const [mas, setMas] = useState<Asiento[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [verificada, setVerificada] = useState<Verificacion | null>(null);
  const filas = [...(carga.datos?.entries ?? []), ...mas];
  const siguiente = cursor === undefined ? carga.datos?.nextCursor ?? null : cursor;

  async function verMas() {
    if (!siguiente) return;
    setCargandoMas(true);
    try {
      const r = await api<Cadena>(`/platform/audit?limit=50&cursor=${encodeURIComponent(siguiente)}`);
      setMas((m) => [...m, ...r.entries]); setCursor(r.nextCursor);
    } catch (e) { toast('error', errorText(e, 'No se pudo cargar más')); } finally { setCargandoMas(false); }
  }
  async function verificar() {
    setVerificando(true);
    try { setVerificada(await api<Verificacion>('/platform/audit/verify')); } catch (e) { toast('error', errorText(e, 'No se pudo verificar la bitácora')); } finally { setVerificando(false); }
  }

  return (
    <Card title="Lo que hizo la plataforma" sub="En la consola y en todas las marcas, lo más reciente primero. Cada marca guarda lo suyo también en su propia bitácora." pad={false} data-testid="actividad"
      actions={<Button size="sm" variant="secondary" icon={<Link2 />} loading={verificando} onClick={() => void verificar()}>Verificar</Button>}>
      {verificada && (
        <div className="card-body" data-testid="verificacion">
          {verificada.ok
            ? <Callout tone="ok" title="La bitácora de la plataforma está íntegra">{verificada.entries} {verificada.entries === 1 ? 'asiento encadenado' : 'asientos encadenados'}, sin huecos ni cambios; {verificada.links.linked} {verificada.links.linked === 1 ? 'coincide' : 'coinciden'} con la bitácora de su marca.{verificada.links.previous > 0 ? ` Hay ${verificada.links.previous} anteriores a la cadena, todavía sin importar.` : ''}</Callout>
            : <Callout tone="danger" title="La bitácora de la plataforma no cuadra">{verificada.reason ?? 'Un asiento fue alterado o borrado.'} ({verificada.links.broken} con el enlace roto, {verificada.links.unmirrored} sin su espejo.) Hay que revisarlo en el servidor antes de seguir.</Callout>}
        </div>
      )}
      {carga.error ? <div className="card-body"><ErrorCarga mensaje={carga.error} onReintentar={() => void carga.recargar()} /></div>
        : !carga.datos ? <EsqueletoTabla filas={6} columnas={5} />
          : filas.length === 0 ? <Empty icon={<ShieldCheck />} title="Todavía nada" text="Aquí aparece cada ingreso a la consola, alta, liberación, suspensión, cambio de precio o de plan y factura." /> : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Marca</th><th>Motivo</th></tr></thead>
                <tbody>
                  {filas.map((a) => (
                    <tr key={a.id} data-accion={a.action}>
                      <td className="small nowrap">{fechaHora(a.occurredAt)}</td>
                      <td className="small" data-label="Quién">{a.actor ?? 'GymFlow (automático)'}</td>
                      <td className="small" data-label="Qué">{a.phrase}</td>
                      <td className="small" data-label="Marca">{a.organizationId ? <Link href={`/plataforma/${a.organizationId}`} className="row-link">{a.tradeName ?? 'Marca'}</Link> : <span className="muted">Consola</span>}</td>
                      <td className="small muted" data-label="Motivo">{a.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      {siguiente && filas.length > 0 && <div className="card-foot"><Button size="sm" variant="ghost" loading={cargandoMas} onClick={() => void verMas()}>Ver más</Button></div>}
    </Card>
  );
}
