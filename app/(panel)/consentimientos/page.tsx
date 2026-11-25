'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { History, Pencil, Plus, Lock, Eye, Trash2, FileSignature } from 'lucide-react';
import type { ConsentDocumentList, ConsentDocumentPublishResult, ConsentDocumentReview, ConsentDocumentSummary, NoticeSignatureRequests } from '@gymflow/core/contracts';
import { TEXTO_SOLO_CON_MODULO, corchetesSinCompletar, modeloDeTexto } from '@gymflow/core/privacidad';
import { api } from '@/lib/api';
import { fecha } from '@gymflow/ui/format';
import { CONSENT_TYPE } from '@/lib/labels';
import { useFormulario } from '@gymflow/ui/formulario';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Callout, CampoMotivo, Card, Dialog, ErrorCarga, Field, PageHeader, Skeleton, faltaMotivo, ERROR_MOTIVO } from '@/components/ui';
import { useCarga } from '@gymflow/ui/carga';
import { BandejaArco, SolicitudesEnCifras } from '@/components/cumplimiento';
import { Conservacion } from '@/components/privacidad';
import { hoyEn } from '@/lib/zonas';

type Doc = ConsentDocumentSummary;
type DocFull = Doc & { bodyText: string };

/**
 * El texto biométrico de los primeros modelos decía que la plantilla vivía
 * «solo en el equipo de la sucursal». Con la cámara de recepción (ADR-040)
 * vive cifrada en el servidor del gimnasio: ese texto describe otro
 * tratamiento (6-03, 21-09). Si el vigente lo dice, la pantalla lo advierte.
 */
const BIOMETRICO_VIEJO = /solo en el equipo|equipo de (tu|su|esa|la) sucursal|no sale de ahí|únicamente para abrirte el torniquete/i;

/** Lo que el alta y el enrolamiento necesitan, en el orden en que se piden. */
const TIPOS = ['PRIVACY_NOTICE', 'HOUSE_RULES', 'BIOMETRIC', 'HEALTH_DATA', 'MARKETING', 'RECURRING_CHARGE'] as const;
/** Se firman en toda alta: sin ellos no se da de alta a nadie y no se retiran sin reemplazo. */
const DE_TODA_ALTA = new Set<string>(['PRIVACY_NOTICE', 'HOUSE_RULES']);
const PARA_QUE: Record<string, string> = {
  PRIVACY_NOTICE: 'Obligatorio en el alta',
  HOUSE_RULES: 'Obligatorio en el alta',
  BIOMETRIC: 'Se firma al registrar rostro o huella',
  HEALTH_DATA: 'Opcional en el alta',
  MARKETING: 'Opcional en el alta',
  RECURRING_CHARGE: 'Se firma al domiciliar el cobro; el servidor le agrega plan, importe y tarjeta',
};

/**
 * Textos de consentimiento (ADR-033).
 *
 * Una fila por tipo con su versión vigente. Publicar es irreversible —el
 * texto publicado no se edita, solo se reemplaza con otra versión— y por eso
 * se REVISA antes: el texto completo, lo que cambia contra el vigente y, en
 * el aviso de privacidad, la lista de lo que no puede dejar de decir (21-07,
 * 21-08). Un borrador sí se corrige y se borra.
 */
export default function ConsentimientosPage() {
  const { can, activo } = useSession();
  const toast = useToast();

  const [ver, setVer] = useState<DocFull | null>(null);
  const [editor, setEditor] = useState<{ tipo: string; borrador: Doc | null } | null>(null);
  const [revisar, setRevisar] = useState<Doc | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);
  const gestiona = can('settings:consent:manage');
  // La dueña (3.7, D-25): lee los textos completos, ve las solicitudes en cifras y firma el aviso de privacidad.
  const soloLee = !can('members:consent:read');
  const firma = can('approvals:grant');
  const [porFirmar, setPorFirmar] = useState<SolicitudDeFirma | null>(null);
  const cargaFirmas = useCarga(useCallback(() => api<NoticeSignatureRequests>('/consent-documents/signature-requests').then((r) => r.requests), []));
  const firmas = cargaFirmas.datos ?? [];
  const firmaDe = (id: string) => firmas.find((x) => x.documentId === id) ?? null;
  const esperan = firmas.filter((x) => x.status === 'PENDING');

  // Sin red no es «Falta publicar» ni «Sin texto» en cada tipo (26-01, 21-23).
  const cargarDocs = useCallback(() => api<ConsentDocumentList>('/consent-documents').then((r) => r.documents), []);
  const carga = useCarga(cargarDocs);
  const docs = carga.datos ?? null;
  const cargar = carga.recargar;
  // El cuerpo del biométrico vigente, para saber si todavía es el texto viejo.
  const bioVigenteId = docs?.find((d) => d.consentType === 'BIOMETRIC' && d.status === 'PUBLISHED')?.id ?? null;
  const cuerpoBio = useCarga(useCallback(() => (bioVigenteId ? api<DocFull>(`/consent-documents/${bioVigenteId}`).then((d) => d.bodyText) : Promise.resolve(null)), [bioVigenteId]));
  const bioViejo = !!cuerpoBio.datos && BIOMETRICO_VIEJO.test(cuerpoBio.datos);

  async function abrir(d: Doc) {
    try { setVer(await api<DocFull>(`/consent-documents/${d.id}`)); } catch (e) { toast('error', errorText(e)); }
  }

  return (
    <>
      <PageHeader
        title="Textos de consentimiento"
        sub="Lo que el socio acepta. Un texto publicado no se edita: se reemplaza con otra versión, y cada firma guarda cuál aceptó."
      />

      {/* El aviso de privacidad no se publica sin la firma de la dueña (D-25). */}
      {firma && esperan.length > 0 && (
        <div className="mb-20" data-testid="avisos-por-firmar">
          <Callout tone="warn" title={esperan.length === 1 ? 'El aviso de privacidad espera tu firma' : `${esperan.length} avisos de privacidad esperan tu firma`}>
            {esperan.map((x) => (
              <div key={x.documentId} className="row-between gap-12 flex-wrap callout-accion">
                <span className="small">Versión <code>{x.version}</code> · la pidió {x.requestedByName ?? 'la gerencia'} el {fecha(x.requestedAt)}: «{x.reason}»</span>
                <Button size="sm" icon={<FileSignature />} onClick={() => setPorFirmar(x)}>Leer y firmar</Button>
              </div>
            ))}
          </Callout>
        </div>
      )}

      {/* Cumplimiento (PS-07/PS-08): lo que los socios pidieron y a quién ya le toca anonimizar. */}
      <div className="grid grid-2 mb-20">
        {soloLee ? <SolicitudesEnCifras /> : <BandejaArco />}
        {/* Bloque 3.9 (D-32): plazos, rostros de exsocios y la lista mensual que firma el dueño. Reemplaza a «Plazo de supresión». */}
        <Conservacion />
      </div>

      {bioViejo && (
        <div className="mb-20" data-testid="biometrico-viejo">
          <Callout tone="warn" title="El texto biométrico vigente describe otro tratamiento">
            <p className="small">
              Dice que la plantilla vive en el equipo de la sucursal, pero con la cámara de recepción vive cifrada en el servidor del gimnasio.
              Publica una versión nueva con «Nueva versión» → «Usar el modelo». Quien firmó la anterior aparecerá en su ficha como «debe volver a firmar»; su rostro sigue funcionando mientras tanto.
            </p>
          </Callout>
        </div>
      )}

      {carga.error ? (
        <ErrorCarga titulo="No se pudieron cargar los textos" mensaje={carga.error} onReintentar={() => void cargar()} />
      ) : !docs ? (
        <Skeleton h={360} r={16} />
      ) : (
        <Card pad={false} title="Los seis textos" sub="Revisa cada borrador antes de publicarlo: publicar no tiene vuelta atrás.">
          <ul className="list" data-testid="textos">
            {TIPOS.map((t) => {
              const deTipo = docs.filter((d) => d.consentType === t);
              const vigente = deTipo.find((d) => d.status === 'PUBLISHED');
              // Solo el borrador más reciente: los anteriores quedaron superados.
              const borrador = deTipo.find((d) => d.status === 'DRAFT') ?? null;
              const modulo = TEXTO_SOLO_CON_MODULO[t];
              const sinUso = !!modulo && !activo(modulo);
              return (
                <li key={t} className="fila-texto" data-tipo={t}>
                  <div className="fila-texto-que">
                    <p className="strong">{CONSENT_TYPE[t]}</p>
                    <p className="tiny muted">{PARA_QUE[t]}{vigente ? <> · versión <code>{vigente.version}</code> desde el {fecha(vigente.publishedAt)}</> : ''}</p>
                  </div>
                  {vigente ? <Badge tone="ok" dot>Vigente</Badge>
                    : sinUso ? <Badge>No se usa (módulo apagado)</Badge>
                      : DE_TODA_ALTA.has(t) || modulo ? <Badge tone="warn" dot>Falta publicar</Badge>
                        : <Badge>Sin texto</Badge>}
                  {borrador && <Badge tone="info" dot>Borrador {borrador.version} por revisar</Badge>}
                  {/* La firma de la dueña en el aviso (D-25): en qué va. */}
                  {borrador && firmaDe(borrador.id)?.status === 'PENDING' && <Badge tone="warn" dot>Espera la firma de la dueña</Badge>}
                  {borrador && firmaDe(borrador.id)?.status === 'STALE' && <Badge tone="warn" dot>Cambió después de pedir la firma: vuelve a pedirla</Badge>}
                  {borrador && firmaDe(borrador.id)?.status === 'REJECTED' && <Badge tone="danger" dot>La dueña no lo firmó: {firmaDe(borrador.id)!.note}</Badge>}
                  <div className="row wrap gap-6">
                    {vigente && <Button variant="ghost" size="sm" icon={<Eye />} onClick={() => void abrir(vigente)}>Leer</Button>}
                    {borrador && <Button variant={gestiona ? 'primary' : 'secondary'} size="sm" icon={<Lock />} onClick={() => setRevisar(borrador)}>{gestiona ? 'Revisar y publicar' : 'Revisar'}</Button>}
                    {borrador && gestiona && <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => setEditor({ tipo: t, borrador })}>Corregir borrador</Button>}
                    {!borrador && gestiona && <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setEditor({ tipo: t, borrador: null })}>Nueva versión</Button>}
                    {deTipo.length > 0 && <Button variant="ghost" size="sm" icon={<History />} onClick={() => setHistorial(t)}>Historial</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Dialog open={!!ver} onClose={() => setVer(null)} size="lg"
        title={ver?.title ?? ''} sub={ver ? `${CONSENT_TYPE[ver.consentType]} · versión ${ver.version}` : undefined}>
        {ver && <div className="doc doc-lectura">{ver.bodyText}</div>}
      </Dialog>

      {editor && <EditorDialog tipo={editor.tipo} borrador={editor.borrador} onClose={() => setEditor(null)}
        onDone={async (mensaje) => { setEditor(null); toast('ok', mensaje); await cargar(); }} />}
      {revisar && <RevisarDialog doc={revisar} puedePublicar={gestiona} onClose={() => setRevisar(null)}
        onCorregir={() => { const b = revisar; setRevisar(null); setEditor({ tipo: b.consentType, borrador: b }); }}
        pideFirma={revisar.consentType === 'PRIVACY_NOTICE' && !firma}
        onDone={async (r) => {
          setRevisar(null);
          toast('ok', r.awaitingSignature ? 'Se pidió la firma de la dueña. El aviso se publica cuando lo firme.' : 'Texto publicado. Las nuevas firmas usarán esta versión.');
          await Promise.all([cargar(), cargaFirmas.recargar()]);
        }} />}
      {porFirmar && <FirmarAvisoDialog solicitud={porFirmar} onClose={() => setPorFirmar(null)}
        onDone={async (mensaje) => { setPorFirmar(null); toast('ok', mensaje); await Promise.all([cargar(), cargaFirmas.recargar()]); }} />}
      {historial && docs && <HistorialDialog tipo={historial} docs={docs.filter((d) => d.consentType === historial)} puedeRetirar={gestiona && !DE_TODA_ALTA.has(historial)}
        onClose={() => setHistorial(null)} onLeer={(d) => void abrir(d)}
        onRetirado={async () => { setHistorial(null); toast('ok', 'Texto retirado: nadie más lo firma hasta que publiques otro.'); await cargar(); }} />}
    </>
  );
}

/** Nueva versión o corrección de un borrador (21-07): el mismo formulario. */
function EditorDialog({ tipo, borrador, onClose, onDone }: { tipo: string; borrador: Doc | null; onClose: () => void; onDone: (mensaje: string) => Promise<void> }) {
  const toast = useToast();
  const { org, branches } = useSession();
  // La versión propuesta es el mes en curso del gimnasio, no el de la computadora.
  const [version, setVersion] = useState(() => borrador?.version ?? hoyEn(org.timezone).slice(0, 7));
  const [title, setTitle] = useState(borrador?.title ?? CONSENT_TYPE[tipo] ?? '');
  const [bodyText, setBody] = useState('');
  const [borrando, setBorrando] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // El cuerpo del borrador se pide al abrir: la lista no lo trae.
  const cuerpo = useCarga(useCallback(async () => {
    if (!borrador) return '';
    const d = await api<DocFull>(`/consent-documents/${borrador.id}`);
    setBody(d.bodyText);
    return d.bodyText;
  }, [borrador]));
  const plazo = useCarga(useCallback(() => api<{ effectiveMonths: number }>('/privacy/settings').then((r) => r.effectiveMonths), []));
  // P-01 (bloque 4.18, edición puntual): el aviso modelo dice qué es «baja» con el plazo de baja del gimnasio.
  const diasDeBaja = useCarga(useCallback(() => api<{ terms: { churnDays: number } }>('/member-terms').then((r) => r.terms.churnDays), []));
  const modelo = modeloDeTexto(tipo, {
    razonSocial: org.legalName, nombreComercial: org.tradeName, sucursales: branches.filter((b) => b.isActive).map((b) => b.name), mesesDeConservacion: plazo.datos ?? null,
    diasDeBaja: diasDeBaja.datos ?? null,
  });
  const faltan = useMemo(() => corchetesSinCompletar(bodyText), [bodyText]);
  const f = useFormulario({
    version: !version.trim() && 'Escribe la versión',
    title: title.trim().length < 3 && 'Escribe el título',
    bodyText: bodyText.trim().length < 20 && 'Escribe el texto (mínimo 20 caracteres)',
  }, { obligatorios: ['version', 'title', 'bodyText'] });

  async function guardar() {
    try {
      if (borrador) await api(`/consent-documents/${borrador.id}`, { method: 'PATCH', body: JSON.stringify({ version: version.trim(), title: title.trim(), bodyText }) });
      else await api('/consent-documents', { method: 'POST', body: JSON.stringify({ consentType: tipo, version: version.trim(), title: title.trim(), bodyText }) });
      await onDone(faltan.length > 0 ? 'Borrador guardado. Completa los [corchetes] antes de publicarlo.' : 'Borrador guardado. Revísalo y publícalo cuando esté listo.');
    } catch (e) { toast('error', errorText(e)); }
  }
  async function borrar() {
    if (!borrador) return;
    try {
      await api(`/consent-documents/${borrador.id}`, { method: 'DELETE' });
      await onDone('Borrador borrado.');
    } catch (e) { toast('error', errorText(e)); }
  }
  /** Lleva el cursor al corchete: «Faltan 6» no decía cuáles. */
  function irA(corchete: string) {
    const i = bodyText.indexOf(corchete);
    if (i < 0 || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(i, i + corchete.length);
  }

  return (
    <Dialog open onClose={onClose} size="lg" title={`${borrador ? 'Corregir borrador' : 'Nueva versión'} · ${CONSENT_TYPE[tipo]}`} sub="Se guarda como borrador. Nadie puede firmarlo hasta que lo revises y lo publiques."
      footer={<>
        {borrador && (borrando
          ? <Button variant="danger" icon={<Trash2 />} onClick={() => void borrar()}>Sí, borrar el borrador</Button>
          : <Button variant="danger-ghost" icon={<Trash2 />} onClick={() => setBorrando(true)}>Borrar borrador</Button>)}
        <Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button>
        <Button onClick={() => void f.enviar(guardar)} loading={f.enviando}>Guardar borrador</Button>
      </>}>
      {cuerpo.error ? <ErrorCarga titulo="No se pudo cargar el borrador" mensaje={cuerpo.error} onReintentar={() => void cuerpo.recargar()} /> : (
        <div className="stack">
          <div className="grid grid-2 gap-12">
            <Field label="Versión" htmlFor="v" {...f.campo('version')}><input id="v" className="input" value={version} maxLength={40} onChange={(e) => setVersion(e.target.value)} /></Field>
            <Field label="Título" htmlFor="t" {...f.campo('title')}><input id="t" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
          </div>
          {modelo && !bodyText && !borrador && (
            <Callout tone="info" title="Empieza con el modelo de GymFlow">
              <p className="small">Un texto base con los datos de tu gimnasio ya puestos. Lo que va entre [CORCHETES] lo completas tú. Es un punto de partida, no asesoría legal: revísalo antes de publicarlo.</p>
              <div className="callout-accion"><Button size="sm" variant="secondary" onClick={() => { setTitle(modelo.titulo); setBody(modelo.texto); }}>Usar el modelo</Button></div>
            </Callout>
          )}
          <Field label="Texto" htmlFor="b" {...f.campo('bodyText')} hint={faltan.length === 0 ? 'Mínimo 20 caracteres.' : undefined}>
            <textarea id="b" ref={area} className="textarea textarea-alta" rows={12} value={bodyText} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {faltan.length > 0 && (
            <div data-testid="corchetes">
              <p className="small">{faltan.length === 1 ? 'Falta 1 dato por completar' : `Faltan ${faltan.length} datos por completar`} (se puede guardar así; no se puede publicar):</p>
              <div className="motivos-rapidos" role="group" aria-label="Datos por completar">
                {faltan.map((c) => <button key={c} type="button" className="chip" onClick={() => irA(c)}>{c}</button>)}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Líneas que entran y salen entre el texto vigente y el borrador (subsecuencia común más larga, por renglones). */
function diferencias(antes: string, despues: string): Array<{ tipo: 'igual' | 'mas' | 'menos'; texto: string }> {
  const a = antes.split('\n'); const b = despues.split('\n');
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const salida: Array<{ tipo: 'igual' | 'mas' | 'menos'; texto: string }> = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { salida.push({ tipo: 'igual', texto: a[i]! }); i++; j++; }
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) salida.push({ tipo: 'menos', texto: a[i++]! });
    else salida.push({ tipo: 'mas', texto: b[j++]! });
  }
  while (i < a.length) salida.push({ tipo: 'menos', texto: a[i++]! });
  while (j < b.length) salida.push({ tipo: 'mas', texto: b[j++]! });
  return salida;
}

/**
 * REVISAR Y PUBLICAR (21-07, 21-08): el texto completo (o lo que cambia contra
 * el vigente), lo que le falta y, en el aviso de privacidad, la lista que la
 * gerencia marca punto por punto. El servidor exige lo mismo: aquí solo se ve antes.
 */
function RevisarDialog({ doc, puedePublicar, pideFirma, onClose, onCorregir, onDone }: {
  doc: Doc; puedePublicar: boolean;
  /** Es el aviso de privacidad y quien lo revisa no es quien firma: «publicar» deja la solicitud a la dueña (D-25). */
  pideFirma: boolean;
  onClose: () => void; onCorregir: () => void; onDone: (r: ConsentDocumentPublishResult) => Promise<void>;
}) {
  const toast = useToast();
  const carga = useCarga(useCallback(() => api<ConsentDocumentReview>(`/consent-documents/${doc.id}/review`), [doc.id]));
  const r = carga.datos;
  const [marcados, setMarcados] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [verCambios, setVerCambios] = useState(true);
  const cambios = useMemo(() => (r?.current ? diferencias(r.current.bodyText, r.bodyText) : null), [r]);
  const sinTratar = r?.checklist.filter((c) => !c.found) ?? [];
  const bloqueado = !!r && !r.publishable;
  const f = useFormulario({
    lista: !!r && r.checklist.length > 0 && marcados.length < r.checklist.length && 'Marca cada punto después de revisarlo en el texto',
    motivo: faltaMotivo(reason) && ERROR_MOTIVO,
  }, { obligatorios: ['motivo'] });

  async function publicar() {
    try {
      const hecho = await api<ConsentDocumentPublishResult>(`/consent-documents/${doc.id}/publish`, { method: 'POST', body: JSON.stringify({ reason: reason.trim(), ...(r && r.checklist.length > 0 ? { checklist: marcados } : {}) }) });
      await onDone(hecho);
    } catch (e) { toast('error', errorText(e)); }
  }
  const alternar = (k: string) => setMarcados((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));

  return (
    <Dialog open onClose={onClose} size="lg" title={`${pideFirma && puedePublicar ? 'Revisar y pedir la firma' : 'Revisar y publicar'} · ${CONSENT_TYPE[doc.consentType]} ${doc.version}`}
      sub={r?.current ? `Reemplaza a la versión ${r.current.version}, vigente desde el ${fecha(r.current.publishedAt)}.` : 'Es la primera versión de este texto.'}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button>
        {puedePublicar && bloqueado && <Button icon={<Pencil />} onClick={onCorregir}>Corregir el borrador</Button>}
        {puedePublicar && !bloqueado && <Button icon={<Lock />} loading={f.enviando} disabled={!r} onClick={() => void f.enviar(publicar)}>{pideFirma ? 'Pedir la firma de la dueña' : 'Publicar'}</Button>}
      </>}>
      {carga.error ? <ErrorCarga titulo="No se pudo cargar el borrador" mensaje={carga.error} onReintentar={() => void carga.recargar()} />
        : !r ? <Skeleton h={320} />
        : (
          <div className="revisar-texto" data-testid="revisar-texto">
            <div className="stack-sm">
              {cambios && (
                <label className="check">
                  <input type="checkbox" checked={verCambios} onChange={(e) => setVerCambios(e.target.checked)} />
                  <span>Marcar lo que cambia contra la versión {r.current!.version}</span>
                </label>
              )}
              <div className="doc">
                {cambios && verCambios
                  ? cambios.map((c, i) => <span key={i} className={`diff-linea${c.tipo === 'mas' ? ' diff-mas' : c.tipo === 'menos' ? ' diff-menos' : ''}`}>{c.texto || ' '}</span>)
                  : r.bodyText}
              </div>
            </div>
            <div className="stack">
              {r.placeholders.length > 0 && (
                <Callout tone="danger" title="Faltan datos entre [corchetes]">
                  {r.placeholders.join(' · ')}
                </Callout>
              )}
              {sinTratar.length > 0 && (
                <Callout tone="danger" title="Al aviso le falta contenido">
                  El texto no trata {sinTratar.length === 1 ? 'este punto' : 'estos puntos'}; corrige el borrador (el modelo de GymFlow los trae todos).
                </Callout>
              )}
              {r.checklist.length > 0 && (
                <div className="revisar-lista" role="group" aria-label="Lista de verificación del aviso" data-error={f.error('lista') ? '' : undefined}>
                  <p className="strong small">Lo que el aviso no puede dejar de decir</p>
                  {r.checklist.map((c) => (
                    <label key={c.key} className={`check${c.found ? '' : ' falta is-disabled'}`}>
                      <input type="checkbox" checked={marcados.includes(c.key)} disabled={!c.found || !puedePublicar} onChange={() => alternar(c.key)} />
                      <span>{c.text}{c.found ? '' : ' (el texto no lo dice)'}</span>
                    </label>
                  ))}
                  {f.error('lista') && <p className="field-error">{f.error('lista')}</p>}
                  <p className="tiny muted">No es asesoría legal: es lo mínimo. Marca cada punto después de leerlo en el texto.</p>
                </div>
              )}
              {puedePublicar && !bloqueado && (
                <>
                  <CampoMotivo id="mot" value={reason} onChange={setReason} error={f.error('motivo')}
                    motivos={r.current ? ['Actualización del texto', 'Corrección de un dato del gimnasio', 'Cambió la forma de tratar los datos'] : ['Primera publicación']} />
                  <Callout tone="warn" title="Publicar no tiene vuelta atrás">
                    El texto queda congelado{r.current ? ' y reemplaza a la versión vigente. Quien firmó la anterior conserva su firma sobre esa versión' : ''}.
                    {doc.consentType === 'BIOMETRIC' && <> Quien tiene rostro registrado aparecerá en su ficha como «debe volver a firmar» hasta que firme esta en recepción; su rostro sigue funcionando mientras tanto.</>}
                  </Callout>
                </>
              )}
              {!puedePublicar && <p className="small muted">Publicar lo hace quien tiene liberada la sección Textos de consentimiento.</p>}
            </div>
          </div>
        )}
    </Dialog>
  );
}

const ESTADO: Record<Doc['status'], string> = { DRAFT: 'Borrador', PUBLISHED: 'Vigente', RETIRED: 'Retirada' };

/** Todas las versiones de un tipo, con su periodo y cuántas firmas guarda cada una (21-07). */
function HistorialDialog({ tipo, docs, puedeRetirar, onClose, onLeer, onRetirado }: { tipo: string; docs: Doc[]; puedeRetirar: boolean; onClose: () => void; onLeer: (d: Doc) => void; onRetirado: () => Promise<void> }) {
  const toast = useToast();
  const [retirar, setRetirar] = useState<Doc | null>(null);
  const [reason, setReason] = useState('');
  const f = useFormulario({ motivo: faltaMotivo(reason) && ERROR_MOTIVO }, { obligatorios: ['motivo'] });
  async function retirarlo() {
    if (!retirar) return;
    try {
      await api(`/consent-documents/${retirar.id}/retire`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      await onRetirado();
    } catch (e) { toast('error', errorText(e)); }
  }
  if (retirar) {
    return (
      <Dialog open onClose={() => setRetirar(null)} size="sm" title={`Retirar · ${CONSENT_TYPE[tipo]} ${retirar.version}`} sub="Sin reemplazo: nadie más lo firma hasta que publiques otra versión. Las firmas que ya existen se conservan."
        footer={<><Button variant="secondary" onClick={() => setRetirar(null)} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(retirarlo)}>Retirar el texto</Button></>}>
        <CampoMotivo id="ret-t" value={reason} onChange={setReason} error={f.error('motivo')} autoFocus motivos={['Ya no se pide ese permiso', 'El texto tiene un error']} />
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} size="lg" title={`Historial · ${CONSENT_TYPE[tipo]}`} sub="Cada versión con su periodo y cuántas firmas la guardan. Lo publicado nunca se borra."
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <div className="table-wrap">
        <table className="table table-stack" data-testid="historial-textos">
          <thead><tr><th>Versión</th><th>Estado</th><th>Vigencia</th><th className="right">Firmas</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="strong"><code>{d.version}</code></td>
                <td>{d.status === 'PUBLISHED' ? <Badge tone="ok" dot>{ESTADO[d.status]}</Badge> : <Badge>{ESTADO[d.status]}</Badge>}</td>
                <td className="muted">{d.publishedAt ? `${fecha(d.publishedAt)} – ${d.retiredAt ? fecha(d.retiredAt) : 'hoy'}` : 'Sin publicar'}</td>
                <td className="right num">{d.signatures}</td>
                <td className="right">
                  <div className="row wrap gap-6">
                    <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => onLeer(d)}>Leer</Button>
                    {puedeRetirar && d.status === 'PUBLISHED' && <Button size="sm" variant="danger-ghost" onClick={() => setRetirar(d)}>Retirar sin reemplazo</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

type SolicitudDeFirma = NoticeSignatureRequests['requests'][number];

/**
 * LA DUEÑA LEE Y FIRMA EL AVISO DE PRIVACIDAD (3.7 · D-25). El aviso no se
 * publica sin su firma: aquí lo lee completo, ve quién lo pidió y por qué, y
 * lo firma con su contraseña (se publica en ese momento) o dice que no, con
 * su motivo, y el borrador vuelve a la gerencia.
 */
function FirmarAvisoDialog({ solicitud, onClose, onDone }: { solicitud: SolicitudDeFirma; onClose: () => void; onDone: (mensaje: string) => Promise<void> }) {
  const texto = useCarga(useCallback(() => api<DocFull>(`/consent-documents/${solicitud.documentId}`), [solicitud.documentId]));
  const [clave, setClave] = useState('');
  const [noFirma, setNoFirma] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({
    clave: !noFirma && !clave && 'Escribe tu contraseña',
    motivo: noFirma && faltaMotivo(motivo) && ERROR_MOTIVO,
  });

  async function enviar() {
    setError(null);
    try {
      if (noFirma) {
        await api(`/consent-documents/${solicitud.documentId}/sign/reject`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
        await onDone('Quedó sin firmar. La gerencia verá tu motivo.');
      } else {
        await api<ConsentDocumentPublishResult>(`/consent-documents/${solicitud.documentId}/sign`, { method: 'POST', body: JSON.stringify({ password: clave }) });
        await onDone('Aviso de privacidad firmado y publicado. Las nuevas altas firman esta versión.');
      }
    } catch (e) { setError(errorText(e, noFirma ? 'No se pudo guardar' : 'No se pudo firmar')); }
  }

  return (
    <Dialog open onClose={onClose} size="lg" error={error} title={`Firmar el aviso de privacidad · versión ${solicitud.version}`}
      sub={`Lo pidió ${solicitud.requestedByName ?? 'la gerencia'} el ${fecha(solicitud.requestedAt)}: «${solicitud.reason}». Al firmarlo queda publicado y no se edita.`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button>
        <Button variant="ghost" onClick={() => { setNoFirma(!noFirma); setError(null); }} disabled={f.enviando}>{noFirma ? 'Volver a firmar' : 'No lo firmo'}</Button>
        <Button variant={noFirma ? 'danger' : 'primary'} icon={<FileSignature />} loading={f.enviando} disabled={!texto.datos} onClick={() => void f.enviar(enviar)}>{noFirma ? 'Devolver sin firmar' : 'Firmar y publicar'}</Button>
      </>}>
      {texto.error ? <ErrorCarga titulo="No se pudo cargar el aviso" mensaje={texto.error} onReintentar={() => void texto.recargar()} />
        : !texto.datos ? <Skeleton h={320} /> : (
          <div className="stack" data-testid="firmar-aviso">
            <div className="doc doc-lectura aviso-por-firmar">{texto.datos.bodyText}</div>
            {noFirma
              ? <CampoMotivo id="fa-m" value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="Qué hay que corregir antes de publicarlo" />
              : (
                <Field label="Tu contraseña" htmlFor="fa-c" hint="Es tu firma: queda en la bitácora quién lo pidió y que lo firmaste tú." error={f.error('clave')}>
                  <input id="fa-c" className="input" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />
                </Field>
              )}
          </div>
        )}
    </Dialog>
  );
}
