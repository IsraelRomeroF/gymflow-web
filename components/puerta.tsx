'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EyeOff, Lock, PowerOff } from 'lucide-react';
import { fecha } from '@/lib/format';
import { respuestaDePuerta, seccionDeRuta } from '@/modules/registro';
import { cargarModulos, type Modulo } from '@/modules/api';
import { useSession } from './session';
import { ButtonLink, Empty } from './ui';

/**
 * LA PUERTA DE CADA PANTALLA (ADR-036).
 *
 * Antes, lo único que impedía entrar a una sección era que el menú no la
 * mostrara: quien llegaba por un enlace guardado veía una pantalla rota o,
 * peor, un vacío falso ("Sin personal", "Todavía no hay rutinas"). Ahora toda
 * ruta pasa por aquí y hay respuestas honestas, siempre dentro del panel: el
 * gimnasio no usa esa sección, tu rol no la ve, o el dueño no te la ha
 * liberado. El puesto se mira ANTES que la llave (27-06): pedirle al dueño una
 * pantalla que tu puesto nunca trae solo genera pedidos imposibles.
 *
 * Es comodidad, no seguridad: quien manda es la API, que rechaza lo mismo.
 */
export function Puerta({ children }: { children: ReactNode }) {
  const { mirada, activo, activoEn, sedesSin, branches } = useSession();
  const seccion = seccionDeRuta(usePathname());
  if (!seccion) return <>{children}</>;
  if (!activo(seccion.modulo)) {
    // Encendido en el gimnasio pero no en ninguna sede de esta persona.
    if (activoEn(seccion.modulo, null)) {
      const sin = sedesSin(seccion.modulo);
      const con = branches.filter((b) => b.isActive && activoEn(seccion.modulo, b.id)).map((b) => b.name);
      return (
        <Empty
          icon={<PowerOff />}
          title={`${seccion.etiqueta} no se usa en ${new Intl.ListFormat('es', { type: 'conjunction' }).format(sin)}`}
          text={con.length > 0 ? `Se usa en ${new Intl.ListFormat('es', { type: 'conjunction' }).format(con)}.` : 'Ninguna sucursal lo usa hoy.'}
          action={<ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>}
        />
      );
    }
    return <ModuloApagado modulo={seccion.modulo} etiqueta={seccion.etiqueta} />;
  }
  const respuesta = respuestaDePuerta(seccion, mirada);
  if (respuesta === 'llave' || respuesta === 'quitada') {
    const quitada = respuesta === 'quitada';
    return (
      <Empty
        icon={<Lock />}
        title={quitada ? 'El dueño quitó esta pantalla a tu cuenta' : 'Esta pantalla la libera el dueño'}
        text={quitada
          ? `${seccion.etiqueta} viene con tu puesto, pero el dueño decidió que tú no la lleves. Si la necesitas para tu trabajo, pídesela.`
          : `${seccion.etiqueta} es para ${seccion.paraQuien}, y además la ve solo quien el dueño decide. Si la necesitas para tu trabajo, pídesela.`}
        action={<ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>}
      />
    );
  }
  if (respuesta === 'puesto') {
    return (
      <Empty
        icon={<EyeOff />}
        title="Tu rol no ve esta pantalla"
        // A la dueña no se le promete el Tablero (1-08, 9-13, 10-11, 15-01):
        // ni las altas, ni los prospectos, ni la retención, ni los textos
        // legales salen ahí (D-24: el Tablero se queda como hoy).
        text={mirada.roles.includes('OWNER')
          ? `La pantalla ${seccion.etiqueta} la lleva tu gerencia. Si necesitas saber algo de aquí, pregúntale a ella.`
          : `${seccion.etiqueta} es para ${seccion.paraQuien}. Si la necesitas, pídeselo a la gerencia.`}
        action={<ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>}
      />
    );
  }
  return <>{children}</>;
}

function ModuloApagado({ modulo, etiqueta }: { modulo: string; etiqueta: string }) {
  const { org, canOrg, me } = useSession();
  const [detalle, setDetalle] = useState<Modulo | null>(null);
  useEffect(() => {
    cargarModulos().then((r) => setDetalle(r.modules.find((m) => m.key === modulo) ?? null)).catch(() => undefined);
  }, [modulo]);

  const nombre = detalle?.name ?? etiqueta;
  const cambio = detalle?.lastChange && !detalle.lastChange.enabled ? detalle.lastChange : null;
  const administra = canOrg('settings:org');
  const consulta = me.roleKeys?.includes('OWNER');
  return (
    <Empty
      icon={<PowerOff />}
      title={`${nombre} está apagado en ${org.tradeName}`}
      text={(
        <>
          {cambio && <>{cambio.byName ?? 'La gerencia'} lo apagó el {fecha(cambio.at)}.{cambio.reason ? ` «${cambio.reason}»` : ''}<br /></>}
          No se borró nada: lo que había se conserva.
          {!administra && !consulta && <><br />Si lo necesitas, pídeselo al dueño.</>}
        </>
      )}
      action={(
        <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
          {(administra || consulta) && <Link href="/modulos" className="btn btn-primary">{administra ? `Encender ${nombre}` : 'Ver Módulos'}</Link>}
          <ButtonLink href="/panel" variant="secondary">Ir a Inicio</ButtonLink>
        </span>
      )}
    />
  );
}
