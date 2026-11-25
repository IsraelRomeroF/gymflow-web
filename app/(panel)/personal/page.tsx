'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { UserPlus, KeyRound, ShieldCheck, Users, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { hace } from '@gymflow/ui/format';
import { useSession } from '@/components/session';
import { Avatar, Badge, Button, Callout, Card, Empty, PageHeader, EsqueletoLista } from '@/components/ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';
import { Exportar } from '@/components/exportar';
import { AltaDialog } from './alta-dialog';
import { ClaveDialog, ConfirmarCuenta } from './cuenta-dialogs';
import { PersonaDialog } from './persona-dialog';
import { administra, estadoCuenta, frase, resumenLlave, type Persona, type Rol } from './persona';

/**
 * PERSONAL: quién entra al sistema, con qué puesto y en qué sucursales. El
 * alta entrega una contraseña temporal UNA vez; la persona la cambia al
 * entrar. Nadie asigna un puesto con más permisos de los que tiene.
 */
export default function PersonalPage() {
  const { can, branchName, me } = useSession();
  const [alta, setAlta] = useState(false);
  const [editar, setEditar] = useState<Persona | null>(null);
  const [clave, setClave] = useState<{ nombre: string; email: string; telefono?: string | null; clave: string } | null>(null);
  // La acción al lado de la cuenta en rojo (UX7 Dirección 8): sin abrir otro diálogo para descubrirla.
  const [nuevaClave, setNuevaClave] = useState<Persona | null>(null);
  const gestiona = can('staff:manage');
  // El dueño no administra al personal, pero sí decide qué secciones ve cada quien.
  const libera = can('staff:unlock');
  const abre = (p: Persona) => (gestiona || libera || can('staff:rescue')) && p.id !== me.userId;

  // Con la red caída ya no es «Sin personal» (26-01): se dice y se reintenta.
  const cargar = useCallback(async () => {
    const [u, r] = await Promise.all([api<{ users: Persona[] }>('/users'), api<{ roles: Rol[] }>('/roles')]);
    return { gente: u.users, roles: r.roles };
  }, []);
  const carga = useCarga(cargar);
  const gente = carga.datos?.gente ?? null;
  const roles = carga.datos?.roles ?? [];
  const recargar = () => { void carga.recargar(); };

  const [buscar, setBuscar] = useState('');
  const sinAcentos = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const visibles = (gente ?? []).filter((p) => !buscar.trim() || sinAcentos(`${p.fullName} ${p.email} ${p.role?.name ?? ''}`).includes(sinAcentos(buscar.trim())));
  const pendientes = (gente ?? []).filter((p) => p.isActive && estadoCuenta(p).tone !== 'ok').length;
  const alcance = (p: Persona) => (p.branchIds.length === 0 ? 'Toda la organización' : p.branchIds.map((b) => branchName(b)).join(', '));

  // Para la dueña: gerentes nuevos sin «Qué ve» decidido (17-06) y si alguno administra al personal (17-04).
  const gerentes = (gente ?? []).filter((p) => p.isActive && p.role?.key === 'MANAGER');
  const nuevos = gerentes.filter((p) => p.sectionsReviewPending);
  const nadieAdministra = gerentes.length > 0 && !gerentes.some(administra);

  return (
    <div className="stack gap-20">
      <PageHeader title="Personal" sub="Quién entra al panel, con qué puesto y en qué sucursales."
        actions={<div className="row gap-8">
          <Link className="btn btn-secondary" href="/personal/roles"><ShieldCheck />Puestos</Link>
          {gestiona && <Button icon={<UserPlus />} onClick={() => setAlta(true)}>Dar de alta</Button>}
        </div>} />
      {/* Sin un gerente que administre, la dueña administra al personal (2026-10-09; 17-04, D17-05). */}
      {gestiona && libera && (
        <Callout tone="info" title="Ningún gerente administra al personal">Mientras ningún gerente activo tenga Personal liberado, tú das de alta al personal, cambias su puesto y ajustas qué puede hacer cada persona de recepción y cada coach. Cuando le liberes Personal a un gerente, eso vuelve a ser suyo.</Callout>
      )}
      {/* El gerente nuevo nace sin Dirección (D17-03): la dueña se entera aquí y decide qué ve (17-06). */}
      {libera && nuevos.length > 0 && (
        <Callout tone="warn" title={nuevos.length === 1 ? `Gerente nuevo: ${nuevos[0]!.fullName}` : `Gerentes nuevos: ${frase(nuevos.map((p) => p.fullName))}`}>
          <p>{nuevos.length === 1 ? 'Nació viendo' : 'Nacieron viendo'} solo la operación. Decide qué {nuevos.length === 1 ? 've' : 'ven'} de Dirección y Cumplimiento; si {nuevos.length === 1 ? 'reemplaza' : 'reemplazan'} a otro gerente, copia lo suyo con «Copiar lo de…».</p>
          <div className="row gap-8 flex-wrap callout-accion">
            {nuevos.map((p) => <Button key={p.id} size="sm" variant="secondary" icon={<Lock />} onClick={() => setEditar(p)}>Decidir qué ve {nuevos.length > 1 ? p.fullName : ''}</Button>)}
          </div>
        </Callout>
      )}
      {/* Hay gerente, pero ninguno con Personal: nadie podría contratar ni dar contraseñas (17-04). */}
      {libera && !gestiona && nadieAdministra && nuevos.length === 0 && (
        <Callout tone="warn" title="Ningún gerente puede administrar al personal">
          <p>{frase(gerentes.map((p) => p.fullName))} no {gerentes.length === 1 ? 'tiene' : 'tienen'} Personal liberado: nadie puede dar de alta, cambiar puestos ni dar contraseñas. Libérale Personal a quien lo vaya a llevar.</p>
          <div className="row gap-8 flex-wrap callout-accion">
            {gerentes.map((p) => <Button key={p.id} size="sm" variant="secondary" icon={<Lock />} onClick={() => setEditar(p)}>Qué ve {p.fullName}</Button>)}
          </div>
        </Callout>
      )}
      <Card pad={false} title={gente ? `${gente.filter((p) => p.isActive).length} personas con acceso` : 'Personal'}
        sub={pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'cuenta necesita' : 'cuentas necesitan'} atención: contraseña temporal pendiente o vencida.` : undefined}
        actions={<div className="row gap-8">
          {gente && gente.length > 6 && <input className="input personal-buscar" placeholder="Buscar por nombre o correo" aria-label="Buscar personal" value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
          {/* Para nómina (DP-06): quién es, su puesto, sus sedes y cuándo entró por última vez. */}
          <Exportar nombre="personal" disabled={!gente || gente.length === 0} filas={() => [['Nombre', 'Correo', 'Teléfono', 'Puesto', 'Sucursales', 'Activo', 'Último acceso'],
            ...(gente ?? []).map((p) => [p.fullName, p.email, p.phoneE164 ?? '', p.role?.name ?? '', p.branchIds.length === 0 ? 'Todo el gimnasio' : p.branchIds.map(branchName).join(' / '), p.isActive ? 'Sí' : 'No', p.lastLoginAt ? p.lastLoginAt.slice(0, 10) : ''])]} />
        </div>}>
        <EstadoCarga carga={carga} titulo="No se pudo cargar el personal" relleno esqueleto={<EsqueletoLista filas={5} />}
          esVacio={(d) => d.gente.length === 0} vacio={<Empty icon={<Users />} title="Sin personal" />}>
        {() => visibles.length === 0 ? <Empty icon={<Users />} title="Nadie coincide con la búsqueda" /> : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Persona</th><th>Puesto</th><th>Sucursales</th><th>Ve y hace</th><th>Cuenta</th><th>Último acceso</th><th /></tr></thead>
              <tbody>
                {visibles.map((p) => {
                  const estado = estadoCuenta(p);
                  const nota = p.isActive ? resumenLlave(p) : null;
                  const excepciones = p.isActive ? (p.permissionOverrides?.add.length ?? 0) + (p.permissionOverrides?.remove.length ?? 0) : 0;
                  // La temporal sin usar (o ya vencida) se renueva desde la fila.
                  const renovar = p.isActive && p.mustChangePassword && (!p.lastLoginAt || p.temporaryExpired) && gestiona && p.id !== me.userId && p.role?.key !== 'OWNER';
                  return (
                    // Clicable para quien la puede abrir, también la dueña (17-17).
                    <tr key={p.id} className={[abre(p) ? 'is-link' : '', p.isActive ? '' : 'personal-baja'].filter(Boolean).join(' ') || undefined}
                      onClick={() => { if (abre(p)) setEditar(p); }}>
                      <td>
                        <div className="row gap-10">
                          <Avatar name={p.fullName} size={32} />
                          <div><div className="strong small">{p.fullName}{p.id === me.userId && <span className="muted"> (tú)</span>}</div><div className="tiny muted">{p.email}</div></div>
                        </div>
                      </td>
                      <td data-label="Puesto">{p.role ? <Badge>{p.role.name}</Badge> : <span className="muted">Sin puesto</span>}</td>
                      <td className="small" data-label="Sucursales">{alcance(p)}</td>
                      {/* Qué ve y qué excepciones tiene, en su columna (17-11): antes era una nota gris bajo la cuenta. */}
                      <td data-label="Ve y hace">
                        <span className="personal-ve">
                          {p.isActive && p.sectionsReviewPending && <span className="personal-chip text-warn" data-testid="por-decidir">La dueña aún no decide qué ve</span>}
                          {nota && !p.sectionsReviewPending && <span className="personal-chip" data-testid="llave">{nota}</span>}
                          {excepciones > 0 && <span className="personal-chip" data-testid="excepciones">{excepciones} {excepciones === 1 ? 'excepción' : 'excepciones'}</span>}
                          {!nota && !p.sectionsReviewPending && excepciones === 0 && <span className="tiny muted">{!p.isActive ? '—' : p.role?.key === 'OWNER' ? 'Todo, en consulta' : 'Lo de su puesto'}</span>}
                        </span>
                      </td>
                      <td data-label="Cuenta">
                        {/* En columna: en el teléfono la celda es inline-flex y dos hijos en fila la desbordaban. */}
                        <span className="personal-cuenta">
                          <Badge tone={estado.tone === 'neutral' ? undefined : estado.tone} dot>{estado.label}</Badge>
                          {renovar && (
                            <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={(e) => { e.stopPropagation(); setNuevaClave(p); }}>Nueva contraseña</Button>
                          )}
                        </span>
                      </td>
                      <td className="small muted stack-hide">{!p.isActive ? '—' : p.lastLoginAt ? hace(p.lastLoginAt) : 'Nunca ha entrado'}</td>
                      <td className="right text-right">{abre(p) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditar(p); }}>{gestiona ? 'Editar' : 'Qué ve'}</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </EstadoCarga>
      </Card>

      {alta && <AltaDialog roles={roles} onClose={() => setAlta(false)} onCreado={(r) => { setAlta(false); setClave(r); recargar(); }} />}
      {editar && (
        <PersonaDialog persona={editar} roles={roles} gente={gente ?? []} onClose={() => setEditar(null)}
          onListo={() => { setEditar(null); recargar(); }} onCambio={recargar}
          onClave={(c) => setClave({ nombre: editar.fullName, email: editar.email, telefono: editar.phoneE164, clave: c })} />
      )}
      {clave && <ClaveDialog {...clave} onClose={() => setClave(null)} />}
      {nuevaClave && (
        <ConfirmarCuenta persona={nuevaClave} accion="clave" rescate={false} onClose={() => setNuevaClave(null)}
          onHecho={(c) => { const x = nuevaClave; setNuevaClave(null); recargar(); if (c) setClave({ nombre: x.fullName, email: x.email, telefono: x.phoneE164, clave: c }); }} />
      )}
    </div>
  );
}
