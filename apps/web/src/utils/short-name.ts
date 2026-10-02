/**
 * CEO touch-up batch 4, item 5: the shorter forms of a player's name, longest first, for tight spaces:
 * "Sibulele Obakhe Mbande" -> ["Sibulele Obakhe Mbande", "Sibulele M.", "Sibulele"]. Single names give one form.
 */
export function nameVariants(displayName: string): string[] {
  const full = displayName.trim().replace(/\s+/g, ' ');
  const parts = full.split(' ');
  if (parts.length < 2) return [full];
  const first = parts[0]!;
  const lastInitial = parts.at(-1)!.charAt(0).toUpperCase();
  return [...new Set([full, `${first} ${lastInitial}.`, first])];
}
