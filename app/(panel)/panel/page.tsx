'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Wallet, Users, TrendingUp, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import { useSession } from '@/components/session';
import { InicioDuena } from '@/components/inicio-duena';
import { AvisoSolicitudesArco } from '@/components/cumplimiento';
import { ArranqueCard, seVeArranque, useArranque } from '@/components/arranque';
import { MiTurno } from '@/components/mi-turno';
import { Mostrador } from '@/components/mostrador/mostrador';
import { HoyTeToca, useBandejaDelInicio } from '@/components/inicio/hoy-te-toca';
import { InicioCoach } from '@/components/inicio/inicio-coach';
import { PorResolverEnLaPuerta } from '@/components/inicio/por-resolver-puerta';
import { NuevoSocioDialog } from '@/components/socio-form';
import { menuPara } from '@/modules/registro';
import { PageHeader, Stat, Card, Badge, Skeleton, ErrorCarga } from '@/components/ui';
import { useCarga } from '@gymflow/ui/carga';
import type { AsuntoDelInicio, Dashboard } from '@gymflow/core/contracts';

function saludo(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/**
 * Inicio. Contesta «¿qué me toca hoy?» en la primera pantalla (auditoría 8,
 * bloque 2.1; 1-01, 1-03):
 *
 *  · RECEPCIÓN: su inicio ES el mostrador. Arriba el buscador con el foco y la
 *    tarjeta del socio (Entrada, Cobrar, Vender, Clase); luego lo que hay «Por
 *    resolver en la puerta», su turno («Tu caja», entradas, siguiente clase) y
 *    lo pendiente.
 *  · GERENCIA: las cifras de hoy, que se tocan y llevan a su pantalla; «Hoy te
 *    toca» (una llamada, `GET /me/home`); su caja si tiene un turno propio; y
 *    el mismo buscador para atender.
 *  · COACH: su inicio propio (bloque 2.6; 12-04): sus clases de hoy, sus socios
 *    y sus rutinas, sin la afluencia del gimnasio ni «Por resolver».
 *  · La DUEÑA consulta, no opera: tiene su propio inicio (UXD-01, D-24, D-25).
 *
 * Cada bloque aparece solo si el puesto puede actuar sobre él: recepción no ve
 * cifras financieras, y un pendiente que no puedes resolver es ruido.
 */
export default function InicioPage() {
  const { me } = useSession();
  if (me.roleKeys?.includes('OWNER') && !me.roleKeys.includes('MANAGER')) return <InicioDuena />;
  // Quien SOLO es coach (la misma regla con que el servidor le acota los socios).
  if (me.roleKeys?.length && me.roleKeys.every((k) => k === 'COACH')) return <InicioCoach />;
  return <InicioOperacion />;
}

/** Una cifra que lleva a su pantalla, si esta persona la tiene en su menú. */
function CifraTocable({ href, rutas, etiqueta, children }: { href: string; rutas: ReadonlySet<string>; etiqueta: string; children: React.ReactNode }) {
  if (!rutas.has(href.split('?')[0]!)) return <>{children}</>;
  return <Link href={href} className="stat-enlace" aria-label={etiqueta}>{children}</Link>;
}

function InicioOperacion() {
  const router = useRouter();
  const { me, org, branches, can, canOrg, activo, branchName, inScope, mirada } = useSession();
  const { a: arranque } = useArranque();
  // Lo que ya pide la lista de arranque no se repite en la bandeja.
  const conArranque = seVeArranque(arranque, canOrg);
  const activas = branches.filter((b) => b.isActive);
  const financiero = can('reports:financial:read');
  const atiende = can('members:read');
  const rutas = new Set(menuPara(mirada).map((s) => s.href));
  const [nuevo, setNuevo] = useState<string | null>(null);

  // Las cifras de hoy: sin red ya no es un esqueleto eterno (26-01).
  const cargarHoy = useCallback(() => api<Dashboard>('/dashboard?days=1'), []);
  const hoyCarga = useCarga(financiero ? cargarHoy : null);
  const dash = hoyCarga.datos ?? null;

  // «Hoy te toca»: una llamada; se vuelve a pedir cuando algo se resuelve aquí mismo.
  const bandeja = useBandejaDelInicio();
  const recargarBandeja = bandeja.recargar;
  const algoCambio = useCallback(() => { void recargarBandeja(); }, [recargarBandeja]);
  const verPuerta = can('access:monitor');
  // La puerta tiene su tarjeta; los textos, la lista de arranque.
  const omitir: AsuntoDelInicio[] = [...(verPuerta ? ['door' as const] : []), ...(conArranque ? ['texts' as const] : [])];

  // Sin movimiento todavía, la tabla lleva una fila en ceros por sucursal; con
  // una sola sucursal y nada cobrado no dice nada que las cifras de arriba no digan.
  const sucursales = (() => {
    if (!dash) return [];
    const conDatos = dash.branches.filter((b) => b.branchId !== null);
    const sinMovimiento = BigInt(dash.money.collectedCents) === 0n && BigInt(dash.money.accruedCents) === 0n;
    if (activas.length <= 1 && sinMovimiento) return [];
    return conDatos.length > 0 ? conDatos
      : activas.map((b) => ({ branchId: b.id, activeMembers: 0, accruedCents: '0', outstandingCents: '0' }));
  })();

  const nombre = (me.fullName ?? '').split(' ')[0];
  // La fecha del gimnasio, no la de la computadora.
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: org.timezone });

  return (
    <>
      <PageHeader
        eyebrow={hoy.charAt(0).toUpperCase() + hoy.slice(1)}
        title={`${saludo()}${nombre ? `, ${nombre}` : ''}`}
        // Quien atiende ve SUS sucursales, no "3 sucursales" (UX4-04).
        sub={financiero
          ? `${org.tradeName} · ${branches.length} ${branches.length === 1 ? 'sucursal' : 'sucursales'}`
          : `${org.tradeName} · ${branches.filter((b) => b.isActive && inScope(b.id)).map((b) => b.name).join(', ')}`}
      />

      {/* Lo primero del mostrador es buscar (1-03): aquí mismo, arriba y con el foco para quien atiende todo el día. */}
      {atiende && (
        <div className="mb-24" data-testid="buscar-inicio">
          <Mostrador etiqueta="Buscar socio" autoFoco={!financiero} onCambio={algoCambio}
            onRegistrar={can('members:create') ? (n) => setNuevo(n) : undefined} />
        </div>
      )}

      {/* Los rechazos de hoy sin resolver (5-12): alguien está parado en la entrada. */}
      {verPuerta && atiende && <div className="mb-24"><PorResolverEnLaPuerta onResuelto={algoCambio} /></div>}

      {/* El inicio de quien atiende es su turno (UX5-M-02). */}
      {!financiero && <MiTurno />}

      {/* Solicitudes de privacidad con plazo de ley (21-01): no pinta nada si no hay o si no le toca. */}
      <div className="aviso-inicio"><AvisoSolicitudesArco /></div>

      {financiero && hoyCarga.error && (
        <div className="mb-24"><ErrorCarga titulo="No se pudieron cargar las cifras de hoy" mensaje={hoyCarga.error} onReintentar={() => void hoyCarga.recargar()} /></div>
      )}
      {financiero && !hoyCarga.error && (
        <div className="grid grid-4 mb-24" data-testid="cifras-de-hoy">
          {dash ? (
            <>
              <CifraTocable href="/movimientos" rutas={rutas} etiqueta="Cobrado hoy: ver Movimientos">
                <Stat feature icon={<Wallet />} label="Cobrado hoy" value={pesos(dash.money.collectedCents, { decimals: false })}
                  note={BigInt(dash.money.collectedCents) === 0n && BigInt(dash.money.accruedCents) === 0n
                    ? 'Aún no hay cobros' : `Ganado ${pesos(dash.money.accruedCents, { decimals: false })}`} />
              </CifraTocable>
              <CifraTocable href="/socios" rutas={rutas} etiqueta="Socios activos: ver el padrón">
                <Stat icon={<Users />} label="Socios activos" value={dash.activeMembers.toLocaleString('es-MX')}
                  note={activas.length > 1 ? 'En todas las sucursales' : undefined} />
              </CifraTocable>
              <CifraTocable href="/socios?adeudo=1" rutas={rutas} etiqueta="Vencido: ver quién debe">
                <Stat icon={<TrendingUp />} label="Vencido" value={pesos(dash.portfolio.overdueCents, { decimals: false })}
                  danger={BigInt(dash.portfolio.overdueCents) > 0n}
                  note={BigInt(dash.portfolio.overdueCents) === 0n ? 'Nadie tiene pagos atrasados'
                    : dash.portfolio.delinquencyRate >= 0.995 ? 'Todo lo que se debe ya pasó su fecha'
                      : `${(dash.portfolio.delinquencyRate * 100).toFixed(0)} % de lo que falta por cobrar ya venció`} />
              </CifraTocable>
              {activo('cash') ? (
                <CifraTocable href="/caja" rutas={rutas} etiqueta="Cajas abiertas: ver Caja">
                  <Stat icon={<Wallet />} label="Cajas abiertas" value={dash.openCashSessions.length}
                    note={dash.openCashSessions.length === 0 ? 'Ningún corte pendiente' : 'Corte pendiente al cierre'} />
                </CifraTocable>
              ) : (
                <Stat icon={<Wallet />} label="Caja" value={<span className="stat-value--text">Sin corte</span>} note="Esta sucursal no lleva Caja" />
              )}
            </>
          ) : [0, 1, 2, 3].map((i) => <Skeleton key={i} h={112} r={16} />)}
        </div>
      )}

      {/* El gerente que atiende el mostrador ve su caja (DA-21): solo si tiene un turno propio abierto. */}
      {financiero && <MiTurno solo="caja" />}

      <div className="stack">
        <div className="stack">
          {/* Solo mientras falte algo obligatorio para abrir; después no existe. */}
          <ArranqueCard a={arranque} />
          {financiero
            ? <HoyTeToca carga={bandeja} omitir={omitir} />
            : <HoyTeToca carga={bandeja} omitir={omitir} titulo="Por resolver" sub="Lo que necesita a alguien hoy." />}

          {financiero && dash && sucursales.length > 0 && (
            <Card title="Sucursales" sub="Ordenadas por lo ganado hoy." pad={false}>
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead><tr><th>Sucursal</th><th className="right">Socios activos</th><th className="right">Ganado</th><th className="right">Por cobrar</th></tr></thead>
                  <tbody>
                    {sucursales.map((b) => (
                      <tr key={b.branchId}>
                        <td><span className="row gap-10"><Building2 size={16} className="muted" />{branchName(b.branchId)}</span></td>
                        <td className="right num">{b.activeMembers.toLocaleString('es-MX')}</td>
                        <td className="right num strong">{pesos(b.accruedCents, { decimals: false })}</td>
                        <td className="right num">{BigInt(b.outstandingCents) > 0n
                          ? <Badge tone="warn">{pesos(b.outstandingCents, { decimals: false })}</Badge>
                          : <span className="faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      {nuevo !== null && (
        <NuevoSocioDialog nombreInicial={nuevo} onClose={() => setNuevo(null)} onCreado={(id) => router.push(`/socios/${id}?vender=1`)} />
      )}
    </>
  );
}
