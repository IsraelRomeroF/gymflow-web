'use client';

import { useCallback, useState } from 'react';
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone, TabletSmartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { EstadoCarga, useCarga } from '@/lib/carga';
import { fechaCorta, hace, hora, hoyEn } from '@/lib/format';
import { ipVisible, suscripcionDeAvisos } from '@/lib/sesion';
import { FIRMAS } from '@/modules/registro';
import { errorText, useSession, useToast } from '@/components/session';
import { Badge, Button, Callout, Card, Dialog, Empty, IconTile, PageHeader } from '@/components/ui';
import { AvisosEnTelefono } from '@/components/push';
import { CambiarClave } from '@/components/shell';

/** Cuántas otras sesiones se ven antes de «Ver todas»: una lista larga empuja todo lo demás (24-05). */
const A_LA_VISTA = 5;

/** Una sesión viva de la cuenta, como la manda `GET /auth/sessions`. */
type Sesion = { id: string; current: boolean; device: string | null; ip: string | null; createdAt: string; lastSeenAt: string; endsAt: string };

/** «a las 19:05» si es hoy; «el 20 nov a las 07:05» si no. */
function cuando(iso: string): string {
  return hoyEn(undefined, new Date(iso)) === hoyEn() ? `a las ${hora(iso)}` : `el ${fechaCorta(iso)} a las ${hora(iso)}`;
}

/** El ícono del equipo, por lo que dice su nombre. */
function IconoDeEquipo({ equipo }: { equipo: string | null }) {
  if (equipo && /iPhone|Teléfono/.test(equipo)) return <Smartphone />;
  if (equipo && /iPad|Tableta/.test(equipo)) return <TabletSmartphone />;
  return <Monitor />;
}

/**
 * MIS SESIONES (bloque 1.12 · 24-04, 24-05, 24-14, 24-15).
 *
 * Dónde está abierta la cuenta, con qué equipo y a qué hora se cierra cada
 * sesión aunque se siga usando. Si a la dueña le roban el teléfono, aquí lo
 * cierra sin tener que adivinar que cambiar la contraseña también lo hacía.
 * Solo salen las sesiones vivas: una lista de sesiones muertas no deja ver
 * si hay alguien más en la cuenta.
 */
export default function MisSesionesPage() {
  const toast = useToast();
  const { can, logout } = useSession();
  const carga = useCarga(useCallback(() => api<Sesion[]>('/auth/sessions'), []));
  const [confirmar, setConfirmar] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [clave, setClave] = useState(false);
  const [todas, setTodas] = useState(false);
  const firma = FIRMAS.some((p) => can(p));

  async function cerrarLasDemas() {
    setCerrando(true);
    try {
      // Los avisos de ESTE equipo se quedan; los de los demás se apagan.
      const sub = await suscripcionDeAvisos();
      const r = await api<{ closed: number; notificationsOff: number }>('/auth/logout-others', { method: 'POST', body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}) });
      toast('ok', r.closed === 0 ? 'No había otras sesiones abiertas.' : `Se cerró tu sesión en ${r.closed} ${r.closed === 1 ? 'equipo' : 'equipos'}.`);
      setConfirmar(false);
      await carga.recargar();
    } catch (e) {
      toast('error', errorText(e, 'No se pudieron cerrar las demás sesiones'));
    } finally {
      setCerrando(false);
    }
  }

  return (
    <>
      <PageHeader title="Mis sesiones" sub="Dónde está abierta tu cuenta y a qué hora se cierra sola. Si ves un equipo que no reconoces, ciérralo y cambia tu contraseña." />

      <EstadoCarga carga={carga} titulo="No se pudieron cargar tus sesiones" esVacio={() => false}>
        {(sesiones) => {
          const actual = sesiones.find((s) => s.current) ?? null;
          const otras = sesiones.filter((s) => !s.current);
          const visibles = todas ? otras : otras.slice(0, A_LA_VISTA);
          const horas = actual ? Math.round((new Date(actual.endsAt).getTime() - new Date(actual.createdAt).getTime()) / 3_600_000) : null;
          return (
            <>
              <div className="stack mb-24">
                <Card title="Esta sesión" sub="La de este equipo." data-testid="esta-sesion">
                  <div className="stack">
                    <div className="row">
                      <IconTile tone="ok"><IconoDeEquipo equipo={actual?.device ?? null} /></IconTile>
                      <div className="flex-1 min-w-0">
                        <p className="small strong">{actual?.device ?? 'Este equipo'}{actual && ipVisible(actual.ip) ? <span className="muted"> · {actual.ip}</span> : null}</p>
                        {actual && <p className="tiny muted">Entraste {cuando(actual.createdAt)}</p>}
                      </div>
                      <Badge tone="ok" dot>Actual</Badge>
                    </div>
                    {actual && (
                      <Callout tone="info" title={`Se cierra ${cuando(actual.endsAt)}`}>
                        <p>{horas ? `Cada sesión dura ${horas} horas desde que entras` : 'Cada sesión dura un tiempo fijo desde que entras'}, aunque la sigas usando. Después vuelves a entrar con tu contraseña.</p>
                      </Callout>
                    )}
                    {firma && <AvisosEnTelefono />}
                    <p className="tiny muted">Al salir con «Cerrar sesión», este equipo deja de recibir tus avisos y se borra lo que GymFlow guardó en el navegador.</p>
                    <div className="row flex-wrap">
                      <Button variant="secondary" size="sm" icon={<KeyRound />} onClick={() => setClave(true)}>Cambiar contraseña</Button>
                      <Button variant="ghost" size="sm" icon={<LogOut />} onClick={() => void logout()}>Cerrar sesión</Button>
                    </div>
                  </div>
                </Card>

                <Card title="Tus otras sesiones" sub="Otros equipos donde tu cuenta sigue abierta." pad={false} data-testid="otras-sesiones"
                  actions={otras.length > 0 ? <Button size="sm" variant="secondary" icon={<LogOut />} onClick={() => setConfirmar(true)} data-testid="cerrar-las-demas">Cerrar las demás ({otras.length})</Button> : undefined}>
                  {otras.length === 0 ? (
                    <Empty icon={<ShieldCheck />} title="Solo está abierta aquí" text="Si entras desde otro equipo, aparece en esta lista." />
                  ) : (
                    <ul className="list">
                      {visibles.map((s) => (
                        <li key={s.id} className="list-item">
                          <IconTile><IconoDeEquipo equipo={s.device} /></IconTile>
                          <div className="flex-1 min-w-0">
                            <p className="small strong">{s.device ?? 'Equipo sin identificar'}{ipVisible(s.ip) ? <span className="muted"> · {s.ip}</span> : null}</p>
                            <p className="tiny muted">Entró {cuando(s.createdAt)} · último uso {hace(s.lastSeenAt)} · se cierra {cuando(s.endsAt)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {otras.length > A_LA_VISTA && (
                    <div className="card-body pt-0">
                      <Button variant="ghost" size="sm" onClick={() => setTodas((t) => !t)}>{todas ? 'Ver menos' : `Ver todas (${otras.length})`}</Button>
                    </div>
                  )}
                </Card>
              </div>

              <Dialog open={confirmar} onClose={() => setConfirmar(false)} size="sm"
                title={`¿Cerrar tu sesión en ${otras.length === 1 ? 'el otro equipo' : `los otros ${otras.length} equipos`}?`}
                footer={<><Button variant="secondary" onClick={() => setConfirmar(false)}>Cancelar</Button><Button loading={cerrando} onClick={() => void cerrarLasDemas()}>Cerrar las demás</Button></>}>
                <div className="stack">
                  <p className="small">
                    Quien esté usando tu cuenta en {otras.length === 1 ? 'ese equipo' : 'esos equipos'} tendrá que volver a entrar con tu contraseña, y {otras.length === 1 ? 'deja' : 'dejan'} de recibir tus avisos. Esta sesión sigue abierta.
                  </p>
                  <ul className="small muted">
                    {otras.slice(0, A_LA_VISTA).map((s) => <li key={s.id}>{s.device ?? 'Equipo sin identificar'} · último uso {hace(s.lastSeenAt)}</li>)}
                    {otras.length > A_LA_VISTA && <li>y {otras.length - A_LA_VISTA} más</li>}
                  </ul>
                  <Callout tone="info">Si no reconoces alguno, cambia también tu contraseña: así nadie vuelve a entrar con la que tenías.</Callout>
                </div>
              </Dialog>
            </>
          );
        }}
      </EstadoCarga>

      {clave && <CambiarClave onClose={() => setClave(false)} />}
    </>
  );
}
