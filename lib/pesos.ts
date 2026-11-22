/** "650", "650.5", "1,200.00" → centavos; cualquier otra cosa → null. Una sola regla para todos los campos de dinero. */
export function parsePesos(texto: string): bigint | null {
  const limpio = texto.trim().replace(/[$,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(limpio);
  return m ? BigInt(m[1]!) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0')) : null;
}

/** Centavos → texto editable ("650.00"). */
export function textoPesos(cents: bigint | string | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (Number(BigInt(cents)) / 100).toFixed(2);
}
