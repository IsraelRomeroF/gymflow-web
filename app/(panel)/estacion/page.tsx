'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ScanFace, CircleCheck, CircleX, UserX, Maximize2 } from 'lucide-react';
import { api } from '@/lib/api';
import { DENIAL_REASON } from '@/lib/labels';
import { useSession } from '@/components/session';
import { Callout, PageHeader, Skeleton } from '@/components/ui';
import { comprobarCamara, grabar, retoAlAzar, TEXTO_RETO, useCamara, type Reto } from '@/components/camara-rostro';
import type { FaceAccessResult } from '@gymflow/core/contracts';

/** Lo que responde `POST /access/face`: contrato del núcleo (5-21). */
type Respuesta = FaceAccessResult;

/**
 * ESTACIÓN DE ACCESO (2026-10-09): la PC de recepción con su cámara hace de
 * lector facial, como las estaciones de HRFlow. El socio se para frente a la
 * cámara, hace el movimiento que se le pide (prueba de vida) y la estación
 * aplica la misma regla de la puerta: membresía, horario, adeudo. Cada paso
 * queda en el historial de accesos del socio, con el parecido y la prueba de
 * vida como evidencia.
 */
export default function EstacionPage() {
  const { branches, inScope, activoEn } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id) && activoEn('biometrics', b.id));
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const [motor, setMotor] = useState<{ disponible: boolean; motivo: string | null } | null>(null);
  useEffect(() => { api<{ disponible: boolean; motivo: string | null }>('/access/face/status').then(setMotor).catch(() => setMotor({ disponible: false, motivo: null })); }, []);
  const { video, estado } = useCamara(!!motor?.disponible);
  // Por qué no hay cámara, en palabras de mostrador (6-02): sin https el navegador no la presta.
  const [sinCamara, setSinCamara] = useState<string | null>(null);
  useEffect(() => {
    if (estado !== 'sin-camara') return;
    let vigente = true;
    void comprobarCamara().then((c) => { if (vigente) setSinCamara(c.ok ? null : c.motivo); });
    return () => { vigente = false; };
  }, [estado]);
  const [reto, setReto] = useState<Reto>(() => retoAlAzar());
  const [fase, setFase] = useState<'esperando' | 'preparando' | 'leyendo' | 'procesando'>('esperando');
  const [cuenta, setCuenta] = useState(3);
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const activa = useRef(true);
  const marco = useRef<HTMLDivElement>(null);

  // UNA lectura por pulsación de "Ingresar" (2026-10-09, como en HRFlow): el
  // socio decide cuándo está listo. Cuenta de 3 para prepararse, 3 segundos
  // grabando el movimiento y el resultado, que SIEMPRE se dice.
  const ocupado = fase !== 'esperando' || !!resultado;
  const ingresar = useCallback(async () => {
    if (ocupado || !video.current || !sede || estado !== 'vivo') return;
    const r = retoAlAzar(); setReto(r); setFase('preparando');
    for (let n = 3; n > 0; n--) { setCuenta(n); await new Promise((ok) => setTimeout(ok, 1000)); if (!activa.current) return; }
    setFase('leyendo');
    const frames = await grabar(video.current, 10, 3000);
    setFase('procesando');
    let res: Respuesta;
    try {
      res = await api<Respuesta>('/access/face', { method: 'POST', body: JSON.stringify({ branchId: sede, frames, reto: r }) });
    } catch (e) {
      res = { reconocido: false, motivo: e instanceof Error ? e.message : 'Sin conexión con el servidor', sinRostro: false };
    }
    setFase('esperando');
    setResultado(res);
    setTimeout(() => { if (activa.current) setResultado(null); }, res.reconocido && res.outcome === 'GRANTED' ? 4000 : 6000);
  }, [ocupado, sede, estado, video]);

  useEffect(() => { activa.current = true; return () => { activa.current = false; }; }, []);
  // En el mostrador, Enter o espacio también ingresan (un teclado o un botón físico).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); void ingresar(); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ingresar]);

  if (sedes.length === 0) return <Callout tone="info" title="Ninguna sucursal usa biometría">Enciende Biometría en Módulos para usar la cámara como lector.</Callout>;
  return (
    <div className="stack">
      <PageHeader title="Estación de acceso" sub="El socio se para frente a la cámara y hace el movimiento que se le pide. La puerta decide igual que siempre: membresía, horario y adeudo."
        actions={<div className="row gap-8">
          {sedes.length > 1 && (
            <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => void marco.current?.requestFullscreen?.()}><Maximize2 />Pantalla completa</button>
        </div>} />
      {motor === null ? <Skeleton h={420} r={16} /> : !motor.disponible ? (
        <Callout tone="warn" title="El motor facial no está disponible">{motor.motivo ?? 'No responde.'} Mientras tanto, registra las entradas desde Socios y avisa a la gerencia.</Callout>
      ) : (
        <div className="estacion" ref={marco} data-testid="estacion">
          {/* La cámara queda libre: la leyenda y el botón van en la barra de abajo, sin tapar el óvalo. */}
          <div className="estacion-camara">
            <video ref={video} muted playsInline className="estacion-video" />
            {estado === 'sin-camara' && <div className="estacion-aviso"><ScanFace size={40} /><p>{sinCamara ?? 'No hay cámara disponible en este equipo. Revisa que el navegador tenga permiso de usarla.'}</p></div>}
            {estado === 'vivo' && !resultado && (
              <div className="estacion-guia">
                <div className="estacion-ovalo" data-leyendo={fase === 'leyendo' || undefined} />
                {fase === 'preparando' && <span className="estacion-cuenta" aria-hidden>{cuenta}</span>}
              </div>
            )}
          </div>
          {estado === 'vivo' && !resultado && (
            <div className="estacion-pie">
              <p className="estacion-instruccion" aria-live="polite">{fase === 'preparando' ? `Prepárate: ${TEXTO_RETO[reto].toLowerCase()}` : fase === 'leyendo' ? TEXTO_RETO[reto] : fase === 'procesando' ? 'Un momento…' : 'Coloca tu rostro dentro del óvalo y pulsa Ingresar'}</p>
              {fase === 'esperando' && <button type="button" className="estacion-ingresar" onClick={() => void ingresar()} data-testid="estacion-ingresar"><ScanFace />Ingresar</button>}
            </div>
          )}
          {resultado && <Resultado r={resultado} onOtraVez={() => setResultado(null)} />}
        </div>
      )}
      <p className="small muted">Cada paso queda en el historial de accesos del socio. ¿Alguien sin su rostro registrado, o a quien ya no reconoce? Regístralo o actualízalo desde su ficha, en Biometría, o registra su entrada desde <Link href="/socios" className="row-link">Socios</Link>: con rostro entra por excepción con motivo; sin rostro, según la regla del gimnasio, puede necesitar la autorización de la gerencia.</p>
    </div>
  );
}

function Resultado({ r, onOtraVez }: { r: Respuesta; onOtraVez: () => void }) {
  if (!r.reconocido) {
    // Lo que falló se dice (no se reintenta en silencio): sin rostro, sin giro o sin parecido.
    return (
      <div className="estacion-resultado" data-tono="neutro" role="status" data-testid="estacion-resultado">
        <UserX size={56} />
        <p className="estacion-titulo">{r.sinRostro ? 'No vi tu rostro' : r.motivo}</p>
        <p className="estacion-detalle">{r.sinRostro ? 'Colócate dentro del óvalo, con buena luz y sin gorra ni lentes oscuros.' : 'Inténtalo de nuevo; si no te reconoce, pasa con recepción.'}</p>
        <button type="button" className="estacion-ingresar" onClick={onOtraVez}>Intentar de nuevo</button>
      </div>
    );
  }
  const ok = r.outcome === 'GRANTED';
  return (
    <div className="estacion-resultado" data-tono={ok ? 'ok' : 'no'} role="status" data-testid="estacion-resultado">
      {ok ? <CircleCheck size={64} /> : <CircleX size={64} />}
      <p className="estacion-titulo">{ok ? `Bienvenido, ${r.memberName.split(' ')[0]}` : `${r.memberName.split(' ')[0]}, pasa con recepción`}</p>
      {/* Nunca un importe (5-14): la pantalla la ve la fila. Cuánto debe se dice en el mostrador. */}
      <p className="estacion-detalle">
        {ok ? (r.consumedVisit ? 'Se descontó una visita de tu paquete.' : r.reentry ? 'Ya habías entrado hoy: no cuenta otra visita.' : r.warning ? (DENIAL_REASON[r.warning] ?? '') : '')
          : r.reason ? DENIAL_REASON[r.reason] ?? r.reason : 'No puede pasar'}
      </p>
      {/* El texto biométrico cambió y no lo ha vuelto a firmar: se le avisa; no cambia si entra. */}
      {r.debeVolverAFirmar && <p className="estacion-detalle" data-testid="estacion-volver-a-firmar">Antes de irte pasa a recepción: hay que volver a firmar tu permiso para entrar con el rostro.</p>}
    </div>
  );
}
