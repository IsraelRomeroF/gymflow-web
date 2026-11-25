'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ScanFace, ShieldCheck, ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Callout, irAlPrimerError } from '@/components/ui';
import { Marca } from '@gymflow/ui/compartido';
import { erroresPorCampo } from '@/components/session';
import { TEMPORAL_DIAS } from '@/lib/entrega-temporal';
import { AVISO_DE_SALIDA, destinoTrasEntrar, esMotivoDeSalida, leerSalida, recordarFin } from '@/lib/sesion';

type LoginResponse = { status: 'AUTHENTICATED'; platform?: boolean; mustChangePassword?: boolean; secondsLeft?: number };

/** El aviso de arriba del formulario: por qué se volvió aquí (24-06, 24-07, 24-13) o que se salió bien (24-15). */
type Aviso = { tono: 'info' | 'warn' | 'danger' | 'ok'; titulo: string; texto?: string };

/** Contacto de soporte de GymFlow, si el despliegue lo configura (DP-02). */
const SOPORTE = process.env.NEXT_PUBLIC_SOPORTE ?? '';

/** La misma regla de la API para todos, personal y plataforma (24-10). */
const MINIMO = 12;

/** Quien entró con una contraseña temporal: solo le sirve para elegir la suya (A4-N1). */
type Temporal = { correo: string; clave: string; plataforma: boolean };

/** «1:52»: lo que falta para volver a intentar, en minutos y segundos. */
function reloj(segundos: number): string {
  const s = Math.max(0, Math.ceil(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Cuenta regresiva del 429 (24-02): la API dice cuántos segundos esperar
 * (`retryAfterSeconds`). Mientras corre, «Entrar» espera; al terminar, se
 * puede volver a intentar sin recargar.
 */
function useEspera(): { restantes: number; esperar: (segundos: number) => void } {
  const [hasta, setHasta] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (hasta === null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (n >= hasta) { setHasta(null); clearInterval(t); }
    }, 1000);
    return () => clearInterval(t);
  }, [hasta]);
  return {
    restantes: hasta === null ? 0 : Math.max(0, Math.ceil((hasta - ahora) / 1000)),
    esperar: (segundos) => { const n = Date.now(); setAhora(n); setHasta(n + segundos * 1000); },
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Por qué volvió aquí (`?motivo=`) y a qué pantalla regresa al entrar (`?volver=`, 24-08):
  // la firma que llegó al teléfono vence en minutos y no se puede perder buscándola.
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [volver, setVolver] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setVolver(q.get('volver'));
    const motivo = q.get('motivo');
    const salida = leerSalida();
    // «Cambiar de usuario» del mostrador (24-09; bloque 4.11): la sesión anterior ya se cerró y el correo queda listo para quien sigue.
    if (q.get('relevo') === '1') {
      setAviso({ tono: 'ok', titulo: 'Sesión cerrada. Entra con tu cuenta', texto: 'Lo que hagas queda a tu nombre. Si hay una caja abierta, sigue abierta a nombre de quien la abrió.' });
      document.getElementById('email')?.focus();
    } else if (esMotivoDeSalida(motivo)) setAviso(AVISO_DE_SALIDA[motivo]);
    else if (salida) setAviso({ tono: 'ok', titulo: 'Saliste de GymFlow en este equipo', ...(salida.avisos ? { texto: 'Este equipo ya no recibe tus avisos.' } : {}) });
  }, []);
  const [busy, setBusy] = useState(false);
  const [temporal, setTemporal] = useState<Temporal | null>(null);
  const espera = useEspera();
  const esperando = espera.restantes > 0;
  // El último error fue un 429: al terminar la cuenta, se dice que ya se puede.
  const [porLimite, setPorLimite] = useState(false);

  async function entrar(correo: string, clave: string) {
    if (esperando) return;
    setBusy(true);
    setError(null);
    setPorLimite(false);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: correo, password: clave }),
      });
      // Cuánto dura esta sesión, para que el panel avise antes del cierre y el login diga «terminó» (24-04).
      if (typeof res.secondsLeft === 'number') recordarFin(res.secondsLeft);
      // Con la temporal no se opera nada: se elige la propia aquí mismo, sin
      // pasar por el panel (A4-N1).
      if (res.mustChangePassword) {
        setTemporal({ correo, clave, plataforma: !!res.platform });
        setPassword('');
        return;
      }
      // A la pantalla donde estaba; si no, la cuenta de plataforma va a Marcas y el personal a su inicio.
      router.push(destinoTrasEntrar(volver, !!res.platform));
    } catch (err) {
      // Mensaje genérico a propósito: no se revela si el correo existe.
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión');
      // Demasiados intentos: la API dice cuánto falta y aquí se cuenta hacia atrás.
      const segundos = err instanceof ApiError && err.status === 429 ? Number(err.data?.retryAfterSeconds) : NaN;
      if (Number.isFinite(segundos) && segundos > 0) { espera.esperar(segundos); setPorLimite(true); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-art">
        <div className="row">
          <span className="brand-mark"><Marca size={18} /></span>
          <span className="brand-name">GymFlow</span>
        </div>

        <div>
          <h1 className="auth-quote">Todas tus sucursales, <em>una sola</em> operación.</h1>
          <div className="auth-points">
            <div className="auth-point"><Building2 /><span>Cartera, caja y socios consolidados entre sedes, con cada peso conciliado.</span></div>
            <div className="auth-point"><ScanFace /><span>Entrada con el rostro en la cámara de recepción. La foto no se guarda: solo una plantilla cifrada en el servidor del gimnasio.</span></div>
            <div className="auth-point"><ShieldCheck /><span>Cada excepción queda registrada con nombre, motivo y hora.</span></div>
          </div>
        </div>

        <p className="tiny" style={{ color: '#8b929c' }}>© {new Date().getFullYear()} GymFlow · Hecho en México</p>
      </section>

      <section className="auth-form">
        <div className="auth-card">
          {temporal ? (
            <ElegirContrasena temporal={temporal}
              onListo={() => router.push(destinoTrasEntrar(volver, temporal.plataforma))}
              onSalir={() => { setTemporal(null); setAviso(null); }} />
          ) : (
            <>
              <h2 className="auth-titulo">Entra a GymFlow</h2>
              {/* El aviso va ARRIBA del formulario: es lo primero que hay que leer (24-06). */}
              {aviso && !error && (
                <div className="mt-16 mb-12" data-testid="aviso-entrar">
                  <Callout tone={aviso.tono} title={aviso.titulo}>{aviso.texto ? <p>{aviso.texto}</p> : null}</Callout>
                </div>
              )}
              <p className="muted mt-6 mb-28">
                Con el correo y la contraseña que te dieron. Si es tu primera vez, usa la temporal: al entrar eliges la tuya.
              </p>

              <form onSubmit={(e) => { e.preventDefault(); void entrar(email, password); }}>
                <Field label="Correo" htmlFor="email">
                  <input id="email" className="input input-lg" type="email" autoComplete="username" required
                    placeholder="tu@gimnasio.mx" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Contraseña" htmlFor="password">
                  <input id="password" className="input input-lg" type="password" autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button type="submit" size="lg" block loading={busy} disabled={esperando} style={{ marginTop: 20 }}>
                  {esperando ? <>Espera {reloj(espera.restantes)}</> : <>Entrar <ArrowRight /></>}
                </Button>
                {/* Sin correo de recuperación: la temporal la da la gerencia (UX5-PL-04). */}
                <p className="small muted mt-16 text-center">
                  ¿Olvidaste tu contraseña? Pídele a tu gerente una temporal desde Personal; si eres el gerente, al dueño.
                  {SOPORTE && <><br />¿Nadie puede ayudarte? GymFlow: {SOPORTE}</>}
                </p>
              </form>

              {error && (
                <div className="mt-16" data-testid="error-entrar">
                  <Callout tone="danger">
                    {error}
                    {porLimite && (
                      <span className="block mt-6" aria-live="polite">
                        {esperando ? <>Puedes volver a intentar en <strong className="num">{reloj(espera.restantes)}</strong>.</> : 'Ya puedes volver a intentar.'}
                      </span>
                    )}
                  </Callout>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * PRIMER INGRESO (24-10, A4-N1). La temporal solo sirve para elegir la propia:
 * dos campos, sin volver a pedir la temporal que se acaba de escribir, y la
 * misma regla de 12 caracteres para todos. Lo que falta se dice en su campo.
 */
function ElegirContrasena({ temporal, onListo, onSalir }: { temporal: Temporal; onListo: () => void; onSalir: () => void }) {
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [delServidor, setDelServidor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const errores: Record<string, string> = {
    ...(nueva.length < MINIMO ? { nueva: `Mínimo ${MINIMO} caracteres.` }
      : nueva === temporal.clave ? { nueva: 'Tiene que ser distinta de la temporal.' } : {}),
    ...(repetir !== nueva ? { repetir: 'No coincide con la nueva.' } : {}),
  };
  const err = (k: string) => (intentado ? errores[k] ?? null : null);

  async function guardar() {
    setIntentado(true);
    setDelServidor(null);
    setError(null);
    if (Object.keys(errores).length > 0) { irAlPrimerError(); return; }
    setEnviando(true);
    try {
      await api(temporal.plataforma ? '/platform/password' : '/auth/password', { method: 'POST', body: JSON.stringify({ next: nueva }) });
      onListo();
    } catch (x) {
      const enCampo = erroresPorCampo(x).next;
      if (enCampo) setDelServidor(enCampo);
      else setError(x instanceof ApiError ? x.message : 'No se pudo guardar. Vuelve a intentar.');
    } finally {
      setEnviando(false);
    }
  }

  async function salir() {
    await api(temporal.plataforma ? '/platform/logout' : '/auth/logout', { method: 'POST' }).catch(() => undefined);
    onSalir();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void guardar(); }} data-testid="elegir-contrasena">
      <p className="eyebrow">Primer ingreso</p>
      <h2 className="auth-titulo mt-4">Elige tu propia contraseña</h2>
      <p className="muted mt-6 mb-20">
        Entraste con una contraseña temporal: solo sirve para elegir la tuya y vence a los {TEMPORAL_DIAS} días de que te la dieron.
        Hasta que la cambies no puedes operar ni autorizar.
      </p>
      {error && <div className="mb-16"><Callout tone="danger">{error}</Callout></div>}
      {/* Para que el navegador guarde la nueva con su correo. */}
      <input className="sr-only" type="email" name="username" autoComplete="username" value={temporal.correo} readOnly tabIndex={-1} aria-hidden />
      <Field label="Nueva contraseña" htmlFor="nueva" required error={err('nueva') ?? delServidor}
        hint={`${nueva.length} de ${MINIMO} caracteres mínimo${nueva.length >= MINIMO ? ' ✓' : ''}`}>
        <input id="nueva" className="input input-lg" type="password" autoComplete="new-password" autoFocus
          value={nueva} onChange={(e) => { setNueva(e.target.value); setDelServidor(null); }} />
      </Field>
      <Field label="Repítela" htmlFor="repetir" required error={err('repetir')}>
        <input id="repetir" className="input input-lg" type="password" autoComplete="new-password"
          value={repetir} onChange={(e) => setRepetir(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" block loading={enviando} className="mt-20">
        Guardar y entrar <ArrowRight />
      </Button>
      <p className="small muted mt-16 text-center">
        Las demás sesiones de tu cuenta se cierran al guardarla.{' '}
        <Button type="button" variant="ghost" size="sm" onClick={() => void salir()}>Salir sin cambiarla</Button>
      </p>
    </form>
  );
}
