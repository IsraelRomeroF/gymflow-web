'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Package, Pencil, Play, Power, PowerOff } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { useToast, errorText } from '@/components/session';
import { Badge, Breadcrumb, Button, Card, ErrorCarga, PageHeader, Stat, NoExiste, esNoExiste, EsqueletoPagina } from '@/components/ui';
import { rolDe } from '@/lib/labels';
import { ZONAS } from '@/lib/zonas';
import { Cobro } from '../cobro';
import { QueVeDueno } from './que-ve-dueno';
import { AsignarPlan } from '../_componentes/asignar-plan';
import { ConMotivo } from '../_componentes/con-motivo';
import { Credenciales } from '../_componentes/credenciales';
import { EditarMarca } from '../_componentes/editar-marca';
import { FichaDeMarca } from '../_componentes/ficha-de-marca';
import { NuevaCuenta } from '../_componentes/nueva-cuenta';
import { PersonalMarca } from '../_componentes/personal-marca';
import { Soporte } from '../_componentes/soporte';
import { CAMBIO_DE_SERVICIO, SERVICIO, cambioPara, type CambioDeServicio, type Credencial, type Detalle, type Usuario } from '../_componentes/tipos';

/**
 * UNA MARCA POR DENTRO (ADR-037). La plataforma libera, reanuda o suspende el
 * software, decide qué módulos contrató el dueño, da las cuentas de su
 * personal y ve cómo va. No toca su operación: eso es de su gente.
 *
 * El orden es el de una llamada de soporte (22-04): servicio y plan, después
 * el PERSONAL (la contraseña olvidada, la cuenta que hay que suspender) y
 * luego cobro, módulos, soporte y lo que GymFlow hizo aquí.
 */
export default function MarcaPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detalle | null>(null);
  const [fallo, setFallo] = useState(false);
  const [noExiste, setNoExiste] = useState(false);
  const [servicio, setServicio] = useState<CambioDeServicio | null>(null);
  const [contrato, setContrato] = useState<Detalle['modules'][number] | null>(null);
  const [reset, setReset] = useState<Usuario | null>(null);
  const [queVe, setQueVe] = useState<Usuario | null>(null);
  const [activar, setActivar] = useState<Usuario | null>(null);
  const [nuevaCuenta, setNuevaCuenta] = useState(false);
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const [editar, setEditar] = useState(false);
  const [plan, setPlan] = useState(false);

  const cargar = useCallback(() => {
    setFallo(false);
    api<Detalle>(`/platform/organizations/${id}`).then(setD).catch((e) => (esNoExiste(e) ? setNoExiste(true) : setFallo(true)));
  }, [id]);
  useEffect(cargar, [cargar]);

  async function conMotivo(fn: () => Promise<unknown>, mensaje: string) {
    try { await fn(); toast('ok', mensaje); cargar(); return true; } catch (e) { toast('error', errorText(e, 'No se pudo')); return false; }
  }

  if (noExiste) return <NoExiste titulo="Esta marca no existe" texto="No está entre los gimnasios de la plataforma." volverA="/plataforma" volverTexto="Ir a Marcas" />;
  if (fallo) return <ErrorCarga mensaje="No se pudo cargar la marca." onReintentar={cargar} />;
  if (!d) return <EsqueletoPagina />;
  const contratados = d.modules.filter((m) => m.contracted);
  const est = SERVICIO[d.serviceStatus];
  // Qué se le ofrece según su estado (22-07): suspender, REANUDAR (si está suspendida) o liberar (si nunca se liberó).
  const ofrecido = cambioPara(d.serviceStatus);
  const cambio = servicio ? CAMBIO_DE_SERVICIO[servicio] : null;

  return (
    <>
      <Breadcrumb items={[{ label: 'Marcas', href: '/plataforma' }, { label: d.tradeName }]} />
      <PageHeader title={d.tradeName} sub={`${d.legalName} · desde ${fecha(d.createdAt)} · ${ZONAS.find(([z]) => z === d.timezone)?.[1] ?? d.timezone}${d.billingEmail ? ` · cobros a ${d.billingEmail}` : ''}`}
        actions={<><Badge tone={est.tone} dot>{est.label}</Badge><Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditar(true)}>Editar marca</Button></>} />

      <div className="grid grid-4 mb-20">
        <Stat label="Sucursales" value={d.branches.filter((b) => b.isActive).length} note={d.branches.map((b) => b.code).join(', ')} />
        <Stat label="Socios activos" value={d.activeMembers.toLocaleString('es-MX')} />
        <Stat label="Entradas (24 h)" value={d.entriesLast24h.toLocaleString('es-MX')} note="En todas sus sedes" />
        <Stat label="Plan" value={<span className="stat-value--text">{d.plan?.name ?? 'A la medida'}</span>} note={d.plan ? `${contratados.length} módulos contratados · ${contratados.filter((m) => !m.inPlan).length} agregados` : `${contratados.length} de ${d.modules.length} módulos, uno por uno`} />
      </div>

      <div className="stack">
        {/* Servicio y plan, lado a lado: lo primero que se revisa de una marca (UX5-PL-09). */}
        <div className="grid grid-2 plat-arriba">
        <Card title="Servicio" sub="Fuera de «En uso» nadie de la marca entra: ni su personal ni sus socios." data-testid="servicio">
          <div className="row-between flex-wrap gap-12">
            <div>
              <p className="row gap-8 flex-wrap"><Badge tone={est.tone} dot>{est.label}</Badge>
                <span className="small muted">
                  {d.serviceStatus === 'ACTIVE' && d.activatedAt && `Liberado el ${fecha(d.activatedAt)}`}
                  {d.serviceStatus === 'SUSPENDED' && d.suspendedAt && `Suspendido el ${fecha(d.suspendedAt)}${d.suspendedReason ? ` · «${d.suspendedReason}»` : ''}`}
                  {d.serviceStatus === 'PENDING' && 'Dada de alta; el dueño todavía no puede entrar.'}
                </span>
              </p>
            </div>
            <Button variant={ofrecido === 'suspender' ? 'danger-ghost' : 'primary'} icon={ofrecido === 'suspender' ? <PowerOff /> : ofrecido === 'reanudar' ? <Play /> : <Power />}
              data-accion-servicio={ofrecido} onClick={() => setServicio(ofrecido)}>{CAMBIO_DE_SERVICIO[ofrecido].boton}</Button>
          </div>
        </Card>

        <Card title="Plan contratado" data-testid="plan"
          sub="Libera los módulos que incluye; los agregados se contratan abajo."
          actions={<Button size="sm" variant="secondary" icon={<Package />} onClick={() => setPlan(true)}>{d.plan ? 'Cambiar plan' : 'Asignar plan'}</Button>}>
          {d.plan
            ? <p className="row gap-8 flex-wrap"><span className="strong">{d.plan.name}</span><Badge tone="ok" dot>{d.plan.monthlyCents === null ? 'Sin precio: se cobra módulo por módulo' : `${pesos(d.plan.monthlyCents)} al mes`}</Badge><span className="small muted">Incluye lo básico{d.plan.modules.length ? ` + ${d.plan.modules.map((k) => d.modules.find((m) => m.key === k)?.name ?? k).join(', ')}` : ''}</span></p>
            : <p className="small muted"><span className="strong">A la medida.</span> La marca contrata módulo por módulo y se le cobra lo básico más cada módulo a su precio.</p>}
        </Card>
        </div>

        {/* Datos y marca que el gimnasio no cambia desde su panel, y lo que pidió cambiar (D-27, bloque 4.6). */}
        <FichaDeMarca organizationId={d.id} version={`${d.tradeName}|${d.legalName}`} onCambio={cargar} />

        <PersonalMarca marca={d} onAgregar={() => setNuevaCuenta(true)} onNuevaContrasena={setReset} onQueVe={setQueVe} onActivar={setActivar} />

        <Cobro organizationId={d.id} tradeName={d.tradeName} onServicio={cargar} />

        <Card title="Módulos contratados" sub="Con su plan o como agregado. La gerencia enciende y apaga dentro de esto." pad={false}>
          {/* Cuadrícula compacta: nombre, descripción corta, estado y el interruptor (UX5-PL-09). */}
          <ul className="mod-compacto">
            {d.modules.map((m) => (
              <li key={m.key} data-contrato={m.key}>
                <div className="flex-1 min-w-0">
                  <p className="strong small">{m.name}</p>
                  {/* Visible, no solo en `title` (no se ve en táctil ni lo lee un lector de pantalla). */}
                  <p className="tiny muted">{m.description}</p>
                  <p className="row gap-6 flex-wrap mt-4">
                    {/* El interruptor es lo CONTRATADO; si la gerencia lo apagó, se dice aparte. */}
                    {!m.contracted && <Badge tone="warn">No contratado</Badge>}
                    {m.contracted && !m.enabled && <span className="tiny muted">La gerencia lo tiene apagado</span>}
                    {m.contracted && d.plan && <Badge>{m.inPlan ? 'Incluido en el plan' : 'Agregado'}</Badge>}
                  </p>
                </div>
                <span className="row gap-8 items-center">
                  <span className="tiny muted">{m.contracted ? 'Contratado' : 'Sin contratar'}</span>
                  <button type="button" role="switch" className="switch" aria-checked={m.contracted} aria-label={m.contracted ? `Retirar ${m.name}` : `Contratar ${m.name}`} onClick={() => setContrato(m)}><span /></button>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Soporte id={d.id} version={`${d.serviceStatus}-${d.plan?.id ?? ''}-${d.modules.filter((m) => m.contracted).length}-${d.users.length}`} />
      </div>

      {servicio && cambio && (
        <ConMotivo titulo={cambio.titulo(d.tradeName)} texto={cambio.texto} boton={cambio.confirmar} peligro={servicio === 'suspender'} sugerencias={cambio.motivos}
          onClose={() => setServicio(null)}
          onConfirmar={async (reason) => { if (await conMotivo(() => api(`/platform/organizations/${id}/service`, { method: 'POST', body: JSON.stringify({ status: cambio.status, reason }) }), cambio.hecho)) setServicio(null); }}
        />
      )}
      {contrato && (
        <ConMotivo
          titulo={contrato.contracted ? `Retirar ${contrato.name}` : `Contratar ${contrato.name}`}
          texto={contrato.contracted
            ? `${contrato.name} desaparece para todo el personal de la marca aunque la gerencia lo tuviera encendido. No se borra nada: si lo vuelven a contratar, regresa como estaba.`
            : `${contrato.name} queda disponible para la marca: aparece encendido, salvo que la gerencia lo tenga apagado en Dirección → Módulos.`}
          boton={contrato.contracted ? 'Retirar' : 'Contratar'} peligro={contrato.contracted} sugerencias={contrato.contracted ? ['Dejó de pagarlo', 'Lo canceló el dueño'] : ['Lo contrató', 'Incluido en su plan']}
          onClose={() => setContrato(null)}
          onConfirmar={async (reason) => { if (await conMotivo(() => api(`/platform/organizations/${id}/entitlements/${contrato.key}`, { method: 'PUT', body: JSON.stringify({ granted: !contrato.contracted, reason }) }), contrato.contracted ? `${contrato.name} retirado.` : `${contrato.name} contratado.`)) setContrato(null); }}
        />
      )}
      {activar && (
        <ConMotivo
          titulo={activar.isActive ? `Suspender la cuenta de ${activar.fullName}` : `Reactivar la cuenta de ${activar.fullName}`}
          texto={activar.isActive ? 'No podrá entrar y sus sesiones abiertas se cierran. Lo que hizo queda en la bitácora.' : 'Vuelve a poder entrar con su contraseña de siempre.'}
          boton={activar.isActive ? 'Suspender' : 'Reactivar'} peligro={activar.isActive} sugerencias={activar.isActive ? ['Dejó de trabajar ahí', 'A petición del dueño'] : ['Regresó al gimnasio']}
          onClose={() => setActivar(null)}
          onConfirmar={async (reason) => { if (await conMotivo(() => api(`/platform/organizations/${id}/users/${activar.id}/active`, { method: 'POST', body: JSON.stringify({ isActive: !activar.isActive, reason }) }), activar.isActive ? 'Cuenta suspendida.' : 'Cuenta reactivada.')) setActivar(null); }}
        />
      )}
      {queVe && <QueVeDueno marcaId={d.id} persona={queVe} onClose={() => setQueVe(null)} onListo={() => { setQueVe(null); cargar(); }} />}
      {reset && (
        <ConMotivo
          titulo={`Contraseña temporal para ${reset.fullName}`} texto="Se muestra una sola vez y vence en 7 días: solo le sirve para elegir la suya al entrar. Desbloquea la cuenta y cierra sus sesiones abiertas." boton="Generar" sugerencias={['La olvidó y nos la pidió', 'Primer acceso']}
          onClose={() => setReset(null)}
          onConfirmar={async (reason) => {
            try {
              const r = await api<{ password: string }>(`/platform/organizations/${id}/users/${reset.id}/password-reset`, { method: 'POST', body: JSON.stringify({ reason }) });
              setCredencial({ roleKey: reset.roleKeys[0] ?? '', roleName: rolDe(reset.roleKeys), fullName: reset.fullName, email: reset.email, phoneE164: reset.phoneE164 ?? null, password: r.password });
              setReset(null); cargar();
            } catch (e) { toast('error', errorText(e, 'No se pudo restablecer')); }
          }}
        />
      )}
      {editar && <EditarMarca marca={d} onClose={() => setEditar(false)} onHecho={() => { setEditar(false); cargar(); }} />}
      {plan && <AsignarPlan marca={d} onClose={() => setPlan(false)} onHecho={() => { setPlan(false); cargar(); }} />}
      {nuevaCuenta && (
        <NuevaCuenta marca={d} onClose={() => setNuevaCuenta(false)}
          onCreada={(c) => {
            setNuevaCuenta(false); setCredencial(c); cargar();
            if (c.sectionsUnlocked) toast('ok', `${c.fullName} nace con Dirección y Cumplimiento liberados: la marca no tenía otro gerente activo.`);
          }} />
      )}
      {credencial && <Credenciales marca={d.tradeName} credenciales={[credencial]} onClose={() => setCredencial(null)} />}
    </>
  );
}
