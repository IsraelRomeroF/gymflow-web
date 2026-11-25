'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileUp, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaHora } from '@gymflow/ui/format';
import { CAMPOS, ESTADO_IMPORTACION, leerArchivo, proponerColumnas, type Campo, type Tabla } from '@/lib/importar';
import { useSession, useToast, errorText } from '@/components/session';
import { hoyEn, zonaDe } from '@/lib/zonas';
import { descargarCsv } from '@/components/exportar';
import { Badge, Button, Callout, CampoFecha, Card, ErrorCarga, Field, PageHeader, EsqueletoTabla, irAlPrimerError } from '@/components/ui';

/** La plantilla (18-09): los encabezados que GymFlow reconoce solo y dos filas de ejemplo para borrar. */
function descargarPlantilla(): void {
  descargarCsv('plantilla-socios', [
    ['No. Socio', 'Nombre', 'Apellidos', 'Celular', 'Correo', 'Fecha de nacimiento', 'Sucursal', 'Fecha de alta', 'Saldo', 'Plan', 'Vigente hasta', 'Notas'],
    ['1042', 'María Guadalupe', 'Pérez Luna', '5512345678', 'lupita@correo.mx', '14/02/1990', 'Centro', '15/03/2021', '650.00', 'Mensualidad', '30/11/2026', 'Ejemplo: debe $650. Borra esta fila.'],
    ['1043', 'José Luis', 'Ramírez Soto', '5587654321', '', '', 'Centro', '01/08/2023', '-100.00', 'Anualidad', '31/07/2027', 'Ejemplo: tiene $100 a favor (saldo negativo). Borra esta fila.'],
  ]);
}

type Resumen = {
  id: string; fileName: string; status: 'REVIEW' | 'APPLIED' | 'CANCELED'; branchId: string; totalRows: number;
  createdAt: string; appliedAt: string | null; byDecision: Record<string, number>; applied: number;
};


/**
 * IMPORTAR SOCIOS (docs/09). La gerencia trae el padrón del sistema anterior:
 * sube el archivo, dice qué es cada columna, revisa los posibles duplicados y
 * aplica. Nada entra al padrón hasta ese último paso.
 */
export default function ImportarPage() {
  const [lista, setLista] = useState<Resumen[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const cargar = useCallback(() => {
    setFallo(null);
    api<{ imports: Resumen[] }>('/member-imports').then((r) => { setLista(r.imports); if (r.imports.length === 0) setNueva(true); })
      .catch((e) => setFallo(errorText(e, 'No se pudieron cargar las importaciones')));
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <div className="stack gap-24">
      <PageHeader title="Importar socios"
        sub="Trae el padrón de tu sistema anterior: cada persona se compara con los socios que ya tienes y entre las filas del mismo archivo. Lo dudoso lo decides tú antes de que entre nada."
        actions={!nueva ? <Button icon={<FileUp />} onClick={() => setNueva(true)}>Nueva importación</Button> : undefined} />
      {nueva && <NuevaImportacion onCancelar={lista && lista.length > 0 ? () => setNueva(false) : undefined} />}
      {fallo && <ErrorCarga mensaje={fallo} onReintentar={cargar} />}
      {!lista && !fallo && <div className="card"><EsqueletoTabla filas={3} columnas={4} /></div>}
      {lista && lista.length > 0 && (
        <Card title="Importaciones" pad={false} data-testid="importaciones">
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Archivo</th><th>Estado</th><th className="right">Filas</th><th>Fecha</th><th /></tr></thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Archivo"><Link href={`/importar/${i.id}`} className="strong">{i.fileName}</Link></td>
                    <td data-label="Estado">
                      <Badge tone={ESTADO_IMPORTACION[i.status].tone} dot>{ESTADO_IMPORTACION[i.status].label}</Badge>
                      {i.status === 'REVIEW' && (i.byDecision.PENDING ?? 0) > 0 && <span className="tiny muted"> · {i.byDecision.PENDING} por revisar</span>}
                    </td>
                    <td data-label="Filas" className="right num">{i.totalRows.toLocaleString('es-MX')}</td>
                    <td data-label="Fecha" className="small muted">{fechaHora(i.appliedAt ?? i.createdAt)}</td>
                    <td className="right"><Link href={`/importar/${i.id}`} className="small strong">{i.status === 'REVIEW' ? 'Revisar' : 'Ver'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function NuevaImportacion({ onCancelar }: { onCancelar: (() => void) | undefined }) {
  const router = useRouter();
  const toast = useToast();
  const { branches, inScope, org } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tabla, setTabla] = useState<Tabla | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [columnas, setColumnas] = useState<Array<Campo | null>>([]);
  // La fecha de corte ya no nace en «hoy» (18): es la del reporte de cartera, y un saldo con la fecha
  // equivocada no se corrige después. Tampoco se pide motivo aquí (18-07): el que vale es el de aplicar.
  const [f, setF] = useState(() => ({ branchId: sedes[0]?.id ?? '', cutoffDate: '' }));
  const hoySede = hoyEn(zonaDe(branches.find((b) => b.id === f.branchId), org));
  const [enviando, setEnviando] = useState(false);
  const [intentado, setIntentado] = useState(false);

  async function elegir(a: File) {
    setArchivo(a); setTabla(null); setErrorArchivo(null); setLeyendo(true);
    try {
      const t = await leerArchivo(a);
      setTabla(t);
      setColumnas(proponerColumnas(t.encabezados));
    } catch (e) {
      setErrorArchivo(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    } finally { setLeyendo(false); }
  }

  const usados = new Set(columnas.filter(Boolean));
  const tieneNombre = usados.has('fullName') || usados.has('firstName');
  const errores = {
    columnas: !tieneNombre ? 'Elige qué columna trae el nombre (completo o "Nombre(s)").' : undefined,
    cutoffDate: !f.cutoffDate ? 'Pon la fecha de corte: el día del último reporte de cartera del sistema anterior.' : f.cutoffDate > hoySede ? 'La fecha de corte no puede ser futura.' : undefined,
    branchId: !f.branchId ? 'Elige la sucursal.' : undefined,
  };
  const listo = !!tabla && !errores.columnas && !errores.cutoffDate && !errores.branchId;

  const muestra = useMemo(() => (tabla ? tabla.filas.slice(0, 3) : []), [tabla]);

  async function subir() {
    setIntentado(true);
    if (!tabla || !archivo || !listo) { irAlPrimerError(); return; }
    setEnviando(true);
    try {
      const rows = tabla.filas.map((fila, i) => {
        const fields: Record<string, string | number | null> = {};
        const raw: Record<string, string | number | null> = {};
        tabla.encabezados.forEach((h, j) => {
          const v = fila[j] ?? null;
          raw[h] = typeof v === 'string' ? v.slice(0, 500) : v;
          const campo = columnas[j];
          if (campo) fields[campo] = typeof v === 'string' ? v.slice(0, 500) : v;
        });
        return { rowNumber: i + 2, raw, fields };
      });
      const r = await api<{ id: string }>('/member-imports', {
        method: 'POST', body: JSON.stringify({ fileName: archivo.name, branchId: f.branchId, cutoffDate: f.cutoffDate, rows }),
      });
      router.push(`/importar/${r.id}`);
    } catch (e) {
      toast('error', errorText(e, 'No se pudo preparar la importación'));
      setEnviando(false);
    }
  }

  return (
    <Card title="1 · Archivo" sub="CSV o Excel (.xlsx) con una fila por socio y los encabezados en la primera fila. Después vienen los planes y las sucursales, la revisión y aplicar: nada entra al padrón hasta ese último paso." data-testid="nueva-importacion"
      actions={onCancelar ? <Button variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button> : undefined}>
      <div className="stack">
        <input ref={input} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden aria-label="Archivo de socios"
          onChange={(e) => { const a = e.target.files?.[0]; if (a) void elegir(a); e.target.value = ''; }} />
        <button type="button" className="importar-zona" onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const a = e.dataTransfer.files[0]; if (a) void elegir(a); }}>
          {archivo ? <FileSpreadsheet size={28} aria-hidden /> : <Upload size={28} aria-hidden />}
          <span className="strong">{archivo ? archivo.name : 'Elige el archivo o arrástralo aquí'}</span>
          <span className="small muted">
            {leyendo ? 'Leyendo…' : tabla ? `${tabla.filas.length.toLocaleString('es-MX')} filas · ${tabla.encabezados.length} columnas · toca para cambiarlo` : 'CSV (de cualquier sistema) o Excel .xlsx'}
          </span>
        </button>
        {errorArchivo && <Callout tone="danger">{errorArchivo}</Callout>}

        {tabla && (
          <>
            <div>
              <p className="label">¿Qué trae cada columna?</p>
              <p className="hint mb-8">Lo propusimos por el encabezado; corrige lo que no sea. Lo que marques "No importar" se guarda solo como referencia.</p>
              {intentado && errores.columnas && <p className="field-error mb-8" role="alert">{errores.columnas}</p>}
              <div className="table-wrap">
                {/* En el teléfono cada columna del archivo es un bloque: nombre, ejemplos y su selector a todo lo ancho (18-08). */}
                <table className="table importar-columnas">
                  <thead><tr><th>Columna del archivo</th><th>Ejemplos</th><th>Es…</th></tr></thead>
                  <tbody>
                    {tabla.encabezados.map((h, j) => (
                      <tr key={`${h}-${j}`}>
                        <td className="strong" data-label="Columna del archivo">{h}</td>
                        <td className="small muted" data-label="Ejemplos">{muestra.map((fila) => fila[j]).filter((v) => v !== null && String(v).trim() !== '').map(String).slice(0, 3).join(' · ') || '—'}</td>
                        <td>
                          <select className="select" aria-label={`Qué trae la columna ${h}`} value={columnas[j] ?? ''}
                            onChange={(e) => setColumnas((c) => c.map((x, k) => (k === j ? (e.target.value || null) as Campo | null : x === e.target.value ? null : x)))}>
                            <option value="">No importar</option>
                            {CAMPOS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid grid-2">
              <Field label="Sucursal de casa" htmlFor="imp-sede" required error={intentado ? errores.branchId : undefined} hint="Para quien no traiga una sucursal reconocible en el archivo.">
                <select id="imp-sede" className="select" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                  {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Fecha de corte" htmlFor="imp-corte" required error={intentado ? errores.cutoffDate : undefined}
                hint="El día del último reporte de cartera que imprimiste del sistema anterior: con esa fecha entran los saldos iniciales.">
                <CampoFecha id="imp-corte" className="campo-corto" max={hoySede} hoy={hoySede} value={f.cutoffDate} onChange={(v) => setF({ ...f, cutoffDate: v })} />
              </Field>
            </div>
            <div className="row justify-end">
              <Button icon={<FileUp />} loading={enviando} onClick={() => void subir()}>Revisar {tabla.filas.length.toLocaleString('es-MX')} filas</Button>
            </div>
          </>
        )}
        {!tabla && !errorArchivo && (
          // Una línea, no otro vacío que repite la zona de carga (UX7 Clases).
          <p className="small muted">
            Columnas que reconoce: nombre, celular, correo, código de socio, sucursal, fecha de alta, saldo, plan y vigencia. Las que falten no impiden importar; un saldo, una vigencia o una fecha de alta que no se entienda no se pierde: queda para que lo decidas.{' '}
            {/* Quien viene de un cuaderno o de Excel empieza por aquí (18-09). */}
            <button type="button" className="row-link strong importar-plantilla" onClick={descargarPlantilla}>Descargar la plantilla (CSV, se abre en Excel)</button>
          </p>
        )}
      </div>
    </Card>
  );
}
