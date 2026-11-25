'use client';

import { useCallback, useState } from 'react';
import { Building2, Plus, Pencil, Wallet, DoorClosed, DoorOpen } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useSession, useToast, errorText, erroresPorCampo } from '@/components/session';
import { Badge, Button, ButtonLink, CampoMotivo, Card, Dialog, Empty, ErrorCarga, Field, PageHeader, EsqueletoLista, Callout } from '@/components/ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';
import { usePortalUrl } from '@/lib/portal';
import { ZONAS } from '@/lib/zonas';
import Link from 'next/link';
import { telefono } from '@gymflow/ui/format';
import { PestanasGimnasio, useEntraA } from '../gimnasio/pestanas';

type Sede = {
  id: string; code: string; name: string; addressLine: string | null; publicSlug?: string | null; timezone: string | null; isActive: boolean;
  /** Teléfono y horario: los administra GymFlow (D-27, bloque 4.6); aquí solo se ven. */
  phone?: string | null; openingHours?: string | null;
};
type Caja = { id: string; branchId: string; code: string; name: string; isActive: boolean };
type Cierre = {
  homeMembers: number; liveMemberships: number; openCashSessions: number; classTemplates: number;
  staff?: Array<{ id: string; fullName: string; roleName: string }>;
  /** Lo vivo de Clases en la sede que impide cerrarla: «3 lugares reservados en clases próximas». */
  classBlockers?: string[];
};

/** La zona en palabras. */
const nombreZona = (tz: string) => ZONAS.find(([z]) => z === tz)?.[1] ?? tz;
const frase = (xs: readonly string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs);

/**
 * SUCURSALES. Abrir una sede le crea su primera caja —sin caja no se puede
 * cobrar— y su código define el prefijo de sus socios (CEN-00042). La dueña
 * las consulta sin cambiarlas (19-03, D19-02): sedes, cajas, enlace y zona.
 */
export default function SucursalesPage() {
  const portal = usePortalUrl();
  const { can, org, inScope, activo, activoEn } = useSession();
  const [editar, setEditar] = useState<Sede | 'nueva' | null>(null);
  const [cerrar, setCerrar] = useState<Sede | null>(null);
  const [reabrir, setReabrir] = useState<Sede | null>(null);
  const [caja, setCaja] = useState<{ sede: Sede; caja: Caja | null } | null>(null);
  const opera = can('settings:branch');
  // «Datos» va con la misma llave que esta pantalla: quien está aquí casi siempre la ve.
  const verDatos = useEntraA('/sucursales');
  // Las cajas las ve quien ve cortes (la gerencia y la dueña); sin ese permiso no se piden.
  const veCajas = can('cash:session:read');

  const cargar = useCallback(async () => {
    const sedes = await api<Sede[]>('/branches');
    if (!veCajas) return { sedes, cajas: [] as Caja[] };
    // Quien ve toda la organización trae las cajas en una sola petición; quien
    // opera varias sedes (pero no todas) las pide por sede: la API lo dice con
    // un 422. Cualquier otro error es eso, un error: nunca «Sin caja» (19-13).
    let cajas: Caja[] | null;
    try {
      cajas = (await api<{ registers: Caja[] }>('/cash-registers')).registers;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 422)) return { sedes, cajas: null };
      const porSede = await Promise.all(sedes.filter((x) => inScope(x.id)).map((x) =>
        api<{ registers: Caja[] }>(`/cash-registers?branchId=${x.id}`).then((r) => r.registers, () => null)));
      cajas = porSede.some((x) => x === null) ? null : porSede.flat() as Caja[];
    }
    return { sedes, cajas };
  }, [inScope, veCajas]);
  // Con la API caída no es «Sin sucursales»: se dice y se reintenta (19-13).
  const carga = useCarga(cargar);
  const cajas = carga.datos?.cajas ?? null;
  const listo = () => { setEditar(null); setCerrar(null); setReabrir(null); setCaja(null); void carga.recargar(); };

  return (
    <div className="stack gap-20">
      <PestanasGimnasio actual="sucursales" />
      <PageHeader title="Sucursales" sub={`Las sedes de ${org.tradeName}, sus cajas y su zona horaria.`}
        actions={can('settings:org') ? <Button icon={<Plus />} onClick={() => setEditar('nueva')}>Abrir sucursal</Button> : undefined} />
      {!opera && <Callout tone="info">Aquí consultas tus sucursales, sus cajas y su enlace del alta. Las abre, las cambia y las cierra la gerencia.</Callout>}
      {carga.datos && cajas === null && (
        <ErrorCarga titulo="No se pudieron cargar las cajas" mensaje="Las sucursales sí cargaron; sus cajas no respondieron. Revisa tu conexión y vuelve a intentar." onReintentar={() => void carga.recargar()} />
      )}
      <EstadoCarga carga={carga} titulo="No se pudieron cargar las sucursales" esqueleto={<div className="card"><EsqueletoLista filas={3} /></div>}
        esVacio={(d) => d.sedes.length === 0}
        vacio={<Card><Empty icon={<Building2 />} title="Sin sucursales" text="Abre la primera para empezar a cobrar."
          action={can('settings:org') ? <Button icon={<Plus />} onClick={() => setEditar('nueva')}>Abrir sucursal</Button> : undefined} /></Card>}>
        {({ sedes }) => (
        <div className="grid grid-3">
          {/* Las cerradas al final: ya no venden ni cobran. */}
          {[...sedes].sort((a, b) => Number(b.isActive) - Number(a.isActive)).map((s) => {
            const suyas = (cajas ?? []).filter((c) => c.branchId === s.id);
            const cambia = opera && inScope(s.id);
            return (
              <Card key={s.id} title={s.name} sub={<>Clave <code>{s.code}</code> · los socios se numeran {s.code.slice(0, 3)}-00001</>}
                actions={s.isActive ? <Badge tone="ok" dot>Abierta</Badge> : <Badge>Cerrada</Badge>}
                footer={cambia ? <div className="row gap-8 flex-wrap">
                  {s.isActive ? <>
                    <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditar(s)}>Editar</Button>
                    {activoEn('cash', s.id) && cajas !== null && <Button size="sm" variant="ghost" icon={<Wallet />} onClick={() => setCaja({ sede: s, caja: null })}>Agregar caja</Button>}
                  </> : can('settings:org') && <Button size="sm" variant="secondary" icon={<DoorOpen />} onClick={() => setReabrir(s)}>Reabrir sucursal</Button>}
                </div> : undefined}>
                <dl className="kv">
                  <dt>Dirección</dt><dd>{s.addressLine ?? (cambia && s.isActive
                    ? <button type="button" className="row-link muted" onClick={() => setEditar(s)}>Sin dirección registrada</button>
                    : <span className="muted">Sin dirección registrada</span>)}</dd>
                  {activo('intake') && <><dt>Enlace del alta</dt><dd>{s.publicSlug ? <code>{`${portal.replace(/^https?:\/\//, '')}/alta/${s.publicSlug}`}</code> : <span className="muted">Enlace corto: aún no se crea</span>}</dd></>}
                  {/* Sin zona propia sigue la del gimnasio (19-10). */}
                  <dt>Zona</dt><dd>{nombreZona(s.timezone ?? org.timezone)}{s.timezone ? '' : <span className="muted"> · la del gimnasio</span>}</dd>
                  {/* Teléfono y horario no se editan aquí (D-27): los lleva GymFlow y se piden en Datos. */}
                  <dt>Teléfono</dt><dd data-testid="sede-telefono">{s.phone ? telefono(s.phone) : <span className="muted">Sin registrar</span>}</dd>
                  <dt>Horario</dt><dd data-testid="sede-horario">{s.openingHours ?? <span className="muted">Sin registrar</span>}
                    <div className="tiny muted">El teléfono y el horario los lleva GymFlow{verDatos ? <>: <Link href="/gimnasio">pide el cambio en Datos</Link></> : ''}.</div></dd>
                  {inScope(s.id) && veCajas && <><dt>Cajas</dt><dd>{!activoEn('cash', s.id) ? <span className="muted">No lleva Caja: cobra sin corte</span> : cajas === null ? <span className="muted">No se pudieron consultar</span> : suyas.length === 0 ? <span className="danger">Sin caja: no se puede cobrar</span> : (
                    <span className="row gap-6 flex-wrap">
                      {suyas.map((c) => cambia && s.isActive
                        ? (
                          <button key={c.id} type="button" className="chip" title={c.isActive ? 'Renombrar o retirar' : 'Retirada'} style={c.isActive ? undefined : { opacity: .55, textDecoration: 'line-through' }}
                            onClick={() => setCaja({ sede: s, caja: c })}><Pencil size={12} aria-hidden />{c.name}</button>
                        )
                        // Quien solo consulta ve las cajas, no botones que no hacen nada.
                        : <Badge key={c.id} tone={c.isActive ? 'neutral' : undefined}>{c.name}{c.isActive ? '' : ' (retirada)'}</Badge>)}
                    </span>
                  )}</dd></>}
                </dl>
              </Card>
            );
          })}
        </div>
        )}
      </EstadoCarga>
      {editar && <SedeDialog sede={editar === 'nueva' ? null : editar} onClose={() => setEditar(null)} onListo={listo}
        onCerrar={editar !== 'nueva' && editar.isActive && can('settings:org') ? () => { const s = editar; setEditar(null); setCerrar(s); } : undefined} />}
      {cerrar && <CerrarSede sede={cerrar} onClose={() => setCerrar(null)} onListo={listo} />}
      {reabrir && <ReabrirSede sede={reabrir} onClose={() => setReabrir(null)} onListo={listo} />}
      {caja && <CajaDialog sede={caja.sede} caja={caja.caja} cajas={(cajas ?? []).filter((c) => c.branchId === caja.sede.id)} onClose={() => setCaja(null)} onListo={listo} />}
    </div>
  );
}

function SedeDialog({ sede, onClose, onListo, onCerrar }: { sede: Sede | null; onClose: () => void; onListo: () => void; onCerrar?: () => void }) {
  const portal = usePortalUrl();
  const toast = useToast();
  const { activo, org } = useSession();
  const [codigo, setCodigo] = useState(sede?.code ?? '');
  const [nombre, setNombre] = useState(sede?.name ?? '');
  const [direccion, setDireccion] = useState(sede?.addressLine ?? '');
  const [enlace, setEnlace] = useState(sede?.publicSlug ?? '');
  // Vacío = la del gimnasio (19-10): editar la dirección ya no convierte la herencia en una zona fija.
  const [zona, setZona] = useState(sede?.timezone ?? '');
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});

  async function guardar() {
    setEnviando(true);
    setErrores({});
    try {
      if (sede) {
        await api(`/branches/${sede.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: nombre.trim(), addressLine: direccion.trim() || null, publicSlug: enlace.trim() || null, timezone: zona || null }),
        });
        toast('ok', 'Sucursal actualizada');
      } else {
        const b = await api<Sede>('/branches', { method: 'POST', body: JSON.stringify({ code: codigo.trim(), name: nombre.trim(), addressLine: direccion.trim() || null, timezone: zona || null }) });
        // Sin caja no se cobra: la primera se crea con la sucursal.
        await api('/cash-registers', { method: 'POST', body: JSON.stringify({ branchId: b.id, code: 'C1', name: `Caja 1 ${b.code}` }) });
        toast('ok', `Sucursal ${b.name} abierta con su primera caja`);
      }
      onListo();
    } catch (e) {
      const porCampo = erroresPorCampo(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) toast('error', errorText(e, 'No se pudo guardar'));
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={sede ? `Editar ${sede.name}` : 'Abrir sucursal'}
      sub={sede ? undefined : 'Se crea con su primera caja («Caja 1»); la puedes renombrar después.'}
      footer={<>
        {/* Cerrar es lo más grave de la pantalla: tiene su propio diálogo con motivo (19-06). */}
        {onCerrar && <Button variant="danger-ghost" icon={<DoorClosed />} onClick={onCerrar} disabled={enviando}>Cerrar sucursal…</Button>}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={enviando} disabled={nombre.trim().length < 2 || (!sede && !/^[A-Za-z]{3}[A-Za-z0-9]{0,5}$/.test(codigo.trim()))} onClick={() => void guardar()}>{sede ? 'Guardar' : 'Abrir sucursal'}</Button>
      </>}>
      <div className="stack">
        {!sede && (
          <Field label="Código" htmlFor="sd-cod" error={errores.code} hint={codigo.trim().length >= 3 ? `Tus socios de aquí se numeran ${codigo.trim().slice(0, 3).toUpperCase()}-00001. Las tres primeras letras no se cambian después.` : 'De 3 a 8 caracteres. Las primeras tres letras son el prefijo de sus socios y no se pueden cambiar después.'}>
            <input id="sd-cod" className="input mono" autoFocus maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="SUR" />
          </Field>
        )}
        <Field label="Nombre" htmlFor="sd-nom" error={errores.name}><input id="sd-nom" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Sur" /></Field>
        <Field label="Dirección" htmlFor="sd-dir" error={errores.addressLine}><input id="sd-dir" className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></Field>
        {sede && activo('intake') && (
          <Field label="Enlace del alta" htmlFor="sd-enl" error={errores.publicSlug} hint={`Para Instagram y WhatsApp: ${portal.replace(/^https?:\/\//, '')}/alta/${enlace || 'tu-gimnasio-centro'}. Minúsculas, números y guiones.`}>
            <input id="sd-enl" className="input mono" value={enlace} maxLength={40} placeholder="tu-gimnasio-centro"
              onChange={(e) => setEnlace(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
          </Field>
        )}
        <Field label="Zona horaria" htmlFor="sd-zona" error={errores.timezone} hint="Define a qué hora se cierra el día: cortes, vencimientos y clases. Si es la del gimnasio, la sigue aunque esta cambie.">
          <select id="sd-zona" className="select" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Igual que el gimnasio · {nombreZona(org.timezone)}</option>
            {ZONAS.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

const MOTIVOS_CIERRE = ['Se termina la renta del local', 'Se juntó con otra sucursal', 'Es temporal'];

/**
 * CERRAR {SEDE} (19-06, D19-03). Antes era desmarcar una casilla y «Guardar»;
 * ahora dice qué se lleva por delante, no deja cerrarla con un turno abierto
 * ni con personal asignado, y pide motivo, como apagar un módulo.
 */
function CerrarSede({ sede, onClose, onListo }: { sede: Sede; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const resumen = useCarga(useCallback(() => api<Cierre>(`/branches/${sede.id}/closing-summary`), [sede.id]));
  const c = resumen.datos;
  const personal = c?.staff ?? [];
  const reservas = c?.classBlockers ?? [];
  const bloqueada = !!c && (c.openCashSessions > 0 || personal.length > 0 || reservas.length > 0);
  const [fallo, setFallo] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setFallo(null);
    try {
      await api(`/branches/${sede.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false, reason: motivo.trim() }) });
      toast('ok', `${sede.name} quedó cerrada`);
      onListo();
    } catch (e) {
      // El porqué se queda en el pie del diálogo, no en un aviso que se va.
      setFallo(errorText(e, 'No se pudo cerrar la sucursal'));
      // Algo cambió mientras tanto (abrieron un turno, asignaron a alguien): se vuelve a contar.
      if (e instanceof ApiError && e.status === 409) void resumen.recargar();
    } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={() => { if (!enviando) onClose(); }} title={`Cerrar ${sede.name}`} error={fallo}
      sub="Deja de aparecer para vender, cobrar y dar de alta. No se borra nada y se puede reabrir."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button variant="danger" icon={<DoorClosed />} loading={enviando} disabled={!c || bloqueada || motivo.trim().length < 3} onClick={() => void confirmar()}>Cerrar {sede.name}</Button></>}>
      <div className="stack">
        {resumen.error && <ErrorCarga titulo="No se pudo revisar qué se lleva cerrarla" mensaje={resumen.error} onReintentar={() => void resumen.recargar()} />}
        {!c && !resumen.error && <EsqueletoLista filas={2} />}
        {c && c.openCashSessions > 0 && (
          <Callout tone="danger" title="Tiene caja abierta: no se puede cerrar">
            {c.openCashSessions} {c.openCashSessions === 1 ? 'turno abierto' : 'turnos abiertos'}: haz el corte antes. El corte es donde se cuenta el cajón.
          </Callout>
        )}
        {c && personal.length > 0 && (
          <Callout tone="danger" title={personal.length === 1 ? 'Tiene una persona asignada' : `Tiene ${personal.length} personas asignadas`}>
            <p>{frase(personal.map((p) => `${p.fullName} (${p.roleName})`))}: {personal.length === 1 ? 'entraría' : 'entrarían'} a una sucursal que ya no vende ni cobra. En Personal, cámbia{personal.length === 1 ? 'le' : 'les'} la sucursal o da{personal.length === 1 ? 'la' : 'las'} de baja, y vuelve aquí.</p>
            <div className="callout-accion"><ButtonLink href="/personal" size="sm">Ir a Personal</ButtonLink></div>
          </Callout>
        )}
        {c && reservas.length > 0 && (
          <Callout tone="danger" title="Hay socios con lugar apartado">
            <p>{frase(reservas)} en {sede.name}: esos socios cuentan con su clase. Cancela esas clases desde Clases (reciben su aviso) y vuelve aquí.</p>
            <div className="callout-accion"><ButtonLink href="/clases" size="sm">Ir a Clases</ButtonLink></div>
          </Callout>
        )}
        {c && (
          <Callout tone={bloqueada ? 'info' : 'warn'} title="Al cerrarla">
            {c.homeMembers} {c.homeMembers === 1 ? 'socio tiene' : 'socios tienen'} esta sede de casa, {c.liveMemberships} {c.liveMemberships === 1 ? 'membresía vigente se vendió' : 'membresías vigentes se vendieron'} aquí
            {c.classTemplates > 0 ? ` y hay ${c.classTemplates} ${c.classTemplates === 1 ? 'horario de clases' : 'horarios de clases'}, que dejan de generar clases` : ''}. Nada se borra: sus socios siguen entrando a las demás según su plan.
          </Callout>
        )}
        {c && !bloqueada && (
          <CampoMotivo id="cs-mot" autoFocus value={motivo} onChange={setMotivo} motivos={MOTIVOS_CIERRE} />
        )}
      </div>
    </Dialog>
  );
}

/** Reabrir una sede cerrada: vuelve a aparecer para vender y cobrar. */
function ReabrirSede({ sede, onClose, onListo }: { sede: Sede; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setEnviando(true);
    try {
      await api(`/branches/${sede.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true, ...(motivo.trim() ? { reason: motivo.trim() } : {}) }) });
      toast('ok', `${sede.name} está abierta otra vez`);
      onListo();
    } catch (e) { toast('error', errorText(e, 'No se pudo reabrir la sucursal')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={() => { if (!enviando) onClose(); }} size="sm" title={`¿Reabrir ${sede.name}?`}
      sub="Vuelve a aparecer para vender, cobrar y dar de alta. Lo que tenía regresa como estaba."
      footer={<><Button variant="secondary" onClick={onClose} disabled={enviando}>Volver</Button>
        <Button icon={<DoorOpen />} loading={enviando} onClick={() => void confirmar()}>Reabrir</Button></>}>
      <CampoMotivo id="rs-mot" label="Motivo (opcional)" required={false} autoFocus value={motivo} onChange={setMotivo} />
    </Dialog>
  );
}

/** Agregar, renombrar o retirar una caja (DP-09): el nombre sale en cortes y bitácora para siempre. */
function CajaDialog({ sede, caja, cajas, onClose, onListo }: { sede: Sede; caja: Caja | null; cajas: readonly Caja[]; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [nombre, setNombre] = useState(caja?.name ?? `Caja ${cajas.length + 1} ${sede.code}`);
  const [enviando, setEnviando] = useState(false);
  // La última caja activa no se retira (19-07): sin caja no se cobra en efectivo.
  const ultima = !!caja?.isActive && cajas.filter((c) => c.isActive).length <= 1;
  async function guardar(retirar = false) {
    setEnviando(true);
    try {
      if (caja) {
        await api(`/cash-registers/${caja.id}`, { method: 'PATCH', body: JSON.stringify(retirar ? { isActive: false } : { name: nombre.trim() }) });
        toast('ok', retirar ? `${caja.name} retirada` : 'Caja renombrada');
      } else {
        await api('/cash-registers', { method: 'POST', body: JSON.stringify({ branchId: sede.id, code: `C${cajas.length + 1}`, name: nombre.trim() }) });
        toast('ok', `${nombre.trim()} agregada a ${sede.name}`);
      }
      onListo();
    } catch (e) { toast('error', errorText(e, retirar ? 'No se pudo retirar la caja' : 'No se pudo guardar la caja')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={onClose} title={caja ? `Caja ${caja.name}` : `Agregar caja a ${sede.name}`}
      sub={caja ? 'El nombre nuevo se usa de aquí en adelante; los cortes viejos conservan el suyo.' : 'Cada caja lleva su propio turno y su propio corte.'}
      footer={<>
        {caja?.isActive && <Button variant="danger-ghost" disabled={enviando || ultima} onClick={() => void guardar(true)}>Retirar caja</Button>}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} disabled={nombre.trim().length < 2} onClick={() => void guardar()}>{caja ? 'Guardar' : 'Agregar'}</Button>
      </>}>
      <div className="stack">
        <Field label="Nombre" htmlFor="cj-nom" hint="Como la llaman en el mostrador: «Caja principal», «Caja de la entrada»…">
          <input id="cj-nom" className="input" autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        {ultima && (
          <Callout tone="warn" title={`Es la única caja de ${sede.name}`}>
            <p>Sin caja no se cobra en efectivo, así que no se retira. Si en {sede.name} ya no se corta cajón, deja de usar Caja ahí: se cobra sin turno ni corte.</p>
            <div className="callout-accion"><ButtonLink href={`/modulos?modulo=cash&sede=${sede.id}`} size="sm">Dejar de usar Caja en {sede.name}</ButtonLink></div>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
