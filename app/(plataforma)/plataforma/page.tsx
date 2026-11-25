'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, ArrowRight, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, hace, pesos } from '@gymflow/ui/format';
import { Badge, Button, Card, ErrorCarga, PageHeader, Stat, EsqueletoTabla, Segmented } from '@/components/ui';
import { ESTADO_COBRO, dias } from './cobro';
import { Bandeja, PrimerosPasos, requiereAtencion } from './_componentes/bandeja';
import { SolicitudesPendientes } from './_componentes/ficha-de-marca';
import { Credenciales } from './_componentes/credenciales';
import { NuevaMarca, type AltaHecha } from './_componentes/nueva-marca';
import { SERVICIO, type ListaDeMarcas, type Marca } from './_componentes/tipos';

/**
 * MARCAS: los gimnasios que viven en la plataforma. Dar de alta uno nuevo
 * (tres pasos) deja listo lo mínimo para operar mañana: su primera sucursal,
 * lo que contrató y las cuentas del arranque. Al terminar se entregan los
 * accesos y se va a su ficha.
 */
export default function MarcasPage() {
  const router = useRouter();
  const [buscar, setBuscar] = useState('');
  const [vista, setVista] = useState<'todas' | 'atender'>('todas');
  const [lista, setLista] = useState<ListaDeMarcas | null>(null);
  const [fallo, setFallo] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [creada, setCreada] = useState<AltaHecha | null>(null);

  const cargar = useCallback(() => {
    setFallo(false);
    api<ListaDeMarcas>('/platform/organizations').then(setLista).catch(() => setFallo(true));
  }, []);
  useEffect(cargar, [cargar]);
  const marcas: Marca[] | null = lista?.organizations ?? null;

  return (
    <>
      <PageHeader title="Marcas" sub="Los gimnasios que operan con GymFlow. Cada uno es un mundo aparte: su personal, sus socios y su dinero no se cruzan. Desde aquí se libera el software, se contratan módulos y se dan las cuentas."
        actions={<><Button icon={<Plus />} onClick={() => setNueva(true)}>Nueva marca</Button></>} />
      {lista && marcas && marcas.length > 0 && (
        <div className="grid grid-4 mb-20">
          {/* Cuánto factura GymFlow al mes si todas las marcas en uso pagan (DP-03). */}
          <Stat label="Ingreso mensual" value={pesos(lista.monthlyIncomeCents, { decimals: false })} note={<Link href="/plataforma/cobranza" className="row-link">Ver cobranza</Link>} />
          <Stat label="Marcas en uso" value={marcas.filter((m) => m.serviceStatus === 'ACTIVE').length}
            note={`${marcas.length} en total${marcas.some((m) => m.serviceStatus === 'PENDING') ? ` · ${marcas.filter((m) => m.serviceStatus === 'PENDING').length} sin liberar` : ''}`} />
          <Stat label="Socios activos" value={marcas.reduce((a, m) => a + m.activeMembers, 0).toLocaleString('es-MX')} note="En todas las marcas" />
          <Stat label="Por cobrar" value={pesos(marcas.reduce((a, m) => a + BigInt(m.billing.pendingCents), 0n), { decimals: false })} danger={marcas.some((m) => m.billing.status === 'VENCIDA')}
            note={marcas.some((m) => m.billing.status === 'VENCIDA') ? `${marcas.filter((m) => m.billing.status === 'VENCIDA').length} con factura vencida` : 'Facturas pendientes de pago'} />
        </div>
      )}
      {lista && marcas && marcas.length > 0 && <Bandeja marcas={marcas} sinPrecio={lista.pricesMissing} />}
      {/* Lo que los gimnasios pidieron cambiar de sus datos o su marca (D-27, bloque 4.6). */}
      {lista && marcas && marcas.length > 0 && <SolicitudesPendientes />}
      {fallo && <ErrorCarga mensaje="No se pudieron cargar las marcas." onReintentar={cargar} />}
      {!marcas && !fallo && <div className="card"><EsqueletoTabla columnas={6} /></div>}
      {lista && marcas && marcas.length === 0 && <PrimerosPasos sinPrecio={lista.pricesMissing} onNueva={() => setNueva(true)} />}
      {marcas && marcas.length > 0 && (
        <Card pad={false}>
          {/* Para operar diez gimnasios (UX 2026-10-08): buscar y ver primero lo que hay que atender. */}
          <div className="card-head wrap">
            <Segmented value={vista} onChange={setVista} options={[
              { value: 'todas', label: `Todas (${marcas.length})` },
              { value: 'atender', label: `Requieren atención (${marcas.filter(requiereAtencion).length})` },
            ]} />
            <div className="input-icon buscar-marca"><Search /><input className="input" placeholder="Buscar marca" aria-label="Buscar marca" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></div>
          </div>
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Marca</th><th>Servicio</th><th>Plan</th><th>Cobro</th><th>Uso</th><th>Última actividad</th><th /></tr></thead>
              <tbody>
                {marcas.filter((m) => (vista === 'todas' || requiereAtencion(m)) && (!buscar.trim() || `${m.tradeName} ${m.legalName}`.toLowerCase().includes(buscar.trim().toLowerCase())))
                  .sort((a, b) => Number(requiereAtencion(b)) - Number(requiereAtencion(a)) || a.tradeName.localeCompare(b.tradeName)).map((m) => (
                  <tr key={m.id} className="is-link" data-marca={m.tradeName}>
                    <td><Link href={`/plataforma/${m.id}`} className="strong no-underline">{m.tradeName}</Link><div className="tiny muted">{m.legalName} · desde {fecha(m.createdAt)}</div></td>
                    <td data-label="Servicio"><Badge tone={SERVICIO[m.serviceStatus].tone} dot>{SERVICIO[m.serviceStatus].label}</Badge>{m.notContracted > 0 && <div className="tiny muted">{m.notContracted} módulos sin contratar</div>}</td>
                    {/* En el teléfono cada marca medía más de 400 px: Plan y Última actividad se leen en su ficha (22 §4). */}
                    <td data-label="Plan" className="small nowrap stack-hide">{m.plan ? m.plan.name : <span className="muted">A la medida</span>}</td>
                    <td data-label="Cobro">
                      {/* La misma insignia que la ficha: el estado lo calcula el servidor (23-02). */}
                      <Badge tone={ESTADO_COBRO[m.billing.status].tone} dot={m.billing.status !== 'SIN_COBRO'}>{ESTADO_COBRO[m.billing.status].label}{m.billing.status === 'VENCIDA' ? ` · ${dias(m.billing.overdueDays)}` : ''}</Badge>
                      {m.billing.pendingCents !== '0' && <div className="tiny muted num">{pesos(m.billing.pendingCents)}</div>}
                    </td>
                    {/* Una columna "Uso" en vez de cuatro (UX7 Plataforma 9): la tabla cabe a 1024 px. */}
                    <td data-label="Uso" className="small stack-full">
                      <div>{m.activeMembers.toLocaleString('es-MX')} socios · {m.entriesLast24h.toLocaleString('es-MX')} entradas hoy</div>
                      <div className="tiny muted">{m.branches} {m.branches === 1 ? 'sucursal' : 'sucursales'} · {m.staff} de personal</div>
                    </td>
                    {/* Lo último que hizo SU gente (22-06): los actos de la plataforma ya no cuentan. */}
                    <td data-label="Última actividad" className="stack-hide">
                      {m.lastActivityAt ? <span className="small">{hace(m.lastActivityAt)}</span>
                        : <span className="muted small">{m.lastStaffLoginAt ? 'Sin registros todavía' : 'Nadie ha entrado'}</span>}
                    </td>
                    <td className="right"><Link href={`/plataforma/${m.id}`} className="btn btn-ghost btn-sm">Ver <ArrowRight size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {nueva && <NuevaMarca onClose={() => setNueva(false)} onCreada={(r) => { setNueva(false); setCreada(r); cargar(); }} />}
      {creada && (
        <Credenciales marca={creada.tradeName} credenciales={creada.credentials}
          recien={{ organizationId: creada.organizationId, serviceStatus: creada.serviceStatus }}
          onLiberada={cargar}
          onClose={() => setCreada(null)}
          onIrALaMarca={() => { const id = creada.organizationId; setCreada(null); router.push(`/plataforma/${id}`); }} />
      )}
    </>
  );
}
