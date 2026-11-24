/**
 * BIOMETRÍA EN EL PANEL (auditoría 8, bloque 2.3). Antes era un solo archivo
 * de 735 líneas (`components/biometria.tsx`) con tres diálogos, una captura
 * simulada y `SIN_EQUIPO` por `NODE_ENV` (6-17). Ahora:
 *
 *  · `pestana.tsx`            la pestaña «Cómo entra» de la ficha y su historial;
 *  · `registrar.tsx`          el asistente (comprobación previa, firma, captura) y «Actualizar»;
 *  · `captura-de-frente.tsx`  la cámara y la revisión de la captura;
 *  · `revocar.tsx`, `firmar.tsx`  revocar con motivo y volver a firmar el texto vigente.
 *
 * La cámara en sí (`useCamara`, `grabar`, `comprobarCamara`) sigue en
 * `components/camara-rostro.tsx`, que comparte con la Estación.
 */
export { BiometriaTab } from './pestana';
// Fase 3 · bloque 3.3 (D-06): la regla «entrar solo con rostro» del gimnasio, en la pantalla Biometría.
export { ReglaDelRostro } from './regla-del-rostro';
export { FirmarTextoVigenteDialog } from './firmar';
export type { Enrollment, FirmaPorRenovar } from './comun';
