'use client';

import { useState } from 'react';
import { PhoneCall, MessageCircle, Footprints, MoreHorizontal, CalendarClock, UserPlus } from 'lucide-react';
import type { FollowUpContact } from '@gymflow/core/contracts';
import { CANAL_DE_CONTACTO, RESULTADO_DE_CONTACTO } from '@gymflow/core/vocabulario';
import { MOTIVOS, type Motivo } from '@gymflow/core/motivos';
import { closesProspect } from '@gymflow/core/captacion';
import { api } from '@/lib/api';
import { fecha, hace } from '@/lib/format';
import { useSession, useToast, errorText } from './session';
import { hoyEn, masDias } from '@/lib/zonas';
import { Badge, Button, CampoFecha, Dialog, Field, Opciones } from './ui';

/** Un contacto registrado: el contrato del núcleo, el mismo para un interesado que para un socio en riesgo. */
export type Contacto = FollowUpContact;

/** La palabra sale del vocabulario del núcleo (`CANAL_DE_CONTACTO`); aquí solo el ícono. */
const ICONO: Record<Contacto['channel'], React.ReactNode> = {
  CALL: <PhoneCall />, WHATSAPP: <MessageCircle />, VISIT: <Footprints />, OTHER: <MoreHorizontal />,
};
export const CANAL = Object.fromEntries((Object.keys(ICONO) as Contacto['channel'][]).map((k) => [k, { label: CANAL_DE_CONTACTO[k] ?? k, icon: ICONO[k] }])) as Record<Contacto['channel'], { label: string; icon: React.ReactNode }>;

/** Qué pasó, con las palabras del núcleo (`RESULTADO_DE_CONTACTO`). */
export const RESULTADO = RESULTADO_DE_CONTACTO as Readonly<Record<Contacto['outcome'], string>>;

/**
 * Interesado: ¿se inscribe? · Socio en riesgo: ¿regresa? Las respuestas cambian
 * con la pregunta. «Se le mandó el alta digital» no se elige aquí: lo registra
 * «Mandar alta digital» desde la fila.
 */
const RESULTADOS: Record<'prospecto' | 'socio', Contacto['outcome'][]> = {
  prospecto: ['INTERESTED', 'ANSWERED', 'NO_ANSWER', 'TRIAL_VISIT', 'NOT_INTERESTED'],
  socio: ['COMING_BACK', 'ANSWERED', 'NO_ANSWER', 'NOT_INTERESTED'],
};

/**
 * Con un interesado, el próximo paso viene puesto según lo que pasó (2.4): «No
 * contestó» → mañana, de un toque. «Le interesa» no trae fecha: se pregunta
 * cuándo viene. Días desde hoy.
 */
const PROXIMO_SUGERIDO: Partial<Record<Contacto['outcome'], number>> = { NO_ANSWER: 1, ANSWERED: 3, TRIAL_VISIT: 2 };

/** Por qué no se inscribió: el catálogo del núcleo (`interesadoPerdido`). */
export const MOTIVOS_DE_CIERRE: readonly Motivo[] = MOTIVOS.interesadoPerdido.motivos;

/** Hoy en la zona del gimnasio, no en la de la computadora (26-06). */
function useHoy(): string {
  const { org } = useSession();
  return hoyEn(org.timezone);
}

/** ¿Ya toca el próximo paso? (hoy o vencido). `hoy` es la fecha del gimnasio (`hoyEn`). */
export function tocaHoy(c: Contacto | null | undefined, hoy: string): boolean {
  return !!c?.nextStepOn && c.nextStepOn <= hoy;
}

/** La línea "Llamada · No contestó · hace 2 h · Paola" y el próximo paso, debajo del nombre. */
export function UltimoContacto({ c, total, sinProximo }: {
  c: Contacto | null | undefined; total?: number;
  /** La bandeja de interesados ya dice cuándo toca en su propia columna: aquí no se repite. */
  sinProximo?: boolean;
}) {
  const hoyIso = useHoy();
  if (!c) return <div className="tiny muted" data-testid="sin-contacto">Sin contactar</div>;
  const vencido = tocaHoy(c, hoyIso);
  return (
    <div className="tiny muted row wrap ultimo-contacto" data-testid="ultimo-contacto">
      <span>{CANAL[c.channel]?.label ?? c.channel} · <strong className="strong">{RESULTADO[c.outcome] ?? c.outcome}</strong> · {hace(c.createdAt)}{c.createdByName ? ` · ${c.createdByName.split(' ')[0]}` : ''}{total && total > 1 ? ` · ${total} contactos` : ''}</span>
      {c.nextStepOn && !sinProximo && (
        <Badge tone={vencido ? 'warn' : 'neutral'}><CalendarClock size={12} />{vencido ? (c.nextStepOn < hoyIso ? `Tocaba el ${fecha(c.nextStepOn)}` : 'Toca hoy') : `Próximo: ${fecha(c.nextStepOn)}`}</Badge>
      )}
    </div>
  );
}

/**
 * «CONTACTO CON…» (UX7): registrar un contacto con resultado, nota y próximo
 * paso. Es lo que hace que la lista refleje el trabajo de recepción y que la
 * gerencia vea qué se hizo, no solo a quién había que llamar.
 *
 * Con un interesado (bloque 2.4) el resultado mueve la etapa solo: ya no hay
 * un `select` de estado aparte. Todo interesado abierto queda con su próximo
 * paso con fecha; «No le interesa» pide por qué y lo cierra en el mismo paso;
 * «Se inscribe ahora» abre el alta sin salir.
 */
export function ContactoDialog({ para, nombre, url, onClose, onListo, onInscribir }: {
  para: 'prospecto' | 'socio'; nombre: string; url: string; onClose: () => void; onListo: (c: Contacto) => void;
  /** Solo con un interesado: «Se inscribe ahora». */
  onInscribir?: () => void;
}) {
  const toast = useToast();
  const [canal, setCanal] = useState<Contacto['channel']>('CALL');
  const [resultado, setResultado] = useState<Contacto['outcome'] | null>(null);
  const [nota, setNota] = useState('');
  const [proximo, setProximo] = useState('');
  /** La fecha la puso la pantalla (sugerida) y no la persona: cambia sola si cambia el resultado. */
  const [sugerida, setSugerida] = useState(true);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const hoyIso = useHoy();

  const deInteresado = para === 'prospecto';
  const cierra = deInteresado && !!resultado && closesProspect(resultado);
  const pideTexto = cierra && !!MOTIVOS_DE_CIERRE.find((m) => m.codigo === motivo)?.pideTexto;
  const falta = {
    motivo: cierra && !motivo ? 'Elige por qué ya no se va a inscribir.' : cierra && pideTexto && nota.trim().length < 3 ? 'Escribe el motivo en la nota.' : null,
    // Todo interesado abierto tiene próximo paso con fecha (2.4).
    proximo: deInteresado && !cierra && !proximo ? 'Elige cuándo es el próximo paso: sin fecha, nadie vuelve a verlo.' : null,
  };

  function elegir(r: Contacto['outcome']) {
    setResultado(r); setFallo(null);
    // Vino a probar: estuvo aquí.
    if (r === 'TRIAL_VISIT') setCanal('VISIT');
    if (deInteresado && (sugerida || !proximo)) {
      const dias = PROXIMO_SUGERIDO[r];
      setProximo(dias ? masDias(hoyIso, dias) : '');
      setSugerida(true);
    }
  }

  async function guardar() {
    if (!resultado) return;
    setIntentado(true);
    if (falta.motivo || falta.proximo) return;
    setEnviando(true); setFallo(null);
    try {
      const c = await api<Contacto>(url, {
        method: 'POST',
        body: JSON.stringify({
          channel: canal, outcome: resultado, ...(nota.trim() ? { note: nota.trim() } : {}),
          ...(cierra ? { lostReasonCode: motivo } : proximo ? { nextStepOn: proximo } : {}),
        }),
      });
      toast('ok', cierra ? `${nombre} sale de seguimiento.` : `Contacto con ${nombre} registrado.`);
      onListo(c);
    } catch (e) { setFallo(errorText(e, 'No se pudo registrar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Contacto con ${nombre}`} error={fallo}
      sub={deInteresado ? 'Queda con tu nombre y la hora. Lo que pasó mueve su etapa: ya no se elige aparte.' : 'Queda con tu nombre y la hora. La lista ya no te pide volver a llamarle hasta el próximo paso.'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        {onInscribir && <Button variant="ghost" icon={<UserPlus />} onClick={onInscribir}>Se inscribe ahora</Button>}
        <Button loading={enviando} disabled={!resultado} variant={cierra ? 'danger' : undefined} onClick={() => void guardar()}>{cierra ? 'Registrar y cerrar' : 'Registrar contacto'}</Button>
      </>}>
      <div className="stack">
        {/* Tres preguntas, tres controles que ya no se ven distintos (26-11): tarjetas para el canal,
            chips para el resultado y la fecha con sus atajos. Las dos primeras son grupos de radio. */}
        <div>
          <p className="label mb-8" id="seg-canal">¿Cómo?</p>
          <Opciones forma="tarjetas" compactas columnas={4} etiquetadaPor="seg-canal" value={canal} onChange={setCanal}
            opciones={(Object.keys(CANAL) as Contacto['channel'][]).map((k) => ({ value: k, label: CANAL[k].label, icono: CANAL[k].icon }))} />
        </div>
        <div>
          <p className="label mb-8" id="seg-resultado">¿Qué pasó?</p>
          <Opciones forma="chips" etiquetadaPor="seg-resultado" value={resultado} onChange={elegir}
            opciones={RESULTADOS[para].map((k) => ({ value: k, label: RESULTADO[k] }))} />
        </div>
        {cierra && (
          <div data-testid="motivo-de-cierre">
            <p className="label mb-8" id="seg-motivo">¿Por qué ya no se va a inscribir? <span className="field-req" aria-hidden>*</span></p>
            <Opciones forma="chips" etiquetadaPor="seg-motivo" value={motivo} onChange={(m) => { setMotivo(m); setFallo(null); }}
              opciones={MOTIVOS_DE_CIERRE.map((m) => ({ value: m.codigo, label: m.pideTexto ? 'Otro…' : m.texto }))} />
            {intentado && falta.motivo && <p className="field-error mt-6" role="alert">{falta.motivo}</p>}
          </div>
        )}
        <Field label={pideTexto ? 'Nota' : 'Nota (opcional)'} htmlFor="seg-nota">
          <input id="seg-nota" className="input" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)}
            placeholder={para === 'prospecto' ? 'Viene el lunes a probar la clase de spinning' : 'Se lastimó la rodilla; regresa en dos semanas'} />
        </Field>
        {!cierra && (
          <Field label={deInteresado ? 'Próximo paso' : 'Próximo paso (opcional)'} htmlFor="seg-proximo" required={deInteresado}
            error={intentado ? falta.proximo : null}
            hint={deInteresado && resultado === 'INTERESTED' && !proximo ? '¿Cuándo viene o cuándo le vuelves a hablar?' : undefined}>
            <CampoFecha id="seg-proximo" value={proximo} onChange={(v) => { setProximo(v); setSugerida(false); }} min={hoyIso} hoy={hoyIso} atajos={[1, 3, 7]} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
