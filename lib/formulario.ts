'use client';

/*
 * FORMULARIO CON SUS ERRORES — panel y portal (auditoría 8, 26-02).
 *
 * Este archivo es IDÉNTICO en gymflow-web y gymflow-portal
 * (`lib/formulario.ts`); `pnpm test:tokens` falla si difieren. Para
 * cambiarlo: edítalo en uno, cópialo al otro y actualiza su huella en los dos
 * `scripts/tokens-iguales.mjs`. Solo depende de React.
 *
 * UNA SOLA MANERA DE VALIDAR, la que ya usaba la plataforma: el botón
 * principal queda ENCENDIDO; al pulsarlo con algo faltante, cada campo dice
 * qué le falta (borde rojo y el mensaje debajo) y el foco va al primero. Solo
 * se apaga mientras envía. Antes, 73 pies apagaban el botón sin decir por qué
 * («Registrar» gris en «Nuevo prospecto») y quien capturaba con prisa no
 * sabía qué faltaba; el asterisco salía en unos formularios y en otros no.
 *
 *   const f = useFormulario({
 *     nombre: !nombre.trim() && 'Escribe su nombre.',
 *     motivo: motivo.trim().length < 3 && 'Escribe el motivo: queda en la bitácora.',
 *   }, { obligatorios: ['nombre', 'motivo'] });
 *   <Field label="Nombre" htmlFor="n" {...f.campo('nombre')}>…</Field>
 *   <Button loading={f.enviando} onClick={() => void f.enviar(guardar)}>Guardar</Button>
 *
 * Los errores se calculan en cada render con lo que hay en pantalla; el
 * gancho decide CUÁNDO se muestran (después del primer intento) y lleva el
 * foco. Lo que dice el servidor de un campo (`marcar`) se muestra en el acto.
 */

import { useRef, useState } from 'react';

/** Un mensaje por campo; vacío, `false`, `null` o `undefined` = sin error. */
export type Errores<C extends string = string> = Partial<Record<C, string | false | null | undefined>>;

export type Formulario<C extends string> = {
  /** Ya se intentó enviar: desde ahí cada campo muestra su error. */
  intentado: boolean;
  /** Se está enviando: el principal lleva su giro (`loading`) y no acepta otro clic. */
  enviando: boolean;
  /** ¿Algún campo tiene error ahora mismo? (aunque todavía no se muestre). */
  hayErrores: boolean;
  /** El error de ESE campo: el del servidor, o el propio después del primer intento (antes nadie regaña). */
  error: (campo: C) => string | null;
  /** Lo que se le pasa a `<Field>`: `required` (el asterisco, si se declaró obligatorio) y `error`. */
  campo: (campo: C) => { required: boolean; error: string | null };
  /**
   * Intenta enviar. Con errores, los marca, lleva al primero y devuelve
   * `false`; sin errores, corre `accion` con «enviando» y devuelve `true`.
   * Lo que `accion` lance sigue su camino: cada pantalla dice el error a su manera.
   */
  enviar: (accion: () => unknown) => Promise<boolean>;
  /** Errores por campo que devolvió el servidor (p. ej. «ese celular ya está registrado»). */
  marcar: (delServidor: Errores<C>) => void;
  /** Quita el error del servidor de un campo cuando se corrige (UX5-G-03). */
  limpiar: (campo: C) => void;
  /** Vuelve a empezar (otra persona, otro paso): nada marcado. */
  reiniciar: () => void;
};

// `NoInfer`: los nombres de los campos salen de `errores`; `obligatorios` solo puede nombrar a esos.
export function useFormulario<C extends string>(errores: Errores<C>, opciones: { obligatorios?: readonly NoInfer<C>[] } = {}): Formulario<C> {
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [delServidor, setDelServidor] = useState<Errores<C>>({});
  // Dos clics seguidos llegan antes de que «enviando» se pinte: el segundo no cuenta.
  const enCurso = useRef(false);
  const hayErrores = Object.values(errores).some(Boolean);
  const error = (campo: C): string | null => delServidor[campo] || (intentado && errores[campo]) || null;
  return {
    intentado, enviando, hayErrores, error,
    campo: (campo) => ({ required: opciones.obligatorios?.includes(campo) ?? false, error: error(campo) }),
    async enviar(accion) {
      if (enCurso.current) return false;
      setIntentado(true);
      setDelServidor({});
      if (hayErrores) { irAlPrimerError(); return false; }
      enCurso.current = true;
      setEnviando(true);
      try { await accion(); return true; } finally { enCurso.current = false; setEnviando(false); }
    },
    marcar(e) { setDelServidor(e); if (Object.values(e).some(Boolean)) irAlPrimerError(); },
    limpiar(campo) { setDelServidor((x) => (x[campo] ? { ...x, [campo]: undefined } : x)); },
    reiniciar() { setIntentado(false); setDelServidor({}); },
  };
}

/**
 * Lleva al primer campo con error del diálogo abierto (UX7 Plataforma 7-8):
 * al pulsar el botón principal con algo faltante, el error no queda fuera de
 * la vista. Sirve con `useFormulario` y con el patrón `intentado` + `Field error`.
 */
export function irAlPrimerError(): void {
  // Dos cuadros: el primero deja que React pinte el error recién marcado.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const campo = document.querySelector<HTMLElement>('[role="dialog"] [data-error="true"] :is(input, select, textarea, button)')
      ?? document.querySelector<HTMLElement>('[data-error="true"] :is(input, select, textarea, button)');
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  }));
}
