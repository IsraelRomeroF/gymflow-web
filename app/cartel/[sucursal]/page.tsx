'use client';

import { use, useEffect, useState } from 'react';
import { Smartphone, ClipboardCheck, ConciergeBell, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { enlaceAlta, usePortalUrl } from '@/lib/portal';
import { Qr } from '@/components/qr';
import { Callout, Marca } from '@/components/compartido';
import { direccionInestable } from '@/components/alta-enlace';

/**
 * Cartel para imprimir y pegar en recepción o en la puerta.
 *
 * Tamaño carta, blanco y negro legible: se imprime en la impresora de la
 * oficina, no en una imprenta. No pide sesión —usa el mismo formulario
 * público que abre el teléfono— para que cualquiera pueda reimprimirlo.
 *
 * Bloque 2.4: una sucursal que no existe (o con las altas apagadas) ya no
 * imprime un cartel sin nombre con un QR a una página de error (9-12); y si
 * la dirección del QR no sirve fuera del gimnasio, lo avisa en pantalla
 * antes de imprimir (9-11). El aviso no sale en el papel.
 */
export default function CartelPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal } = use(params);
  const portal = usePortalUrl();
  const [estado, setEstado] = useState<{ sede: string; gimnasio: string; abierto: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = enlaceAlta(portal, sucursal);

  useEffect(() => {
    setEstado(null); setError(null);
    api<{ branchName: string; gymName: string; blockedBy: unknown[] }>(`/intake/${sucursal}/form`)
      .then((f) => setEstado({ sede: f.branchName, gimnasio: f.gymName, abierto: f.blockedBy.length === 0 }))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el cartel'));
  }, [sucursal]);

  if (error) {
    // Sin QR: un cartel con un código que lleva a un error es peor que no tener cartel.
    return (
      <div className="cartel-fondo">
        <main className="cartel" data-testid="cartel-sin-sede">
          <h1 className="cartel-titulo">No hay cartel<br />para este enlace</h1>
          <p className="cartel-sub">{error}</p>
          <p className="cartel-url">Ábrelo desde Altas digitales → «Formulario de alta» → «Imprimir cartel».</p>
        </main>
      </div>
    );
  }

  return (
    <div className="cartel-fondo">
      {(direccionInestable(url) || (estado && !estado.abierto)) && (
        <div className="cartel-aviso" data-testid="cartel-aviso">
          <Callout tone="danger" title={estado && !estado.abierto ? 'Este formulario todavía no recibe altas' : 'No lo imprimas todavía'}>
            {estado && !estado.abierto
              ? 'Faltan textos de consentimiento por publicar: quien escanee el código verá «Todavía no disponible».'
              : 'La dirección del código es de este equipo o cambia al reiniciar: impresa, dejará de servir.'}
          </Callout>
        </div>
      )}
      <button className="btn btn-primary cartel-imprimir" disabled={!estado} onClick={() => window.print()}><Printer />Imprimir</button>
      <main className="cartel">
        <div className="cartel-marca">
          <span className="brand-mark"><Marca size={22} /></span>
          {/* La marca del gimnasio, no la del proveedor (UXB-14). */}
          <span>{estado?.gimnasio ?? ''}{estado?.sede ? ` · ${estado.sede}` : ''}</span>
        </div>
        <h1 className="cartel-titulo">Inscríbete desde<br />tu celular</h1>
        <p className="cartel-sub">Sin llenar papeles ni esperar en el mostrador.</p>
        <div className="cartel-qr"><Qr value={url} size={330} /></div>
        <ol className="cartel-pasos">
          <li><Smartphone /><span><strong>Escanea</strong> el código con la cámara</span></li>
          <li><ClipboardCheck /><span><strong>Llena</strong> tus datos en 2 minutos</span></li>
          <li><ConciergeBell /><span><strong>Pasa a recepción</strong> a elegir tu plan</span></li>
        </ol>
        <p className="cartel-url">{url.replace(/^https?:\/\//, '')}</p>
      </main>
    </div>
  );
}
