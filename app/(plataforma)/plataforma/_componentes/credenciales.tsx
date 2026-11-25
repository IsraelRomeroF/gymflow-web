'use client';

import { useState } from 'react';
import { ArrowRight, Check, Copy, Power, Printer, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { TEMPORAL_DIAS, direccionDeEntrada, mensajeDeAcceso } from '@/lib/entrega-temporal';
import { WhatsappTemporal } from '@/components/entrega-temporal';
import { useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, Dialog } from '@/components/ui';
import { IconTile } from '@gymflow/ui/compartido';
import { ConMotivo } from './con-motivo';
import { CAMBIO_DE_SERVICIO, type Credencial, type Servicio } from './tipos';

/**
 * Las contraseñas temporales se ven UNA vez: después solo existen como hash.
 * Cada una se entrega a su dueño (22-03): WhatsApp a SU celular con SOLO su
 * clave, «Copiar» por persona y una hoja impresa por persona.
 *
 * Tras un alta (`recien`), el diálogo cierra el asistente (22-11): si la marca
 * sigue sin liberar lo dice y la libera ahí mismo, y «Ir a la marca» lleva a su
 * ficha. Antes el flujo terminaba en la lista, con la marca sin liberar y el
 * dueño bloqueado hasta que alguien se acordara.
 */
export function Credenciales({ marca, credenciales, recien, onClose, onIrALaMarca, onLiberada }: {
  marca: string; credenciales: Credencial[];
  /** La marca recién dada de alta: su id y si ya quedó en uso. */
  recien?: { organizationId: string; serviceStatus: Servicio };
  onClose: () => void;
  onIrALaMarca?: () => void;
  /** La marca se liberó desde aquí: la lista de atrás se vuelve a cargar. */
  onLiberada?: () => void;
}) {
  const toast = useToast();
  const entrada = direccionDeEntrada();
  const [estado, setEstado] = useState<Servicio | null>(recien?.serviceStatus ?? null);
  const [liberando, setLiberando] = useState(false);
  // Hoja de entrega (UX5-PL-03): una página por persona, para entregarla en mano.
  function imprimir() {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(marca)} · accesos</title>
      <style>body{font:15px/1.5 system-ui,sans-serif;color:#111;margin:40px}h1{font-size:22px;margin:0 0 4px}.sub{color:#555;margin:0 0 24px}
      .hoja{border:1px solid #ccc;border-radius:12px;padding:20px 24px;margin-bottom:16px;page-break-inside:avoid;break-after:page}
      .hoja:last-of-type{break-after:auto}
      .rol{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#555}.nom{font-size:18px;font-weight:600;margin:2px 0 10px}
      .clave{font:700 22px/1.2 ui-monospace,monospace;letter-spacing:.08em;background:#f1fbd2;padding:6px 10px;border-radius:8px;display:inline-block}
      .nota{color:#555;font-size:13px;margin-top:10px}</style></head><body>
      ${credenciales.map((c) => `<section class="hoja"><h1>${esc(marca)} · tu acceso a GymFlow</h1>
        <p class="sub">Entra en ${esc(entrada)} con tu correo y esta contraseña temporal. Al entrar eliges la tuya.</p>
        <div class="rol">${esc(c.roleName)}</div><div class="nom">${esc(c.fullName)}</div>
        <div>Correo: <strong>${esc(c.email)}</strong></div><div style="margin-top:8px">Contraseña temporal: <span class="clave">${esc(c.password)}</span></div>
        <div class="nota">Solo sirve para que elijas la tuya y vence en ${TEMPORAL_DIAS} días. No la compartas.</div></section>`).join('')}
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }
  const cambio = CAMBIO_DE_SERVICIO.liberar;
  return (
    <>
      <Dialog open size="lg" onClose={onClose} title={`${marca}: accesos de arranque`} sub="Cada clave a su dueño, y a nadie más."
        footer={recien
          ? <><Button variant="secondary" onClick={onClose}>Ya los entregué</Button>{onIrALaMarca && <Button onClick={onIrALaMarca}>Ir a la marca <ArrowRight size={16} /></Button>}</>
          : <Button onClick={onClose}>Ya los entregué</Button>}>
        <div className="stack">
          {/* El alta cierra aquí: en uso o sin liberar, se dice, y se libera sin salir (22-11). */}
          {recien && estado === 'PENDING' && (
            <div data-testid="sigue-sin-liberar">
              <Callout tone="warn" title="Sigue sin liberar">
                <p>Nadie de {marca} entra con estas contraseñas hasta que liberes el software.</p>
                <p className="mt-10"><Button size="sm" icon={<Power />} onClick={() => setLiberando(true)}>{cambio.boton}</Button></p>
              </Callout>
            </div>
          )}
          {recien && estado === 'ACTIVE' && <div data-testid="ya-en-uso"><Callout tone="ok" title="En uso">El software está liberado: su gente ya puede entrar con estas contraseñas.</Callout></div>}
          <Callout tone="warn" title="Esta pantalla no se vuelve a mostrar">La plataforma no guarda las contraseñas. Entrégale a cada persona la suya: por WhatsApp a su celular, copiada o en su hoja impresa. Solo le sirve para elegir la propia al entrar y vence en {TEMPORAL_DIAS} días.</Callout>
          <ul className="list entrega-lista">
            {credenciales.map((c) => <EntregaPersona key={c.email} marca={marca} entrada={entrada} c={c} />)}
          </ul>
          <div><Button variant="secondary" size="sm" icon={<Printer />} onClick={imprimir}>{credenciales.length > 1 ? 'Imprimir hojas' : 'Imprimir hoja'}</Button></div>
        </div>
      </Dialog>
      {recien && liberando && (
        <ConMotivo titulo={cambio.titulo(marca)} texto={cambio.texto} boton={cambio.confirmar} sugerencias={cambio.motivos}
          onClose={() => setLiberando(false)}
          onConfirmar={async (reason) => {
            try {
              await api(`/platform/organizations/${recien.organizationId}/service`, { method: 'POST', body: JSON.stringify({ status: cambio.status, reason }) });
              setEstado('ACTIVE'); setLiberando(false); toast('ok', cambio.hecho); onLiberada?.();
            } catch (e) { toast('error', errorText(e, 'No se pudo liberar')); }
          }} />
      )}
    </>
  );
}

/** Una persona, su clave y cómo dársela: a su celular o copiada, nunca junto con las de otros. */
function EntregaPersona({ marca, entrada, c }: { marca: string; entrada: string; c: Credencial }) {
  const [copiado, setCopiado] = useState(false);
  const mensaje = mensajeDeAcceso(marca, entrada, c);
  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); setCopiado(true); } catch { /* sin portapapeles: se copia a mano */ }
  }
  return (
    <li className="list-item entrega-persona" data-testid="entrega-persona">
      <IconTile><Users /></IconTile>
      <div className="flex-1 min-w-0">
        <p className="row gap-8"><span className="strong">{c.fullName}</span><Badge>{c.roleName}</Badge></p>
        <p className="small muted">{c.email}{c.phoneE164 ? ` · ${c.phoneE164}` : ''}</p>
        <code className="strong entrega-clave" data-testid="clave-temporal">{c.password}</code>
      </div>
      <div className="row gap-4 flex-wrap justify-end">
        <WhatsappTemporal nombre={c.fullName} telefono={c.phoneE164} mensaje={mensaje} />
        <Button variant="ghost" size="sm" icon={copiado ? <Check /> : <Copy />} onClick={() => void copiar()}>{copiado ? 'Copiada' : 'Copiar'}</Button>
      </div>
    </li>
  );
}
