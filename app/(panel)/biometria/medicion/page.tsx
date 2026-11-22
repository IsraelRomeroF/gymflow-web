'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, ScanFace, Trash2, UserCheck, UserX } from 'lucide-react';
import type { FaceEngineStatus, FaceMeasurementAttempt, FaceMeasurementReport } from '@gymflow/core/contracts';
import { api } from '@/lib/api';
import { useCarga } from '@/lib/carga';
import { useBuscarSocios, type SocioHallado } from '@/lib/buscar-socios';
import { fechaHora } from '@/lib/format';
import { useSession, errorText } from '@/components/session';
import { Badge, Button, Callout, Card, Dialog, Empty, ErrorCarga, Field, PageHeader, Segmented, Skeleton, Stat } from '@/components/ui';
import { grabar, retoAlAzar, TEXTO_RETO, useCamara, type Reto } from '@/components/camara-rostro';

type Tipo = 'MEMBER' | 'STRANGER';
type Medido = { ok: true; attempt: FaceMeasurementAttempt } | { ok: false; motivo: string };

const dos = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2));

/**
 * MEDIR EL RECONOCIMIENTO (auditoría 8, bloque 2.3; hallazgo 6-10).
 *
 * El umbral con el que la Estación reconoce nunca se midió con socios. Aquí
 * la gerencia lo mide una vez, en la cámara de recepción: socios con su
 * rostro registrado («es») y personas que no son socios («no es») se paran
 * frente a la cámara igual que al entrar. De cada intento se guardan dos
 * números (cuánto se pareció a su propio rostro y cuánto al de la persona
 * más parecida); nunca la foto. No registra entradas ni descuenta visitas.
 *
 * Esta pantalla MIDE Y PROPONE. El umbral no se cambia aquí: lo cambia quien
 * instala, con este resultado a la vista (`2.3-guia-de-medicion.md`).
 */
export default function MedicionPage() {
  const { branches, inScope, activoEn, can, branchName } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id) && activoEn('biometrics', b.id));
  const puedeMedir = can('access:biometric:enroll') && can('audit:read');
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const informe = useCarga(useCallback(() => api<FaceMeasurementReport>('/access/face/measurements'), []));
  const [motor, setMotor] = useState<FaceEngineStatus | null | undefined>(undefined);
  useEffect(() => { api<FaceEngineStatus>('/access/face/status').then(setMotor).catch(() => setMotor(null)); }, []);
  const [reiniciar, setReiniciar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descartar(cuerpo: { attemptId: string } | { all: true }) {
    setError(null);
    try {
      await api('/access/face/measurements/discard', { method: 'POST', body: JSON.stringify(cuerpo) });
      setReiniciar(false);
      await informe.recargar();
    } catch (e) {
      setError(errorText(e, 'No se pudo descartar'));
    }
  }

  const a = informe.datos?.analysis;
  return (
    <>
      <PageHeader
        title="Medir el reconocimiento"
        sub="Antes de confiarle la puerta al rostro se mide con socios reales y con personas que no son socios. No registra entradas, no descuenta visitas y no guarda fotos: solo cuánto se parecieron."
        actions={<Link href="/biometria" className="btn btn-secondary"><ArrowLeft />Biometría</Link>}
      />

      {informe.error && <div className="mb-24"><ErrorCarga titulo="No se pudo cargar la medición" mensaje={informe.error} onReintentar={() => void informe.recargar()} /></div>}

      <div className="grid grid-3 mb-24">
        {a ? (
          <>
            <Stat icon={<UserCheck />} label="Socios medidos" value={`${a.members} de ${a.membersNeeded}`} note={a.members >= a.membersNeeded ? 'Completo' : `Faltan ${a.membersNeeded - a.members}`} />
            <Stat icon={<UserX />} label="Personas que no son socios" value={`${a.strangers} de ${a.strangersNeeded}`} note={a.strangers >= a.strangersNeeded ? 'Completo' : `Faltan ${a.strangersNeeded - a.strangers}`} />
            <Stat feature icon={<ScanFace />} label="Umbral que sale de lo medido" value={dos(a.suggestedThreshold)}
              note={`Hoy la Estación usa ${dos(a.currentThreshold)}${a.enough ? '' : ' · medición incompleta'}`} />
          </>
        ) : !informe.error && [0, 1, 2].map((i) => <Skeleton key={i} h={112} r={16} />)}
      </div>

      <div className="grid grid-main">
        <div className="stack">
          {!puedeMedir ? (
            <Callout tone="info" title="Solo consulta">La medición la hace la gerencia en la cámara de recepción. Aquí ves su resultado.</Callout>
          ) : sedes.length === 0 ? (
            <Callout tone="info" title="Ninguna sucursal usa biometría">Enciende Biometría en Módulos para medir.</Callout>
          ) : motor === undefined ? <Skeleton h={420} r={16} />
            : !motor?.disponible ? (
              <Callout tone="warn" title="El motor facial no está disponible">{motor?.motivo ?? 'No responde.'} Sin él no se puede medir.</Callout>
            ) : (
              <Medidor sede={sede} sedes={sedes} onSede={setSede} onMedido={() => void informe.recargar()} />
            )}

          <Card title="Intentos" sub="Solo números: cuánto se pareció a su propio rostro y cuánto al de la persona más parecida del padrón." pad={false}
            actions={puedeMedir && (informe.datos?.attempts.length ?? 0) > 0 ? <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setReiniciar(true)}>Empezar de nuevo</Button> : undefined}>
            {!informe.datos ? <p className="card-body small muted">{informe.error ? 'Sin datos.' : 'Cargando…'}</p>
              : informe.datos.attempts.length === 0 ? <Empty icon={<ScanFace />} title="Todavía no hay intentos" text="Empieza con un socio que ya tenga su rostro registrado." />
                : (
                  <div className="table-wrap">
                    <table className="table table-stack" data-testid="medicion-intentos">
                      <thead><tr><th>Quién</th><th className="right">Con su rostro</th><th className="right">Con el más parecido</th><th>Cuándo</th><th /></tr></thead>
                      <tbody>
                        {informe.datos.attempts.map((i) => (
                          <tr key={i.id}>
                            <td>
                              {i.kind === 'MEMBER' ? <span className="strong">{i.memberName ?? 'Socio'}</span> : <span className="muted">No es socio</span>}
                              <span className="tiny muted block">{branchName(i.branchId)} · contra {i.compared} {i.compared === 1 ? 'persona' : 'personas'}</span>
                            </td>
                            <td className="right num">{i.kind === 'MEMBER' ? <Parecido valor={i.ownScore} bien={(v) => v >= (a?.currentThreshold ?? 0)} /> : '—'}</td>
                            <td className="right num"><Parecido valor={i.bestOtherScore} bien={(v) => v < (a?.currentThreshold ?? 1)} /></td>
                            <td className="small muted nowrap">{fechaHora(i.at)}</td>
                            <td className="right">{puedeMedir && <Button variant="ghost" size="sm" aria-label="Descartar este intento" onClick={() => void descartar({ attemptId: i.id })}>Descartar</Button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </Card>
          {error && <Callout tone="danger">{error}</Callout>}
        </div>

        <div className="stack">
          <Card title="Lo que dice la medición">
            {!a ? <Skeleton h={160} r={12} /> : (
              <div className="stack" data-testid="medicion-resultado">
                <Callout tone={a.suggestedThreshold === null ? 'info' : a.enough && a.safeTo !== null && a.suggestedThreshold === a.currentThreshold ? 'ok' : 'warn'}>{a.verdict}</Callout>
                <dl className="bio-cifras">
                  <div><dt>Parecido propio más bajo</dt><dd>{dos(a.lowestOwn)}</dd></div>
                  <div><dt>Parecido ajeno más alto</dt><dd>{dos(a.highestOther)}</dd></div>
                  <div><dt>Franja segura</dt><dd>{a.safeFrom === null ? '—' : a.safeTo === null ? 'No hay' : `${dos(a.safeFrom)} a ${dos(a.safeTo)}`}</dd></div>
                  <div><dt>Umbral de hoy</dt><dd>{dos(a.currentThreshold)}</dd></div>
                  <div><dt>Ventaja exigida sobre el segundo</dt><dd>{dos(a.currentMargin)}</dd></div>
                  <div><dt>Con el de hoy, socios no reconocidos</dt><dd>{a.currentFalseRejects}</dd></div>
                  <div><dt>Con el de hoy, confusiones</dt><dd>{a.currentFalseAccepts}</dd></div>
                  <div><dt>Socios sin la ventaja exigida</dt><dd>{a.currentMarginFailures}</dd></div>
                </dl>
                <p className="tiny muted">El umbral no se cambia desde aquí. Con la medición completa, pásale este resultado a quien instala GymFlow.</p>
              </div>
            )}
          </Card>

          {a && a.suggestedThreshold !== null && (
            <Card title="Qué pasaría con cada umbral" sub="Según lo medido hasta ahora: socios que no se reconocerían y personas que se confundirían con otra." pad={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Umbral</th><th className="right">No reconocidos</th><th className="right">Confusiones</th></tr></thead>
                  <tbody>
                    {a.table.map((f) => {
                      const hoy = Math.abs(f.threshold - a.currentThreshold) < 0.011;
                      const sugerido = !hoy && Math.abs(f.threshold - a.suggestedThreshold!) < 0.011;
                      // De cuatro en cuatro centésimas, más el de hoy y el que sale de lo medido: cabe sin desplazarse.
                      if (!hoy && !sugerido && (f.threshold < 0.26 || f.threshold > 0.7 || Math.round(f.threshold * 100) % 4 !== 2)) return null;
                      return (
                        <tr key={f.threshold} data-actual={hoy || undefined}>
                          <td className="num nowrap">{f.threshold.toFixed(2)} {hoy && <Badge>hoy</Badge>} {sugerido && <Badge tone="volt">medido</Badge>}</td>
                          <td className="right num">{f.falseRejects}</td>
                          <td className="right num">{f.falseAccepts}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={reiniciar} onClose={() => setReiniciar(false)} size="sm" title="Empezar la medición de nuevo"
        error={error}
        footer={<>
          <Button variant="secondary" onClick={() => setReiniciar(false)}>Cancelar</Button>
          <Button variant="danger" onClick={() => void descartar({ all: true })}>Borrar los intentos</Button>
        </>}>
        <p className="small">Se borran los {informe.datos?.attempts.length ?? 0} intentos medidos. No toca ningún rostro registrado ni ninguna entrada.</p>
      </Dialog>
    </>
  );
}

function Parecido({ valor, bien }: { valor: number | null; bien: (v: number) => boolean }) {
  if (valor === null) return <>—</>;
  return <span className={bien(valor) ? undefined : 'text-warn'}>{valor.toFixed(2)}</span>;
}

/** La cámara de la medición: el mismo gesto que en la Estación (movimiento pedido, tres segundos). */
function Medidor({ sede, sedes, onSede, onMedido }: {
  sede: string; sedes: Array<{ id: string; name: string }>; onSede: (id: string) => void; onMedido: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>('MEMBER');
  const [q, setQ] = useState('');
  const [socio, setSocio] = useState<SocioHallado | null>(null);
  const busqueda = useBuscarSocios(q, { activa: tipo === 'MEMBER' && !socio });
  const { video, estado } = useCamara(true);
  const [reto, setReto] = useState<Reto>(() => retoAlAzar());
  const [fase, setFase] = useState<'lista' | 'preparando' | 'leyendo' | 'procesando'>('lista');
  const [cuenta, setCuenta] = useState(3);
  const [ultimo, setUltimo] = useState<Medido | null>(null);
  const activa = useRef(true);
  useEffect(() => { activa.current = true; return () => { activa.current = false; }; }, []);

  const falta = tipo === 'MEMBER' && !socio;
  async function medir() {
    if (!video.current || estado !== 'vivo' || falta || fase !== 'lista') return;
    const r = retoAlAzar(); setReto(r); setUltimo(null); setFase('preparando');
    for (let n = 3; n > 0; n--) { setCuenta(n); await new Promise((ok) => setTimeout(ok, 1000)); if (!activa.current) return; }
    setFase('leyendo');
    const frames = await grabar(video.current, 10, 3000);
    setFase('procesando');
    let res: Medido;
    try {
      res = await api<Medido>('/access/face/measurements', {
        method: 'POST', body: JSON.stringify({ branchId: sede, frames, reto: r, kind: tipo, ...(tipo === 'MEMBER' ? { memberId: socio!.id } : {}) }),
      });
    } catch (e) {
      res = { ok: false, motivo: errorText(e, 'No se pudo medir') };
    }
    if (!activa.current) return;
    setFase('lista'); setUltimo(res);
    if (res.ok) { onMedido(); setSocio(null); setQ(''); }
  }

  return (
    <Card title="Un intento" sub="La persona se para frente a la cámara, como al entrar.">
      <div className="stack">
        <div className="row gap-10 wrap">
          <Segmented etiqueta="Quién está frente a la cámara" value={tipo} onChange={(v) => { setTipo(v); setUltimo(null); }}
            options={[{ value: 'MEMBER', label: 'Es socio (con rostro)' }, { value: 'STRANGER', label: 'No es socio' }]} />
          {sedes.length > 1 && (
            <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => onSede(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>

        {tipo === 'MEMBER' && (
          socio ? (
            <div className="bio-slot is-live">
              <span className="bio-slot-icon"><UserCheck /></span>
              <div className="flex-1 min-w-0"><span className="strong">{socio.firstName} {socio.lastName}</span><p className="tiny muted">{socio.memberCode}</p></div>
              <Button variant="ghost" size="sm" onClick={() => { setSocio(null); setQ(''); }}>Cambiar</Button>
            </div>
          ) : (
            <Field label="¿Qué socio es?" htmlFor="med-socio" hint="Tiene que tener su rostro registrado. Elige a quien de verdad está frente a la cámara: si eliges a otro, la medición sale mal.">
              <input id="med-socio" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o teléfono" autoComplete="off" />
              {busqueda.fallo && <p className="tiny text-warn">No se pudo buscar. <button type="button" className="row-link" onClick={busqueda.reintentar}>Reintentar</button></p>}
              {busqueda.hallados && (
                <div className="bio-hallados" data-espera={busqueda.enEspera || undefined}>
                  {busqueda.hallados.filter((s) => s.status !== 'ARCHIVED').map((s) => (
                    <button key={s.id} type="button" className="bio-hallado" onClick={() => setSocio(s)}>
                      <span className="strong">{s.firstName} {s.lastName}</span><span className="tiny muted">{s.memberCode}</span>
                    </button>
                  ))}
                  {busqueda.hallados.length === 0 && !busqueda.enEspera && <p className="tiny muted">Nadie coincide.</p>}
                </div>
              )}
            </Field>
          )
        )}
        {tipo === 'STRANGER' && <p className="small muted">Alguien que NO es socio (personal, un acompañante). Pídele permiso antes: su imagen no se guarda, solo el número de cuánto se pareció a alguien.</p>}

        <div className="capture" data-testid="medicion-camara">
          <video ref={video} muted playsInline />
          {estado === 'sin-camara' && <div className="stack-sm items-center capture-sin"><Camera size={28} /><span className="small">No hay cámara disponible en este equipo. Revisa que el navegador tenga permiso de usarla.</span></div>}
          <div className="capture-guide" />
          {fase === 'preparando' && <span className="capture-cuenta" aria-hidden>{cuenta}</span>}
          <div className="capture-hint" aria-live="polite">
            {fase === 'preparando' ? `Prepárate: ${TEXTO_RETO[reto].toLowerCase()}` : fase === 'leyendo' ? TEXTO_RETO[reto] : fase === 'procesando' ? 'Un momento…' : estado === 'vivo' ? 'Rostro dentro del óvalo' : ''}
          </div>
        </div>
        <div className="capture-acciones">
          <Button variant="volt" size="lg" icon={<ScanFace />} loading={fase !== 'lista'} disabled={estado !== 'vivo' || falta} onClick={() => void medir()} data-testid="medicion-medir">
            {fase === 'lista' ? 'Medir' : fase === 'preparando' ? `Empieza en ${cuenta}…` : fase === 'leyendo' ? 'Leyendo…' : 'Comparando…'}
          </Button>
        </div>
        {falta && <p className="tiny muted text-center">Elige primero al socio.</p>}

        {ultimo && (
          <div data-testid="medicion-ultimo">
            {ultimo.ok
              ? <Callout tone="ok" title="Intento guardado">
                  {ultimo.attempt.kind === 'MEMBER'
                    ? <>Se pareció <strong>{dos(ultimo.attempt.ownScore)}</strong> a su propio rostro y <strong>{dos(ultimo.attempt.bestOtherScore)}</strong> al de la persona más parecida.</>
                    : <>Se pareció <strong>{dos(ultimo.attempt.bestOtherScore)}</strong> al socio más parecido.</>}
                </Callout>
              : <Callout tone="warn" title="No contó como intento">{ultimo.motivo}</Callout>}
          </div>
        )}
      </div>
    </Card>
  );
}
