'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, PenLine, Search, UserPlus, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, pesos } from '@gymflow/ui/format';
import { DATO_DUDOSO, ESTADO_DATOS, type CampoDudoso } from '@/lib/importar';
import { useBuscarSocios, type SocioHallado } from '@/lib/buscar-socios';
import { useSession, useToast, errorText } from '@/components/session';
import { InputPesos } from '@/components/input-pesos';
import { Badge, Button, CampoFecha, Card, Dialog, Empty, EsqueletoTabla, Field } from '@/components/ui';
import { hoyEn } from '@/lib/zonas';
import { DECISION, type Decision, type Fila, type Pestana } from './tipos';

type DecisionDatos = { data: 'WITHOUT' } | { data: 'FIXED'; fix: Partial<Record<'balanceCents' | 'periodEnd' | 'joinedAt', string | null>> };

export function ListaFilas({ importId, pestana, editable, onCambio }: { importId: string; pestana: Pestana; editable: boolean; onCambio: () => void }) {
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback((despues?: number) => {
    const filtro: Record<string, string> = pestana === 'DATA' ? { data: 'PENDING,WITHOUT,FIXED' } : { kind: pestana };
    const p = new URLSearchParams({ ...filtro, limit: '50', ...(q.trim() ? { q: q.trim() } : {}), ...(despues ? { after: String(despues) } : {}) });
    return api<{ rows: Fila[]; next: number | null }>(`/member-imports/${importId}/rows?${p}`).then((r) => {
      setFilas((f) => (despues ? [...(f ?? []), ...r.rows] : r.rows));
      setNext(r.next);
    }).catch((e) => toast('error', errorText(e, 'No se pudieron cargar las filas')));
  }, [importId, pestana, q, toast]);
  useEffect(() => { const t = setTimeout(() => void cargar(), q ? 250 : 0); return () => clearTimeout(t); }, [cargar, q]);

  async function guardar(f: Fila, cuerpo: { decision: Exclude<Decision, 'PENDING'> } | DecisionDatos): Promise<boolean> {
    setOcupado(f.id);
    try {
      const r = await api<Fila>(`/member-imports/${importId}/rows/${f.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
      setFilas((xs) => xs?.map((x) => (x.id === f.id ? { ...x, ...r, matchMember: x.matchMember, matchRow: x.matchRow, appliedMember: x.appliedMember, openingNote: x.openingNote } : x)) ?? null);
      onCambio();
      return true;
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar la decisión')); return false; } finally { setOcupado(null); }
  }
  const decidir = (f: Fila, decision: Exclude<Decision, 'PENDING'>) => guardar(f, { decision });
  // «Es otro socio…» (18-05): la fila se une a quien eligió la persona, no al que propuso el sistema.
  const [otroSocio, setOtroSocio] = useState<Fila | null>(null);
  async function unirCon(f: Fila, socio: SocioHallado) {
    setOcupado(f.id);
    try {
      await api<Fila>(`/member-imports/${importId}/rows/${f.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'MERGE', memberId: socio.id }) });
      setOtroSocio(null);
      // El lado «En GymFlow» cambia de persona: se vuelve a pedir la lista.
      await cargar();
      onCambio();
    } catch (e) { toast('error', errorText(e, 'No se pudo unir con ese socio')); } finally { setOcupado(null); }
  }

  if (!filas) return <div className="card"><EsqueletoTabla filas={4} columnas={5} /></div>;
  return (
    <div className="stack">
      <input className="input importar-buscar" placeholder="Buscar por nombre, celular o código" aria-label="Buscar en el archivo" value={q} onChange={(e) => setQ(e.target.value)} />
      {filas.length === 0 && <Card><Empty icon={<Users />} title={q.trim() ? 'Ninguna fila coincide con la búsqueda' : 'Ninguna fila en esta pestaña'} /></Card>}
      {pestana === 'DATA'
        ? filas.map((f) => <DatosFila key={f.id} f={f} editable={editable && !f.appliedMemberId} ocupado={ocupado === f.id} onGuardar={(c) => guardar(f, c)} />)
        : pestana === 'REVIEW' || pestana === 'MATCH' || pestana === 'FILE_DUP'
          ? filas.map((f) => <Caso key={f.id} f={f} editable={editable && !f.appliedMemberId} ocupado={ocupado === f.id} onDecidir={(x) => void decidir(f, x)}
              onOtroSocio={pestana === 'REVIEW' ? () => setOtroSocio(f) : undefined} />)
          : filas.length > 0 && (
            <Card pad={false}>
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead><tr><th>Renglón</th><th>Nombre</th><th>Celular</th><th>Código</th><th className="right">Saldo</th><th>Vigente hasta</th><th>Qué pasa</th></tr></thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.id} data-fila={f.rowNumber}>
                        <td className="num small muted" data-label="Renglón">{f.rowNumber}</td>
                        <td data-label="Nombre">
                          <span className="strong">{`${f.firstName} ${f.lastName}`.trim() || '—'}</span>
                          {/* Lo que no se leyó, plegado: una línea larga por fila tapaba el nombre (18-08). */}
                          {f.problems.length > 0 && (
                            <details className="importar-problemas">
                              <summary className="tiny text-warn">{f.problems.length === 1 ? '1 dato no se leyó' : `${f.problems.length} datos no se leyeron`}</summary>
                              <div className="tiny text-warn">{f.problems.join(' · ')}</div>
                            </details>
                          )}
                          {f.dataStatus === 'PENDING' && f.decision !== 'SKIP' && <div className="tiny text-warn strong">Dato dudoso: decídelo en «Con datos dudosos».</div>}
                          {f.openingNote && <div className="tiny text-warn">{f.openingNote}</div>}
                          {f.applyNote && <div className="tiny muted">{f.applyNote}</div>}
                        </td>
                        <td className="small" data-label="Celular">{f.phoneE164 ?? '—'}</td>
                        <td className="small" data-label="Código"><code>{f.legacyCode ?? '—'}</code></td>
                        <td className="right num small" data-label="Saldo">{f.balanceCents ? pesos(f.balanceCents) : '—'}</td>
                        <td className="small" data-label="Vigente hasta">{f.periodEnd ? fecha(f.periodEnd) : '—'}{f.planLabel ? <div className="tiny muted">{f.planLabel}</div> : null}</td>
                        <td data-label="Qué pasa">
                          {f.appliedMemberId
                            ? <Link href={`/socios/${f.appliedMemberId}`} className="small strong">Ver ficha</Link>
                            : editable && f.kind !== 'INVALID'
                              ? <select className="select importar-que-pasa" aria-label={`Qué hacer con el renglón ${f.rowNumber}`} value={f.decision} disabled={ocupado === f.id}
                                  onChange={(e) => void decidir(f, e.target.value as Exclude<Decision, 'PENDING'>)}>
                                  <option value="CREATE">Dar de alta</option>
                                  <option value="SKIP">Omitir</option>
                                </select>
                              : <Badge>{DECISION[f.decision]}</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
      {next !== null && <Button variant="secondary" onClick={() => void cargar(next)}>Cargar más</Button>}
      {otroSocio && <OtroSocio fila={otroSocio} ocupado={ocupado === otroSocio.id} onClose={() => setOtroSocio(null)} onElegir={(s) => void unirCon(otroSocio, s)} />}
    </div>
  );
}

/**
 * «ES OTRO SOCIO…» (18-05). Homónimos y familias: el archivo trae a «Ma.
 * Guadalupe Pérez» y GymFlow propone a su hermana. Antes la única salida era
 * «Son distintas» (ficha duplicada). Aquí se busca a la persona correcta en el
 * padrón, con el mismo buscador del mostrador, y la fila se une a ella.
 */
function OtroSocio({ fila, ocupado, onClose, onElegir }: { fila: Fila; ocupado: boolean; onClose: () => void; onElegir: (s: SocioHallado) => void }) {
  const { branchName } = useSession();
  const [q, setQ] = useState(`${fila.firstName} ${fila.lastName}`.trim());
  const { hallados, fallo, buscando, reintentar } = useBuscarSocios(q, { limit: 8 });
  return (
    <Dialog open onClose={() => { if (!ocupado) onClose(); }} title="¿Con qué socio se une?"
      sub={<>Renglón {fila.rowNumber} del archivo: <strong>{`${fila.firstName} ${fila.lastName}`.trim()}</strong>. Elige su ficha en GymFlow: solo se completa lo que le falte.</>}
      footer={<Button variant="secondary" onClick={onClose} disabled={ocupado}>Volver</Button>}>
      <div className="stack">
        <Field label="Buscar socio" htmlFor="imp-otro" hint="Nombre, celular o código.">
          <input id="imp-otro" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {fallo && <p className="small text-danger">No se pudo buscar. <button type="button" className="row-link strong" onClick={reintentar}>Reintentar</button></p>}
        {!fallo && hallados === null && <p className="small muted">{buscando ? 'Buscando…' : 'Escribe al menos dos letras.'}</p>}
        {!fallo && hallados !== null && hallados.length === 0 && <p className="small muted">Nadie coincide. Si de verdad no es socio todavía, vuelve y elige «Son distintas».</p>}
        {hallados !== null && hallados.length > 0 && (
          <ul className="list importar-hallados" data-testid="otro-socio">
            {hallados.map((s) => (
              <li key={s.id} className="importar-hallado">
                <span className="min-w-0">
                  <span className="strong block">{`${s.firstName} ${s.lastName}`.trim()}</span>
                  <span className="tiny muted"><code>{s.memberCode}</code> · {branchName(s.homeBranchId)}{s.status === 'ARCHIVED' ? ' · dado de baja' : ''}</span>
                </span>
                <Button size="sm" variant="secondary" icon={<Check />} disabled={ocupado} onClick={() => onElegir(s)}>Es esta persona</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** Un caso, lado a lado: lo que dice el archivo contra el socio (o la otra fila) con que se parece. */
function Caso({ f, editable, ocupado, onDecidir, onOtroSocio }: { f: Fila; editable: boolean; ocupado: boolean; onDecidir: (d: Exclude<Decision, 'PENDING'>) => void; onOtroSocio?: (() => void) | undefined }) {
  const { branchName } = useSession();
  const otro = f.matchMember
    ? { titulo: `En GymFlow · ${f.matchMember.memberCode}`, nombre: f.matchMember.fullName, phone: f.matchMember.phoneE164, email: f.matchMember.email, birth: f.matchMember.birthDate,
        desde: f.matchMember.joinedAt.slice(0, 10), sede: branchName(f.matchMember.homeBranchId), codigo: f.matchMember.legacyCodes.join(', ') || null,
        saldo: f.matchMember.balanceCents, href: `/socios/${f.matchMember.id}` }
    : f.matchRow
      ? { titulo: `En el archivo · renglón ${f.matchRow.rowNumber}`, nombre: `${f.matchRow.firstName} ${f.matchRow.lastName}`, phone: f.matchRow.phoneE164, email: f.matchRow.email, birth: f.matchRow.birthDate,
          desde: f.matchRow.joinedAt, sede: f.matchRow.branchLabel, codigo: f.matchRow.legacyCode, saldo: f.matchRow.balanceCents, href: null }
      : null;
  const igual = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  return (
    <div className="card card-pad importar-caso" data-decision={f.decision} data-caso={f.rowNumber}>
      <div className="row-between importar-caso-cabeza">
        <span className="small"><strong>{f.matchReason}</strong>{f.matchScore !== null && <span className="muted"> · coincidencia {f.matchScore}</span>}</span>
        {f.decision !== 'PENDING' && <Badge tone={f.decision === 'MERGE' ? 'ok' : f.decision === 'CREATE' ? 'info' : 'neutral'} dot>{f.decision === 'MERGE' ? 'Misma persona: se unen' : f.decision === 'CREATE' ? 'Distintas: alta aparte' : 'Se omite'}</Badge>}
      </div>
      <div className="importar-comparar">
        <Lado titulo={`En el archivo · renglón ${f.rowNumber}`} nombre={`${f.firstName} ${f.lastName}`} filas={[
          ['Celular', f.phoneE164, igual(f.phoneE164, otro?.phone)], ['Correo', f.email, igual(f.email, otro?.email)],
          ['Nacimiento', f.birthDate ? fecha(f.birthDate) : null, igual(f.birthDate, otro?.birth)], ['Socio desde', f.joinedAt ? fecha(f.joinedAt) : null, false],
          ['Sucursal', f.branchLabel, false], ['Código', f.legacyCode, igual(f.legacyCode, otro?.codigo)], ['Saldo', f.balanceCents ? pesos(f.balanceCents) : null, false],
        ]} />
        {otro && <Lado titulo={otro.titulo} nombre={otro.nombre} href={otro.href} filas={[
          ['Celular', otro.phone, igual(f.phoneE164, otro.phone)], ['Correo', otro.email, igual(f.email, otro.email)],
          ['Nacimiento', otro.birth ? fecha(otro.birth) : null, igual(f.birthDate, otro.birth)], ['Socio desde', otro.desde ? fecha(otro.desde) : null, false],
          ['Sucursal', otro.sede, false], ['Código', otro.codigo, igual(f.legacyCode, otro.codigo)], ['Saldo', otro.saldo && otro.saldo !== '0' ? pesos(otro.saldo) : null, false],
        ]} />}
      </div>
      {f.openingNote && <p className="tiny text-warn mt-8">{f.openingNote}</p>}
      {f.dataStatus === 'PENDING' && f.decision !== 'SKIP' && <p className="tiny text-warn strong mt-8">Trae un dato dudoso: decídelo también en «Con datos dudosos».</p>}
      {f.applyNote && <p className="tiny muted mt-8">{f.applyNote}</p>}
      {f.appliedMemberId && <p className="small mt-8"><Link href={`/socios/${f.appliedMemberId}`} className="strong">Ver ficha</Link></p>}
      {editable && (
        <div className="importar-acciones mt-12">
          <Button size="sm" variant={f.decision === 'MERGE' ? 'primary' : 'secondary'} icon={<Check />} disabled={ocupado} onClick={() => onDecidir('MERGE')}>Es la misma persona</Button>
          <Button size="sm" variant={f.decision === 'CREATE' ? 'primary' : 'secondary'} icon={<UserPlus />} disabled={ocupado} onClick={() => onDecidir('CREATE')}>Son distintas</Button>
          {onOtroSocio && <Button size="sm" variant="secondary" icon={<Search />} disabled={ocupado} onClick={onOtroSocio}>Es otro socio…</Button>}
          <Button size="sm" variant="ghost" icon={<X />} disabled={ocupado} onClick={() => onDecidir('SKIP')}>Omitir fila</Button>
        </div>
      )}
    </div>
  );
}

/** El valor que una fila lleva hoy en un dato dudoso, para mostrarlo y para empezar a corregirlo. */
function valorActual(f: Fila, campo: CampoDudoso): string | null {
  if (campo === 'balance') return f.balanceCents;
  return campo === 'periodEnd' ? f.periodEnd : f.joinedAt;
}

/**
 * Una fila con datos dudosos (D18-02): qué decía el archivo y la decisión.
 * «Entra sin ese dato», «Corregir el valor» (solo lo que no se entendió) u
 * «Omitir fila». El saldo se escribe en pesos con «Debe» o «A favor».
 */
function DatosFila({ f, editable, ocupado, onGuardar }: { f: Fila; editable: boolean; ocupado: boolean; onGuardar: (c: { decision: 'SKIP' } | DecisionDatos) => Promise<boolean> }) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const saldo0 = f.dataStatus === 'FIXED' && f.balanceCents ? BigInt(f.balanceCents) : null;
  const [debe, setDebe] = useState(saldo0 === null || saldo0 >= 0n);
  const [monto, setMonto] = useState<bigint | null>(saldo0 === null ? null : saldo0 < 0n ? -saldo0 : saldo0);
  const [fechas, setFechas] = useState<Record<'periodEnd' | 'joinedAt', string>>({ periodEnd: f.dataStatus === 'FIXED' ? f.periodEnd ?? '' : '', joinedAt: f.dataStatus === 'FIXED' ? f.joinedAt ?? '' : '' });
  const estado = f.dataStatus ? ESTADO_DATOS[f.dataStatus] : null;
  const omitida = f.decision === 'SKIP';
  // «Después de hoy» se cuenta con la fecha del gimnasio, no con la de la computadora (26-06).
  const { org } = useSession();
  const hoy = hoyEn(org.timezone);

  async function corregir() {
    const fix: Partial<Record<'balanceCents' | 'periodEnd' | 'joinedAt', string | null>> = {};
    for (const d of f.doubtful) {
      if (d.field === 'balance') fix.balanceCents = monto === null ? null : String(debe ? monto : -monto);
      else fix[d.field] = fechas[d.field] || null;
    }
    if (await onGuardar({ data: 'FIXED', fix })) setCorrigiendo(false);
  }

  return (
    <div className="card card-pad importar-caso" data-dato={f.rowNumber} data-datos={omitida ? 'SKIP' : f.dataStatus ?? undefined}>
      <div className="row-between importar-caso-cabeza">
        <span className="small"><strong>{`${f.firstName} ${f.lastName}`.trim()}</strong><span className="muted"> · renglón {f.rowNumber}</span></span>
        {omitida ? <Badge dot>Se omite</Badge> : estado && <Badge tone={estado.tone} dot>{estado.label}</Badge>}
      </div>
      <div className="importar-lado">
        <div className="tiny muted strong">No se entendió en el archivo</div>
        <dl>
        {f.doubtful.map((d) => {
          const actual = valorActual(f, d.field);
          return (
            <div key={d.field} className="importar-par">
              <dt>{DATO_DUDOSO[d.field]}</dt>
              <dd>
                <span className="text-warn">El archivo dice «{d.value}»</span>
                {f.dataStatus === 'FIXED' && (
                  <span className="strong"> → {actual === null ? 'sin dato' : d.field === 'balance' ? (BigInt(actual) < 0n ? `${pesos(-BigInt(actual))} a favor` : pesos(actual)) : fecha(actual)}</span>
                )}
                {f.dataStatus === 'WITHOUT' && <span className="muted"> → entra sin este dato</span>}
              </dd>
            </div>
          );
        })}
        </dl>
      </div>
      {f.openingNote && <p className="tiny text-warn mt-8">{f.openingNote}</p>}
      {f.applyNote && <p className="tiny muted mt-8">{f.applyNote}</p>}
      {f.appliedMemberId && <p className="small mt-8"><Link href={`/socios/${f.appliedMemberId}`} className="strong">Ver ficha</Link></p>}
      {omitida && editable && <p className="tiny muted mt-8">Se omite. Para importarla, cámbiala en su pestaña («Nuevos», «Ya son socios»…).</p>}

      {editable && !omitida && corrigiendo && (
        <div className="stack-sm mt-12">
          {f.doubtful.map((d) => d.field === 'balance' ? (
            <Field key={d.field} label="Saldo correcto" htmlFor={`dato-saldo-${f.id}`} hint="Vacío o en cero: entra sin saldo.">
              <div className="row gap-8">
                <select className="select importar-debe" aria-label="Debe o tiene a favor" value={debe ? 'DEBE' : 'FAVOR'} onChange={(e) => setDebe(e.target.value === 'DEBE')}>
                  <option value="DEBE">Debe</option>
                  <option value="FAVOR">A favor</option>
                </select>
                <InputPesos id={`dato-saldo-${f.id}`} valueCents={monto} onChange={(c) => setMonto(c)} style={{ maxWidth: 160 }} ariaLabel="Saldo correcto" />
              </div>
            </Field>
          ) : (
            <Field key={d.field} label={d.field === 'periodEnd' ? 'Vigente hasta (correcto)' : 'Socio desde (correcto)'} htmlFor={`dato-${d.field}-${f.id}`} hint={d.field === 'joinedAt' ? 'No puede ser después de hoy.' : 'Si ya pasó, entra sin membresía.'}>
              <CampoFecha id={`dato-${d.field}-${f.id}`} className="campo-corto" max={d.field === 'joinedAt' ? hoy : undefined}
                value={fechas[d.field]} onChange={(v) => setFechas({ ...fechas, [d.field]: v })} />
            </Field>
          ))}
          <div className="row wrap gap-8">
            <Button size="sm" icon={<Check />} loading={ocupado} onClick={() => void corregir()}>Guardar corrección</Button>
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setCorrigiendo(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      {editable && !omitida && !corrigiendo && (
        <div className="importar-acciones mt-12">
          <Button size="sm" variant={f.dataStatus === 'WITHOUT' ? 'primary' : 'secondary'} icon={<Check />} disabled={ocupado} onClick={() => void onGuardar({ data: 'WITHOUT' })}>Entra sin ese dato</Button>
          <Button size="sm" variant={f.dataStatus === 'FIXED' ? 'primary' : 'secondary'} icon={<PenLine />} disabled={ocupado} onClick={() => setCorrigiendo(true)}>Corregir el valor</Button>
          <Button size="sm" variant="ghost" icon={<X />} disabled={ocupado} onClick={() => void onGuardar({ decision: 'SKIP' })}>Omitir fila</Button>
        </div>
      )}
    </div>
  );
}

function Lado({ titulo, nombre, filas, href }: { titulo: string; nombre: string; filas: Array<[string, string | null | undefined, boolean]>; href?: string | null }) {
  return (
    <div className="importar-lado">
      <div className="tiny muted strong">{titulo}</div>
      <div className="strong">{href ? <Link href={href} target="_blank">{nombre}</Link> : nombre}</div>
      <dl>
        {filas.map(([k, v, eq]) => (
          <div key={k} className="importar-par">
            <dt>{k}</dt><dd className={eq ? 'igual' : undefined}>{v ?? <span className="faint">—</span>}{eq && ' ✓'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
