'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, UserPlus, FileUp, DoorOpen, CalendarCheck, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { antiguedad, pesos, telefono } from '@gymflow/ui/format';
import { useResumenAccesoPorLotes } from '@/lib/resumen-acceso';
import { AccesoBadge } from '@/components/acceso';
import { useSession, errorText } from '@/components/session';
import { Avatar, Badge, Button, ButtonLink, Card, Empty, Segmented, Skeleton, ErrorCarga, Switch } from '@/components/ui';
import { EntradaDialog } from '@/components/entrada';
import { InscribirClaseDialog } from '@/components/inscribir-clase';
import { IconButton } from '@gymflow/ui/compartido';
import type { MemberListPage, MemberSummary } from '@gymflow/core/contracts';

/** El socio y el padrón: contratos del núcleo (2-13). */
type Member = MemberSummary;
type Pagina = MemberListPage;

const ESTADOS = [
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'INACTIVE', label: 'Inactivos' },
  { value: 'PROSPECT', label: 'Prospectos' },
] as const;

/**
 * EL PADRÓN: el conjunto, para mirar quién debe, quién se fue y cuántos hay
 * por sede. Es la mitad de `/socios` que se ve con el buscador vacío; salió de
 * `socios/page.tsx` al abrirlo para el mostrador (bloque 2.1), sin cambiar lo
 * que hace. Todos los filtros viven en el servidor: la lista y el total dicen
 * la verdad aunque el padrón tenga miles (OPT-01).
 *
 * En el teléfono (2-09) cada socio ocupa dos renglones: nombre y código; su
 * insignia y, si debe, cuánto. Las acciones están en su ficha y en la tarjeta
 * del buscador, no en botones que se salían de la fila.
 */
export function Padron({ soloCoach, onNuevo }: { soloCoach: boolean; onNuevo: () => void }) {
  const router = useRouter();
  const { branches, branchName, can, activo } = useSession();
  const verDinero = can('billing:statement:read');
  const [entrada, setEntrada] = useState<Member | null>(null);
  const [clase, setClase] = useState<Member | null>(null);
  const [estado, setEstado] = useState<(typeof ESTADOS)[number]['value']>('ACTIVE');
  const [sede, setSede] = useState('');
  const [soloDeudores, setSoloDeudores] = useState(false);
  const [items, setItems] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  // Gimnasio recién abierto: sin ningún socio, el padrón invita a registrar o importar en vez de culpar a los filtros.
  const [sinSocios, setSinSocios] = useState(false);
  const sedesActivas = branches.filter((b) => b.isActive);

  // `/socios?adeudo=1` llega desde el inicio y el tablero ("Vencido → quién debe").
  // Se lee al montar: con useSearchParams la página dejaría de prerenderse.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('adeudo') === '1') setSoloDeudores(true);
  }, []);

  const consulta = new URLSearchParams({
    status: estado, limit: '50',
    ...(sede ? { branchId: sede } : {}),
    ...(soloDeudores ? { withDebt: 'true' } : {}),
  }).toString();

  useEffect(() => {
    let vigente = true;
    setItems(null); setFallo(null);
    api<Pagina>(`/members?${consulta}`)
      .then((p) => {
        if (!vigente) return;
        setItems(p.members); setTotal(p.total); setCursor(p.nextCursor);
        if (p.total > 0) setSinSocios(false);
        // Vacío con filtros: ¿no hay nadie así, o no hay nadie en absoluto?
        else api<Pagina>('/members?limit=1').then((t) => { if (vigente) setSinSocios(t.total === 0); }).catch(() => undefined);
      })
      .catch((e) => { if (vigente) { setFallo(errorText(e, 'No se pudo cargar el padrón')); setItems([]); setTotal(0); setCursor(null); } });
    return () => { vigente = false; };
  }, [consulta, intento]);

  async function masSocios() {
    if (!cursor) return;
    setCargando(true);
    try {
      const p = await api<Pagina>(`/members?${consulta}&cursor=${cursor}`);
      setItems((xs) => [...(xs ?? []), ...p.members]);
      setCursor(p.nextCursor);
    } finally { setCargando(false); }
  }
  const visibles = items ?? [];
  // Por lotes de 100 (2-06): tras «Cargar más» la petición única pasaba de 100 y respondía 422.
  const { mapa: acceso, fallo: falloAcceso, reintentar: reintentarAcceso } = useResumenAccesoPorLotes(visibles.map((m) => m.id));

  /** La insignia de acceso; si su lote no cargó, «sin dato» con reintento en vez de «…» para siempre. */
  const insignia = (m: Member) => (falloAcceso && !acceso.has(m.id) && m.status !== 'ARCHIVED'
    ? <span className="row gap-4" title="No se pudo saber si puede entrar">
        <Badge tone="warn" dot>Sin dato</Badge>
        <IconButton label="Reintentar saber si puede entrar" onClick={(e) => { e.stopPropagation(); reintentarAcceso(); }}><RotateCw /></IconButton>
      </span>
    : <AccesoBadge resumen={acceso.get(m.id)} archivado={m.status === 'ARCHIVED'} />);

  const accionesFila = (m: Member) => (
    <>
      {can('classes:book_for_member') && activo('classes') && m.status !== 'ARCHIVED' && (
        <IconButton label="Inscribir a una clase" onClick={(e) => { e.stopPropagation(); setClase(m); }}><CalendarCheck /></IconButton>)}
      {can('access:monitor') && m.status !== 'ARCHIVED' && (
        <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Registrar entrada" title="Registrar entrada" onClick={(e) => { e.stopPropagation(); setEntrada(m); }}><DoorOpen /></button>)}
    </>
  );

  return (
    <>
      <Card pad={false} data-testid="padron">
        <div className="card-head wrap">
          <div className="row wrap gap-10">
            <Segmented value={estado} onChange={setEstado} options={ESTADOS} />
            {/* Con una sola sucursal el filtro no filtra nada. */}
            {sedesActivas.length > 1 && (
              <select className="select padron-sede" value={sede} onChange={(e) => setSede(e.target.value)} aria-label="Sucursal">
                <option value="">Todas las sucursales</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {verDinero && (
              <Switch style={{ alignItems: 'center' }} checked={soloDeudores} onChange={(v) => setSoloDeudores(v)}>Solo con adeudo</Switch>
            )}
          </div>
          <span className="tiny muted">{items ? `${total.toLocaleString('es-MX')} ${total === 1 ? 'socio' : 'socios'}` : ''}</span>
        </div>

        {fallo ? (
          <div className="card-body"><ErrorCarga mensaje={fallo} onReintentar={() => setIntento((n) => n + 1)} /></div>
        ) : items === null ? (
          <div className="card-body stack-sm">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={44} />)}</div>
        ) : visibles.length === 0 && sinSocios && soloCoach ? (
          <Empty icon={<Users />} title="Aún no tienes socios asignados" text="Aquí aparecen los socios que recepción o gerencia te asignen desde su ficha." />
        ) : visibles.length === 0 && sinSocios ? (
          <Empty icon={<Users />} title="Aún no hay socios" text="Registra al primero desde aquí o, si vienes de otro sistema, importa tu base."
            action={(can('members:create') || can('members:import')) && <div className="row wrap gap-8">
              {can('members:create') && <Button size="sm" icon={<UserPlus />} onClick={onNuevo}>Nuevo socio</Button>}
              {can('members:import') && <ButtonLink size="sm" href="/importar" variant="secondary" icon={<FileUp />}>Importar socios</ButtonLink>}
            </div>} />
        ) : visibles.length === 0 ? (
          <Empty icon={<Users />} title="Nadie con esos filtros" text={sedesActivas.length > 1 ? 'Prueba con otro estado o sucursal.' : 'Prueba con otro estado.'} />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack padron-tabla">
              <thead>
                <tr><th>Socio</th><th>Teléfono</th><th>Sucursal</th><th>Antigüedad</th><th>Estado</th><th />{verDinero && <th className="right">Saldo</th>}</tr>
              </thead>
              <tbody>
                {visibles.map((m) => {
                  const debe = m.balanceCents !== null && BigInt(m.balanceCents) > 0n;
                  return (
                    <tr key={m.id} className="is-link" onClick={() => router.push(`/socios/${m.id}`)}>
                      <td>
                        <div className="row gap-12">
                          <Avatar name={`${m.firstName} ${m.lastName}`} size={34} />
                          <div className="min-w-0">
                            <Link className="strong ellipsis row-link" href={`/socios/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.firstName} {m.lastName}</Link>
                            <div className="tiny muted"><code>{m.memberCode}</code>{sedesActivas.length > 1 && <span className="stack-only-inline"> · {branchName(m.homeBranchId)}</span>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="muted num stack-hide nowrap">{telefono(m.phoneE164)}</td>
                      <td className="small stack-hide">{branchName(m.homeBranchId)}</td>
                      <td className="muted stack-hide">{m.joinedAt ? antiguedad(m.joinedAt) : '—'}</td>
                      <td>{insignia(m)}</td>
                      <td className="right nowrap stack-hide"><div className="row gap-4 justify-end">{accionesFila(m)}</div></td>
                      {verDinero && <td className={debe ? 'right num' : 'right num stack-hide'}>{debe ? <span className="strong text-danger">{pesos(m.balanceCents!)}</span> : <span className="faint">—</span>}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items && items.length > 0 && (
          <div className="card-foot row-between wrap gap-10">
            <span className="tiny muted">{items.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')} socios</span>
            {cursor && <Button size="sm" variant="secondary" loading={cargando} onClick={() => void masSocios()}>Cargar más</Button>}
          </div>
        )}
      </Card>

      {entrada && <EntradaDialog memberId={entrada.id} memberName={entrada.firstName} onClose={() => setEntrada(null)} onDone={() => setEntrada(null)} />}
      {clase && <InscribirClaseDialog memberId={clase.id} nombre={clase.firstName} homeBranchId={clase.homeBranchId} onClose={() => setClase(null)} />}
    </>
  );
}
