import { UserDisplayNameStyle } from '../models/user.model';

export type DisplayNameStyleTier = 'basic' | 'premium';

export interface DisplayNameStylePreset {
  readonly id: string;
  readonly tier: DisplayNameStyleTier;
  readonly assetPath?: string;
}

export const DEFAULT_DISPLAY_NAME_STYLE_ID = 'plain';
export const DEFAULT_PREMIUM_NAME_COLOR = '#f8f0d0';
const BASIC_NAMEPLATE_IDS = [
  'plain',
  'basic-colorless',
  'basic-silver',
  'basic-green',
  'basic-blue',
  'basic-black',
  'basic-plains',
  'basic-mountain',
] as const;

const BASIC_NAMEPLATE_ASSETS: Partial<Record<(typeof BASIC_NAMEPLATE_IDS)[number], string>> = {
  'basic-colorless': 'basic-colorless',
  'basic-silver': 'basic-silver',
  'basic-green': 'basic-green',
  'basic-blue': 'basic-blue',
  'basic-black': 'basic-black',
  'basic-plains': 'basic-plains',
  'basic-mountain': 'basic-mountain',
};
const LEGACY_BASIC_NAMEPLATE_FALLBACKS: Record<string, (typeof BASIC_NAMEPLATE_IDS)[number]> = {
  'copper-adventurer': 'basic-mountain',
  'emerald-warden': 'basic-green',
  'arcane-apprentice': 'basic-blue',
  'crimson-vanguard': 'basic-black',
  'moonstone-initiate': 'basic-silver',
};

const PREMIUM_NAMEPLATE_IDS = [
  'obsidian-crown',
  'astral-veil',
  'ember-forge',
  'jade-serpent',
  'frost-runeblade',
  'sanguine-royal',
  'storm-vault',
  'solar-edict',
  'void-amethyst',
  'iron-warden',
  'oceanic-oracle',
  'gilded-thorn',
  'lunar-sentinel',
  'crimson-engine',
  'arcane-prism',
  'necrosteel-relic',
  'sapphire-comet',
  'radiant-halo',
  'umbral-rose',
  'chronomancer',
] as const;

export const DISPLAY_NAME_STYLE_PRESETS: readonly DisplayNameStylePreset[] = [
  ...BASIC_NAMEPLATE_IDS.map((id) => basicNameplate(id)),
  ...PREMIUM_NAMEPLATE_IDS.map((id) => premiumNameplate(id)),
];

export function displayNameStylePreset(style: UserDisplayNameStyle | null | undefined): DisplayNameStylePreset {
  const presetId = style?.presetId ?? DEFAULT_DISPLAY_NAME_STYLE_ID;
  const legacyBasicPreset = LEGACY_BASIC_NAMEPLATE_FALLBACKS[presetId];

  if (legacyBasicPreset) {
    return basicNameplate(legacyBasicPreset);
  }

  return DISPLAY_NAME_STYLE_PRESETS.find((preset) => preset.id === presetId) ?? DISPLAY_NAME_STYLE_PRESETS[0];
}

function basicNameplate(id: (typeof BASIC_NAMEPLATE_IDS)[number]): DisplayNameStylePreset {
  const asset = BASIC_NAMEPLATE_ASSETS[id];

  return {
    id,
    tier: 'basic',
    assetPath: asset ? `assets/images/nameplates/${asset}.png` : undefined,
  };
}

function premiumNameplate(id: string): DisplayNameStylePreset {
  return {
    id,
    tier: 'premium',
    assetPath: `assets/images/nameplates/${id}.png`,
  };
}
