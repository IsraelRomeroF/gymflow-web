/**
 * FECHAS, HORAS Y PESOS (26-06, D26-02). `lib/format.ts` es idéntico en el
 * portal (`pnpm test:tokens`), así que esta prueba cubre a los dos.
 * Se corre con `pnpm test` (node --test, sin dependencias nuevas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  antiguedad, haceTanto, comparar, concepto, dia, diaLargo, escribirFecha, escribirHora, fecha, fechaCorta, fechaHora,
  fechaNumerica, fijarZona, hace, hora, hora12, hoyEn, leerFecha, leerHora, masDias, nombreMes, pesos, zonaActiva,
} from './format.ts';

test('la hora se pinta en la zona del gimnasio, no en la de la computadora', () => {
  const entrada = '2026-11-19T14:00:00Z';
  fijarZona('America/Mexico_City');
  assert.equal(hora(entrada), '08:00');
  fijarZona('America/Tijuana');
  assert.equal(hora(entrada), '06:00');
  assert.equal(hora(entrada, 'America/Cancun'), '09:00', 'una sucursal con su propia zona la pasa explícita');
  fijarZona(null);
  assert.equal(zonaActiva(), undefined);
});

test('una zona que no existe no rompe nada: vuelve a la de la computadora', () => {
  fijarZona('Zona/Inventada');
  assert.equal(zonaActiva(), undefined);
  assert.doesNotThrow(() => hora('2026-11-19T14:00:00Z'));
});

test('la fecha de un instante cerca de la medianoche es la del gimnasio', () => {
  const nocheDeJueves = '2026-11-20T05:30:00Z'; // 23:30 del jueves 19 en CDMX
  fijarZona('America/Mexico_City');
  assert.equal(fecha(nocheDeJueves), '19 nov 2026');
  assert.equal(fechaCorta(nocheDeJueves), '19 nov');
  assert.equal(fechaHora(nocheDeJueves), '19 nov · 23:30');
  fijarZona('UTC');
  assert.equal(fecha(nocheDeJueves), '20 nov 2026');
  fijarZona(null);
});

test('una fecha de calendario nunca se mueve de día, en ninguna zona', () => {
  for (const zona of ['America/Tijuana', 'America/Mexico_City', 'UTC', 'Pacific/Kiritimati']) {
    fijarZona(zona);
    assert.equal(fecha('2026-09-01'), '1 sep 2026', zona);
    assert.equal(dia('2026-11-19', { weekday: 'long', day: 'numeric', month: 'long' }), 'jueves, 19 de noviembre', zona);
  }
  fijarZona(null);
  assert.equal(fecha(null), '—');
  assert.equal(diaLargo('2026-11-19'), 'Jueves, 19 de noviembre');
  assert.equal(nombreMes('2026-11'), 'noviembre de 2026');
});

test('hoy es el del gimnasio (misma cuenta que el servidor)', () => {
  const ahora = new Date('2026-11-20T05:30:00Z');
  assert.equal(hoyEn('America/Mexico_City', ahora), '2026-11-19');
  assert.equal(hoyEn('UTC', ahora), '2026-11-20');
  fijarZona('America/Mexico_City');
  assert.equal(hoyEn(undefined, ahora), '2026-11-19', 'sin zona explícita, la fijada');
  fijarZona(null);
  assert.equal(masDias('2026-11-30', 1), '2026-12-01');
  assert.equal(masDias('2026-03-01', -1), '2026-02-28');
});

test('D26-02: la fecha se escribe y se lee día/mes/año, sin importar el idioma del equipo', () => {
  assert.equal(fechaNumerica('2026-11-09'), '09/11/2026');
  const validas: Array<[string, string]> = [
    ['19/11/2026', '2026-11-19'], ['1/3/2024', '2024-03-01'], ['19-11-2026', '2026-11-19'], ['19.11.2026', '2026-11-19'],
    ['19 11 2026', '2026-11-19'], ['19112026', '2026-11-19'], ['2026-11-19', '2026-11-19'], [' 29/02/2028 ', '2028-02-29'],
  ];
  for (const [texto, iso] of validas) assert.equal(leerFecha(texto), iso, texto);
  // «10/09/2026» es el 10 de septiembre, nunca el 9 de octubre.
  assert.equal(leerFecha('10/09/2026'), '2026-09-10');
  for (const mala of ['31/02/2026', '29/02/2027', '19/11/26', '', '00/11/2026', '19/13/2026', '11/19/2026', 'mañana']) assert.equal(leerFecha(mala), null, mala);
});

test('mientras se escribe, la fecha se acomoda sola como dd/mm/aaaa', () => {
  const casos: Array<[string, string]> = [
    ['1', '1'], ['19', '19'], ['191', '19/1'], ['1911', '19/11'], ['19112', '19/11/2'], ['19112026', '19/11/2026'],
    ['191120267', '19/11/2026'], ['19/', '19/'], ['1/', '01/'], ['1/3/', '01/03/'], ['1/3/2024', '01/03/2024'],
    ['19/112026', '19/11/2026'], ['/19', '19'], ['01/0', '01/0'], ['2026-11-19', '2026-11-19'],
  ];
  for (const [tecleado, queda] of casos) assert.equal(escribirFecha(tecleado), queda, tecleado);
});

test('la hora se lee de 24 o de 12 y se guarda como HH:MM', () => {
  const casos: Array<[string, string | null]> = [
    ['18:30', '18:30'], ['1830', '18:30'], ['630', '06:30'], ['6:30 pm', '18:30'], ['6:30pm', '18:30'], ['6:30 p. m.', '18:30'],
    ['6:30 a.m.', '06:30'], ['6 pm', '18:00'], ['12 am', '00:00'], ['12 pm', '12:00'], ['7', '07:00'],
    ['183', null], ['24:00', null], ['13 pm', null], ['6:60', null], ['', null],
  ];
  for (const [texto, hhmm] of casos) assert.equal(leerHora(texto), hhmm, texto);
  assert.deepEqual(['1', '18', '183', '1830', '6', '63', '630', '255', '0130', '6:30'].map(escribirHora), ['1', '18', '18:3', '18:30', '6', '6:3', '6:30', '2:55', '01:30', '6:30']);
  assert.deepEqual(['18:30', '00:05', '12:00', 'x'].map(hora12), ['6:30 pm', '12:05 am', '12:00 pm', '']);
});

test('antigüedad desde una fecha o desde días (panel y portal usan la misma)', () => {
  assert.deepEqual([1, 0, 59, 400, 800].map((d) => antiguedad(d)), ['1 día', '0 días', '59 días', '13 meses', '2 años']);
  assert.equal(antiguedad('2024-11-19', new Date('2026-11-19T12:00:00Z')), '2 años');
  // Bloque 4.16: con antigüedad de cero, «hoy» y no «hace 0 días».
  assert.deepEqual([0, 1, 400].map((d) => haceTanto(d)), ['hoy', 'hace 1 día', 'hace 13 meses']);
  assert.equal(hace('2026-11-19T11:59:40Z', new Date('2026-11-19T12:00:00Z')), 'justo ahora');
  assert.equal(hace('2026-11-18T12:00:00Z', new Date('2026-11-19T12:00:00Z')), 'ayer');
});

test('lo que ya se arregló en la fase 0 se queda: concepto con el último día cubierto (D2) y pesos', () => {
  assert.equal(concepto('Mensualidad · 2026-11-19 a 2026-12-19'), 'Mensualidad · 19 nov – 18 dic');
  assert.equal(pesos('-123456'), '-$1,234.56');
  assert.deepEqual(comparar(250000n, 100000n, 'ayer'), { texto: '$1,500 más que ayer', tono: 'ok' });
  assert.equal(comparar(105000n, 100000n, 'ayer').tono, 'neutral', 'menos de 10 % o de $500 no se pinta');
});
