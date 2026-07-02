interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export type TooltipTextColor = '#000000' | '#ffffff';

export function tooltipTextColorForBackground(secondaryRgb: string, secondary: string): TooltipTextColor | null {
  const backgroundColor = parseRgbChannels(secondaryRgb) ?? parseCssColor(secondary);

  return backgroundColor ? contrastingTextColor(backgroundColor) : null;
}

function contrastingTextColor(backgroundColor: RgbColor): TooltipTextColor {
  const luminance = relativeLuminance(backgroundColor);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

function relativeLuminance(color: RgbColor): number {
  const red = linearRgbChannel(color.red);
  const green = linearRgbChannel(color.green);
  const blue = linearRgbChannel(color.blue);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearRgbChannel(channel: number): number {
  const normalized = channel / 255;

  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function parseRgbChannels(value: string): RgbColor | null {
  const channels = value
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((channel) => Number(channel));

  if (channels.length !== 3 || channels.some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return {
    red: clampRgbChannel(channels[0]),
    green: clampRgbChannel(channels[1]),
    blue: clampRgbChannel(channels[2]),
  };
}

function parseCssColor(value: string): RgbColor | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hexMatch = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    return parseHexColor(hexMatch[1]);
  }

  const rgbMatch = /^rgba?\((.+)\)$/i.exec(trimmed);
  if (!rgbMatch) {
    return null;
  }

  return parseRgbChannels(rgbMatch[1]);
}

function parseHexColor(hex: string): RgbColor {
  const normalizedHex = hex.length === 3
    ? hex.split('').map((character) => `${character}${character}`).join('')
    : hex;

  return {
    red: parseInt(normalizedHex.slice(0, 2), 16),
    green: parseInt(normalizedHex.slice(2, 4), 16),
    blue: parseInt(normalizedHex.slice(4, 6), 16),
  };
}

function clampRgbChannel(channel: number): number {
  return Math.min(255, Math.max(0, channel));
}
