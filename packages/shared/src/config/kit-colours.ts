/**
 * Batch 5 brief, B1 (CEO D17): the colours football kits actually come in. A team picks its kit colours from this
 * list by name; there is no custom colour, hex field, RGB field or eyedropper. Colours are still stored as hex
 * (Team.primaryColor / secondaryColor), but players only ever see a swatch and its name.
 */
export const KIT_COLOURS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Black', hex: '#111111' },
  { name: 'Grey', hex: '#8A8F98' },
  { name: 'Red', hex: '#D7262E' },
  { name: 'Maroon', hex: '#7A1F2B' },
  { name: 'Orange', hex: '#F26B1D' },
  { name: 'Gold', hex: '#C9A227' },
  { name: 'Yellow', hex: '#FFD400' },
  { name: 'Lime', hex: '#A3D936' },
  { name: 'Green', hex: '#1E8E3E' },
  { name: 'Dark green', hex: '#0B5D2A' },
  { name: 'Sky blue', hex: '#6CB4EE' },
  { name: 'Royal blue', hex: '#1F4EB4' },
  { name: 'Navy', hex: '#14213D' },
  { name: 'Purple', hex: '#5B2A86' },
  { name: 'Pink', hex: '#EC5FA0' },
  { name: 'Brown', hex: '#6B4226' },
  { name: 'Cream', hex: '#F2E8CF' },
] as const;

export type KitColour = (typeof KIT_COLOURS)[number];
export type KitColourHex = KitColour['hex'];

/** A new team starts in green and white (CEO D17). */
export const DEFAULT_KIT_PRIMARY: KitColourHex = '#1E8E3E';
export const DEFAULT_KIT_SECONDARY: KitColourHex = '#FFFFFF';

/** Below this contrast ratio the two kit colours are hard to tell apart (a warning, never a block). */
export const KIT_SIMILAR_CONTRAST = 1.5;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export const isKitColour = (value: string) => KIT_COLOURS.some(({ hex }) => hex === value.toUpperCase());

/** The kit colour with this exact hex, if any. */
export const kitColourByHex = (value: string | null | undefined): KitColour | undefined =>
  value ? KIT_COLOURS.find(({ hex }) => hex === value.toUpperCase()) : undefined;

const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string) {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** True when the two kit colours are the same or too close to tell apart. */
export const kitColoursTooSimilar = (a: string, b: string) => a.toUpperCase() === b.toUpperCase() || contrastRatio(a, b) < KIT_SIMILAR_CONTRAST;

/** Black or white text, whichever reads better on this background. */
export const readableTextOn = (hex: string): '#111111' | '#FFFFFF' =>
  contrastRatio(hex, '#111111') >= contrastRatio(hex, '#FFFFFF') ? '#111111' : '#FFFFFF';

/** CIE L*a*b* (D65) of a #RRGGBB colour, for perceptual distance. */
function lab(hex: string) {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((value) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116)) as [number, number, number];
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])] as const;
}

/**
 * The kit colour that looks closest to any #RRGGBB colour (CIE76 distance in L*a*b*). Used once to move existing
 * teams onto the list, and as a display-time safety net for any colour that is not on it (CEO D17).
 */
export function nearestKitColour(value: string): KitColour {
  const exact = kitColourByHex(value);
  if (exact) return exact;
  if (!HEX.test(value)) return KIT_COLOURS.find(({ hex }) => hex === DEFAULT_KIT_PRIMARY)!;
  const target = lab(value);
  let best: KitColour = KIT_COLOURS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const colour of KIT_COLOURS) {
    const [l, a, b] = lab(colour.hex);
    const distance = (l - target[0]) ** 2 + (a - target[1]) ** 2 + (b - target[2]) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [colour, distance];
  }
  return best;
}
