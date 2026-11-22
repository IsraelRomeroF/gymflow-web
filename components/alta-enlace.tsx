'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Printer, Check, ExternalLink, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { enlaceAlta, usePortalUrl } from '@/lib/portal';
import { useSession, useToast } from './session';
import { Button, Callout, Dialog, ErrorCarga, Field } from './ui';
import { useCarga } from '@/lib/carga';
import { Qr } from './qr';

type Formulario = { gymName: string; branchName: string; blockedBy: Array<{ kind: string; consentType: string }> };

/** Una dirección que no sirve desde el teléfono de nadie, o que cambia al reiniciar (la dirección fija es D-01, fase 3). */
export const direccionInestable = (url: string): boolean => /localhost|127\.0\.0\.1|trycloudflare\.com/.test(url);

/**
 * El enlace y el QR del formulario de alta de una sucursal.
 *
 * Es la puerta de entrada de todo el proceso: se manda por WhatsApp a quien
 * preguntó, se imprime en recepción o se pega en la puerta. Antes existía el
 * formulario pero nadie tenía cómo llegar a él.
 *
 * Bloque 2.4 (9-11): quien tiene el teléfono en la mano quiere MANDAR el
 * enlace, no imprimir. En teléfono y tableta lo primero es «Compartir» (la
 * hoja del sistema, o WhatsApp si el navegador no la tiene); en escritorio,
 * «Imprimir cartel». Y si la dirección no sirve fuera del gimnasio, se dice.
 */
export function EnlaceAltaDialog({ onClose }: { onClose: () => void }) {
  const portal = usePortalUrl();
  const { branches, inScope } = useSession();
  const toast = useToast();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const [copiado, setCopiado] = useState(false);
  const clave = branches.find((b) => b.id === sede)?.publicSlug || sede;
  const url = enlaceAlta(portal, clave);
  // En un aparato táctil se comparte; en escritorio se imprime. Se decide ya montado: en el servidor no hay pantalla.
  const [tactil, setTactil] = useState(false);
  useEffect(() => { setTactil(window.matchMedia('(pointer: coarse)').matches); }, []);

  // El mismo endpoint público que usa el teléfono: si dice que está
  // bloqueado, el socio vería lo mismo. Si no responde, se dice: callar
  // dejaba creer que el formulario recibía altas (26-01).
  const cargarForm = useCallback(() => api<Formulario>(`/intake/${sede}/form`), [sede]);
  const formCarga = useCarga(sede ? cargarForm : null);
  const form = formCarga.datos ?? null;
  const mensaje = `Inscríbete en ${form?.gymName || 'nuestro gimnasio'}${form?.branchName ? ` (${form.branchName})` : ''} desde tu celular, tarda 2 minutos: ${url}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast('error', 'No se pudo copiar; selecciona el enlace y cópialo a mano.');
    }
  }

  /** La hoja de compartir del teléfono; sin ella, WhatsApp con el mensaje escrito. */
  async function compartir() {
    if (typeof navigator.share === 'function') {
      // Cancelar la hoja no es un error.
      try { await navigator.share({ title: 'Inscripción', text: mensaje }); } catch { /* la cerró */ }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener');
  }

  const cartel = <a className={`btn ${tactil ? 'btn-secondary' : 'btn-primary'}`} href={`/cartel/${clave}`} target="_blank" rel="noreferrer"><Printer />Imprimir cartel</a>;
  return (
    <Dialog open onClose={onClose} title="Formulario de alta" sub="La persona lo llena en su teléfono; aquí solo se confirma."
      footer={<>
        <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink />Probarlo</a>
        {tactil
          ? <>{cartel}<Button icon={<Share2 />} onClick={() => void compartir()}>Compartir</Button></>
          : <><Button variant="secondary" icon={<Share2 />} onClick={() => void compartir()}>Compartir</Button>{cartel}</>}
      </>}>
      <div className="stack">
        {sedes.length > 1 && (
          <Field label="Sucursal" htmlFor="sede-alta" hint="Cada sucursal tiene su propio enlace: el alta llega con su sede de casa.">
            <select id="sede-alta" className="select" value={sede} onChange={(e) => setSede(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        {formCarga.error && (
          <ErrorCarga titulo="No se pudo revisar si el formulario recibe altas" mensaje={formCarga.error} onReintentar={() => void formCarga.recargar()} />
        )}
        {form && form.blockedBy.length > 0 && (
          <Callout tone="warn" title="Todavía no se pueden recibir altas">
            Faltan textos de consentimiento por publicar. Publícalos en <strong>Textos de consentimiento</strong> y el formulario se abre solo.
          </Callout>
        )}
        {direccionInestable(url) && (
          <Callout tone="warn" title="Este enlace todavía no sirve fuera del gimnasio">
            La dirección del portal es de este equipo o cambia al reiniciar: sirve para quien lo abre aquí, en la misma red. No imprimas el cartel con ella.
          </Callout>
        )}
        <div className="row qr-marco">
          <div className="qr-papel">
            <Qr value={url} size={200} />
          </div>
        </div>
        <div className="row gap-8">
          <input className="input mono enlace-alta" readOnly value={url} aria-label="Enlace del formulario" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="secondary" icon={copiado ? <Check /> : <Copy />} onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar'}</Button>
        </div>
        <p className="hint">Compártelo por WhatsApp con quien pregunte por inscripciones, o imprime el cartel para recepción.</p>
      </div>
    </Dialog>
  );
}
