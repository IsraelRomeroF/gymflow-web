'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Smartphone } from 'lucide-react';
import type { ApprovalApprovers } from '@gymflow/core/contracts';
import { api, ApiError } from '@/lib/api';
import { hora, pesos } from '@/lib/format';
import { errorText } from './session';
import { Button, Callout, Dialog, ErrorCarga, Field, Segmented } from './ui';
import { useCarga } from '@/lib/carga';
import { Desenlace, avisoDeAlcance, type Firmante, type Solicitud } from './firma/desenlace';
import { atenderEspera, esperaParaRetomar, ponerEspera, quitarEspera, soltarEspera } from './firma/espera';

/** De qué registro se trata lo que se firma (29-01). Mismos valores que `APPROVAL_RESOURCE_TYPES` del núcleo. */
export type TipoDeRegistro = 'CashSession' | 'Payment' | 'Charge' | 'Membership' | 'Member' | 'VisitPack' | 'MonthlyClose';

/**
 * Lo que se autoriza: la firma solo vale para esto y hasta este importe.
 * `resourceType` dice de qué registro se trata (29-01): la dueña lo ve leído
 * de la base («Pago de Ana López · folio 341»), no del texto de quien pide.
 * Si una pantalla no lo manda se deduce del permiso, aquí y en el servidor;
 * la condonación puede ser de un cargo o de una membresía y conviene mandarlo.
 */
export type Operacion = { resourceType?: TipoDeRegistro; resourceId?: string; amountCents?: string | bigint | null };

/** El registro de cada operación que tiene uno solo posible (igual que `APPROVAL_RESOURCES_BY_PERMISSION` del núcleo). */
const TIPO_POR_PERMISO: Record<string, TipoDeRegistro> = {
  'cash:withdraw': 'CashSession', 'payments:reverse': 'Payment', 'payments:refund': 'Payment',
  'billing:charge:void': 'Charge', 'billing:discount:apply': 'Charge', 'members:anonymize': 'Member',
  'members:balance:adjust': 'Member', 'memberships:visitpack:adjust': 'VisitPack', 'reports:month:close': 'MonthlyClose',
};

/**
 * El cierre de un mes no es un registro hasta que se cierra: su firma se ata
 * al MES con un id fijo, el mismo que calcula el servidor
 * (`monthlyCloseResourceId` del núcleo). La de octubre no cierra septiembre.
 */
export function idDeCierreDeMes(mes: string): string {
  return `00000000-0000-8000-8000-000000${mes.replace('-', '')}`;
}

/** Los cinco desenlaces de una solicitud (`ApprovalRequestStatus` del núcleo). */
const ESTADOS = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED'] as const;
type SolicitudCruda = Omit<Solicitud, 'status'> & { status: string };

/** Un estado que esta pantalla no sabe pintar no se disfraza de otro: se dice. */
function leer(s: SolicitudCruda): Solicitud | null {
  return (ESTADOS as readonly string[]).includes(s.status) ? (s as Solicitud) : null;
}

/**
 * El error de una firma: el mensaje y, si el servidor explica más —la pausa
 * por intentos fallidos y a qué hora termina (24-11)—, también eso. El 403
 * genérico («Operación no permitida») se cambia por su explicación.
 */
export function textoDeErrorDeFirma(e: unknown, respaldo: string): string {
  const msg = errorText(e, respaldo);
  const detalle = e instanceof ApiError && e.data?.detail ? String(e.data.detail) : null;
  if (!detalle) return msg;
  return e instanceof ApiError && e.status === 403 ? detalle : `${msg.replace(/\.$/, '')}. ${detalle}`;
}

const pausaVigente = (f: Pick<Firmante, 'pausedUntil'>) => !!f.pausedUntil && Date.parse(f.pausedUntil) > Date.now();

/** Cuánto se deja a la vista «Listo» en la franja después de que la operación siguió sola. */
const LISTO_A_LA_VISTA_MS = 8000;

/**
 * AUTORIZACIÓN DE UN SEGUNDO USUARIO (maker-checker).
 *
 * Quien autoriza se acerca y teclea SU contraseña en este mismo equipo. Si
 * solo una persona puede firmar, ya está elegida (20-14): no se teclea su
 * correo con fila en el mostrador. El servidor devuelve un token de un solo
 * uso atado a ESTA operación y a su importe (SEC2-05), que la pantalla manda
 * en `approvalToken`.
 *
 * También a distancia: la solicitud le llega a quien puede firmar en su
 * panel (Autorizaciones), la aprueba desde su teléfono y esta pantalla sigue
 * sola al recibir la firma. El desenlace lo decide el servidor, no el reloj
 * de esta PC (29-06), y la firma llega aunque se pierda una respuesta (29-03).
 * Mientras espera, el mostrador puede «Seguir atendiendo» (D29-03): el
 * diálogo se guarda en una franja del panel y la operación sigue sola cuando
 * llega la firma. Antes de pedir y al vencer, dice si quien firma tiene cómo
 * enterarse (29-05), y «Volver a pedir» reenvía en un toque (29-08).
 *
 * Desde que se abre dice quién puede firmar; si nadie puede, lo dice y no
 * deja llenar nada (UXB-04). Si las firmas de alguien están en pausa por
 * intentos fallidos con su contraseña (24-11), también lo dice.
 */
export function AutorizacionDialog({ permission, branchId, operacion, titulo, detalle, motivo, onClose, onAutorizado }: {
  permission: string; branchId: string | null; operacion: Operacion; titulo: string; detalle?: React.ReactNode;
  /** El motivo que escribió quien pide: quien firma a distancia lo lee (UXG-05). */
  motivo?: string;
  onClose: () => void; onAutorizado: (token: string, quien: string) => void;
}) {
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Quién firma aquí: alguien de «Pueden autorizar» (por su id) u «otra persona», por correo.
  const [elegido, setElegido] = useState<string | null>(null);
  const [otra, setOtra] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const monto = operacion.amountCents != null ? operacion.amountCents.toString() : null;
  const tipo = operacion.resourceType ?? TIPO_POR_PERMISO[permission];
  // La operación exacta: solo un diálogo para ESTO retoma una solicitud que quedó esperando en la franja.
  const clave = [permission, tipo ?? '', operacion.resourceId ?? '', monto ?? '', branchId ?? ''].join('|');
  // Qué se autoriza, sin el verbo: el título de un «no» no anuncia una acción que no va a pasar (29-07).
  const resumen = titulo.replace(/^Autorizar /, '').replace(/^./, (c) => c.toUpperCase());
  const tituloDelResultado = monto ? `${resumen} · ${pesos(monto)}` : resumen;
  // "Aquí": quien autoriza teclea en este equipo. "A distancia": la recibe
  // en su teléfono y la aprueba ahí, sin venir al mostrador.
  const [modo, setModo] = useState<'aqui' | 'distancia'>('aqui');
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  /** «Seguir atendiendo»: el diálogo se guarda y la franja del panel lo representa. */
  const [minimizada, setMinimizada] = useState(false);
  // Hasta cuándo vale la solicitud, en el reloj de ESTA PC pero contado con el
  // del servidor: lo que le quedaba según la API, sumado a «ahora» (29-06).
  const [limite, setLimite] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const listo = useRef(false);
  const guardada = useRef(false);
  guardada.current = minimizada;
  // `onAutorizado` llega como flecha nueva en cada render: si fuera dependencia
  // del sondeo, el tic de cada segundo lo reiniciaría antes de consultar.
  const alAutorizar = useRef(onAutorizado);
  alAutorizar.current = onAutorizado;

  // Quién puede firmar. Si no responde, se dice (26-01): callar escondía «Pedir a su teléfono».
  const cargarFirmantes = useCallback(() => {
    const qs = new URLSearchParams({ permission, ...(branchId ? { branchId } : {}), ...(monto ? { amountCents: monto } : {}) });
    return api<ApprovalApprovers>(`/approvals/approvers?${qs}`);
  }, [permission, branchId, monto]);
  const firmantesCarga = useCarga(cargarFirmantes);
  const firmantes = firmantesCarga.datos ?? null;
  const lista = firmantes?.approvers ?? [];
  const quienes = lista.map((a) => a.fullName).join(', ');

  /**
   * Llegó la firma: la operación sigue sola. Si el diálogo estaba guardado, la
   * franja dice «Listo» unos segundos; si no, la espera simplemente termina.
   */
  const entregar = useCallback((s: Solicitud, token: string) => {
    listo.current = true;
    if (guardada.current) {
      ponerEspera({ id: s.id, estado: 'LISTA', solicitud: s, minimizada: true });
      setTimeout(() => quitarEspera(s.id), LISTO_A_LA_VISTA_MS);
    } else quitarEspera(s.id);
    alAutorizar.current(token, s.approverName ?? 'quien autorizó');
  }, []);

  /** Lo que dijo el servidor de la solicitud: con la firma, se entrega; sin ella, se pinta. */
  const recibir = useCallback((cruda: SolicitudCruda) => {
    const s = leer(cruda);
    if (!s) { setError('La solicitud cambió a un estado que esta pantalla no conoce. Recarga la página.'); return; }
    if (s.status === 'APPROVED' && s.approvalToken) {
      if (!listo.current) entregar(s, s.approvalToken);
      return;
    }
    if (s.status === 'PENDING') { setLimite(Date.now() + s.secondsLeft * 1000); setAhora(Date.now()); }
    setSolicitud(s);
  }, [entregar]);

  // Una solicitud viva para ESTA misma operación que quedó en la franja (la
  // persona cambió de pantalla y volvió): se retoma en vez de pedir otra.
  useEffect(() => {
    const previa = esperaParaRetomar(clave);
    if (!previa) return;
    let vigente = true;
    api<SolicitudCruda>(`/approvals/requests/${previa.id}`)
      .then((cruda) => { if (vigente) { setModo('distancia'); recibir(cruda); } })
      .catch(() => quitarEspera(previa.id));
    return () => { vigente = false; };
  }, [clave, recibir]);

  // Lo que la franja del panel sabe de esta espera.
  useEffect(() => {
    if (!solicitud || listo.current) return;
    ponerEspera({
      id: solicitud.id, clave, titulo: tituloDelResultado, quienes, ruta: pathname, estado: solicitud.status,
      limite: solicitud.status === 'PENDING' ? limite : null, solicitud, atendida: true, minimizada,
    });
  }, [solicitud, limite, minimizada, clave, tituloDelResultado, quienes, pathname]);
  const idSolicitud = solicitud?.id ?? null;
  useEffect(() => {
    if (!idSolicitud) return;
    atenderEspera(idSolicitud, () => setMinimizada(false));
    // Al dejar la pantalla con la solicitud viva, la franja se hace cargo.
    return () => soltarEspera(idSolicitud);
  }, [idSolicitud]);

  const idPendiente = solicitud?.status === 'PENDING' ? solicitud.id : null;
  useEffect(() => {
    if (!idPendiente) return;
    const tic = setInterval(() => setAhora(Date.now()), 1000);
    const sondeo = setInterval(() => {
      api<SolicitudCruda>(`/approvals/requests/${idPendiente}`).then(recibir).catch(() => undefined);
    }, 2500);
    return () => { clearInterval(tic); clearInterval(sondeo); };
  }, [idPendiente, recibir]);

  async function pedir() {
    setEnviando(true); setError(null);
    try {
      const cruda = await api<SolicitudCruda>('/approvals/requests', {
        method: 'POST',
        body: JSON.stringify({
          permission, ...(tipo ? { resourceType: tipo } : {}), ...(operacion.resourceId ? { resourceId: operacion.resourceId } : {}),
          summary: resumen,
          ...(monto ? { amountCents: monto } : {}), ...(branchId ? { branchId } : {}),
          ...(motivo?.trim() ? { reason: motivo.trim().slice(0, 300) } : {}),
        }),
      });
      const s = leer(cruda);
      if (!s) throw new Error('El servidor respondió algo que esta pantalla no conoce. Recarga la página.');
      listo.current = false;
      // Lo que le quedaba al nacer, medido con el reloj del servidor.
      setLimite(Date.now() + s.secondsLeft * 1000); setAhora(Date.now());
      setSolicitud(s);
    } catch (e) { setError(errorText(e, 'No se pudo enviar la solicitud')); } finally { setEnviando(false); }
  }

  /** «Cerrar» y «Volver a pedir» cancelan la anterior si seguía pendiente (29-06): nunca quedan dos vivas para lo mismo. */
  async function soltarLaAnterior() {
    if (!solicitud) return;
    if (solicitud.status === 'PENDING') await api(`/approvals/requests/${solicitud.id}/cancel`, { method: 'POST', body: '{}' }).catch(() => undefined);
    quitarEspera(solicitud.id);
  }
  async function cerrar() { await soltarLaAnterior(); onClose(); }
  /** Reenvía en un toque (29-08): cancela la anterior y manda otra con lo mismo, sin volver al formulario. */
  async function volverAPedir() {
    await soltarLaAnterior();
    await pedir();
  }
  /** Tras vencer, quien firma está en el gimnasio: se pasa al formulario de la contraseña. */
  async function queFirmeAqui() {
    await soltarLaAnterior();
    listo.current = false;
    setSolicitud(null); setLimite(null); setError(null); setModo('aqui');
  }

  const nadie = firmantes !== null && lista.length === 0;
  // Con una sola persona que puede firmar, ya está elegida (20-14).
  const firmaDe = otra ? null : lista.find((a) => a.userId === elegido) ?? (lista.length > 0 ? lista[0]! : null);

  async function autorizar() {
    setEnviando(true); setError(null);
    try {
      const r = await api<{ approvalToken: string; approverName: string }>('/approvals', {
        method: 'POST',
        body: JSON.stringify({
          ...(firmaDe ? { approverUserId: firmaDe.userId } : { email: email.trim() }), password, permission,
          ...(tipo ? { resourceType: tipo } : {}),
          ...(operacion.resourceId ? { resourceId: operacion.resourceId } : {}),
          ...(monto ? { amountCents: monto } : {}),
          ...(branchId ? { branchId } : {}),
        }),
      });
      setPassword('');
      onAutorizado(r.approvalToken, r.approverName);
    } catch (e) {
      setError(textoDeErrorDeFirma(e, 'No se pudo autorizar'));
    } finally { setEnviando(false); }
  }

  const pausados = lista.filter(pausaVigente);
  const todosEnPausa = lista.length > 0 && pausados.length === lista.length;
  const minutosSolicitud = Math.round((firmantes?.requestTtlSeconds ?? 600) / 60);
  const minutosFirma = Math.round((firmantes?.grantTtlSeconds ?? 300) / 60);
  const restan = limite === null ? null : Math.max(0, Math.round((limite - ahora) / 1000));

  // Guardado en la franja: el mostrador sigue atendiendo y este componente
  // sigue consultando para que la operación continúe sola.
  if (solicitud && minimizada) return null;

  if (solicitud) {
    const s = solicitud.status;
    return (
      <Dialog open onClose={() => void cerrar()} title={s === 'PENDING' ? titulo : tituloDelResultado} error={error}
        footer={s === 'PENDING' ? (
          <>
            <Button variant="secondary" onClick={() => void cerrar()}>Cancelar solicitud</Button>
            <Button variant="secondary" onClick={() => setMinimizada(true)}>Seguir atendiendo</Button>
          </>
        ) : s === 'REJECTED' ? (
          <>
            <Button variant="secondary" loading={enviando} onClick={() => void volverAPedir()}>Volver a pedir</Button>
            <Button autoFocus onClick={() => void cerrar()}>Entendido</Button>
          </>
        ) : s === 'EXPIRED' ? (
          <>
            <Button variant="secondary" disabled={enviando} onClick={() => void queFirmeAqui()}>Que firme aquí</Button>
            <Button autoFocus loading={enviando} onClick={() => void volverAPedir()}>Volver a pedir</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void cerrar()}>Cerrar</Button>
            <Button loading={enviando} onClick={() => void volverAPedir()}>Volver a pedir</Button>
          </>
        )}>
        <div className="stack">
          {detalle}
          <Desenlace s={solicitud} firmantes={lista} restan={restan} minutos={minutosSolicitud} minutosFirma={minutosFirma} />
          {s === 'PENDING' && (
            <p className="small muted">Con «Seguir atendiendo» la espera pasa a una franja arriba del panel y esto sigue solo cuando firme, mientras no salgas de esta pantalla.</p>
          )}
        </div>
      </Dialog>
    );
  }

  const alcance = avisoDeAlcance(lista);
  return (
    <Dialog open onClose={onClose} title={titulo}
      sub="Necesita la segunda firma del dueño: aquí mismo con su contraseña, o desde su teléfono."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        {modo === 'distancia'
          ? <Button icon={<Smartphone />} loading={enviando} disabled={nadie || lista.length === 0} onClick={() => void pedir()}>Pedir autorización</Button>
          : <Button icon={<ShieldCheck />} loading={enviando} disabled={nadie || !(firmaDe || email.trim()) || !password} onClick={() => void autorizar()}>Autorizar</Button>}</>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void (modo === 'distancia' ? pedir() : autorizar()); }} autoComplete="off">
        {detalle}
        {firmantesCarga.error && (
          <ErrorCarga titulo="No se pudo consultar quién puede autorizar" mensaje="Puedes autorizar aquí con el correo y la contraseña de quien firma; para pedirlo a su teléfono, reintenta." onReintentar={() => void firmantesCarga.recargar()} />
        )}
        {nadie ? (
          <Callout tone="danger" title="Nadie puede autorizar esto">
            Ninguna persona tiene el permiso sobre esta sucursal{monto ? ` y un tope de al menos ${pesos(monto)}` : ''}. Pide a la dueña que lo haga o que ajuste los roles.
          </Callout>
        ) : firmantes && (
          <p className="small muted">
            Pueden autorizar: <strong>{lista.map((a) => (pausaVigente(a) ? `${a.fullName} (firmas en pausa hasta las ${hora(a.pausedUntil!)})` : a.fullName)).join(', ')}</strong>
            {monto ? <> · hasta {pesos(monto)}, solo para esta operación.</> : ' · solo para esta operación.'}
          </p>
        )}
        {todosEnPausa && (
          <Callout tone="warn" title="Sus firmas están en pausa">
            Hubo intentos fallidos con su contraseña. Podrá firmar de nuevo a las {hora(pausados.map((a) => a.pausedUntil!).sort().at(-1)!)}, aquí o desde su teléfono.
          </Callout>
        )}
        {!nadie && lista.length > 0 && (
          <Segmented value={modo} onChange={setModo} options={[
            { value: 'aqui' as const, label: 'Aquí, en este equipo' },
            { value: 'distancia' as const, label: 'Pedir a su teléfono' },
          ]} />
        )}
        {!nadie && modo === 'distancia' && (
          <>
            <p className="small muted">Le llega a su panel, en Autorizaciones, y la aprueba con su contraseña; aquí la operación sigue sola. Vence en {minutosSolicitud} minutos.</p>
            {/* Antes de pedir: si no tiene cómo enterarse, se dice (29-05). No bloquea. */}
            {alcance && <Callout tone="warn">{alcance}</Callout>}
          </>
        )}
        {!nadie && modo === 'aqui' && (
          <>
            {/* Campos sin nombre de inicio de sesión: el navegador no debe ofrecer guardar la clave del aprobador en la PC del mostrador. */}
            {firmantes === null && !firmantesCarga.error ? (
              <p className="small muted">Consultando quién puede autorizar…</p>
            ) : firmaDe ? (
              <div className="firma-quien">
                {lista.length > 1 ? (
                  <Field label="Quién autoriza" htmlFor="au-quien">
                    <select id="au-quien" className="input" value={firmaDe.userId} onChange={(e) => setElegido(e.target.value)}>
                      {lista.map((a) => <option key={a.userId} value={a.userId}>{a.fullName}</option>)}
                    </select>
                  </Field>
                ) : (
                  <p className="small">Firma: <strong>{firmaDe.fullName}</strong></p>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOtra(true)}>Otra persona</button>
              </div>
            ) : (
              <Field label="Correo de quien autoriza" htmlFor="au-em">
                <input id="au-em" name="aprobador-correo" className="input" type="email" autoFocus={otra} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            )}
            <Field label="Su contraseña" htmlFor="au-pw">
              <input id="au-pw" name="aprobador-clave" className="input" type="password" autoFocus autoComplete="new-password" data-lpignore="true" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
