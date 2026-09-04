import { publicAssetUrl } from '../../../../core/assets/app-image-url';

export type PresetAvatarTier = 'basic' | 'premium';

export interface PresetAvatar {
  readonly id: string;
  readonly labelKey: string;
  readonly imageUrl: string;
  readonly displayUrl: string;
  readonly tier: PresetAvatarTier;
}

const PRESET_AVATAR_DEFINITIONS = [
  { id: 'arcane-duelist', imageUrl: 'assets/images/avatars/arcane-duelist.png', tier: 'basic' },
  { id: 'storm-seer', imageUrl: 'assets/images/avatars/storm-seer.png', tier: 'basic' },
  { id: 'verdant-warden', imageUrl: 'assets/images/avatars/verdant-warden.png', tier: 'basic' },
  { id: 'rune-knight', imageUrl: 'assets/images/avatars/rune-knight.png', tier: 'basic' },
  { id: 'ember-marshal', imageUrl: 'assets/images/avatars/ember-marshal.png', tier: 'basic' },
  { id: 'moonlit-necromancer', imageUrl: 'assets/images/avatars/moonlit-necromancer.png', tier: 'basic' },
  { id: 'black-clad-mage', imageUrl: 'assets/images/avatars/black-clad-mage.png', tier: 'basic' },
  { id: 'friendly-robot', imageUrl: 'assets/images/avatars/friendly-robot.png', tier: 'basic' },
  { id: 'ironroot-boar', imageUrl: 'assets/images/avatars/ironroot-boar.png', tier: 'basic' },
  { id: 'elderwood-ent', imageUrl: 'assets/images/avatars/elderwood-ent.png', tier: 'basic' },
  { id: 'shadow-necromancer', imageUrl: 'assets/images/avatars/shadow-necromancer.png', tier: 'premium' },
  { id: 'serpent-assassin', imageUrl: 'assets/images/avatars/serpent-assassin.png', tier: 'premium' },
  { id: 'wandering-blade', imageUrl: 'assets/images/avatars/wandering-blade.png', tier: 'premium' },
  { id: 'abyssal-overlord', imageUrl: 'assets/images/avatars/abyssal-overlord.png', tier: 'premium' },
  { id: 'radiant-paladin', imageUrl: 'assets/images/avatars/radiant-paladin.png', tier: 'premium' },
  { id: 'porcelain-priestess', imageUrl: 'assets/images/avatars/porcelain-priestess.png', tier: 'premium' },
  { id: 'chaos-court-mage', imageUrl: 'assets/images/avatars/chaos-court-mage.png', tier: 'premium' },
  { id: 'rootbound-dryad', imageUrl: 'assets/images/avatars/rootbound-dryad.png', tier: 'premium' },
  { id: 'leonine-champion', imageUrl: 'assets/images/avatars/leonine-champion.png', tier: 'premium' },
  { id: 'spectral-dragon-sage', imageUrl: 'assets/images/avatars/spectral-dragon-sage.png', tier: 'premium' },
  { id: 'emerald-prophet', imageUrl: 'assets/images/avatars/emerald-prophet.png', tier: 'premium' },
  { id: 'temporal-scholar', imageUrl: 'assets/images/avatars/temporal-scholar.png', tier: 'premium' },
  { id: 'mind-illusionist', imageUrl: 'assets/images/avatars/mind-illusionist.png', tier: 'premium' },
  { id: 'dragonblood-shaman', imageUrl: 'assets/images/avatars/dragonblood-shaman.png', tier: 'premium' },
  { id: 'wild-beastmaster', imageUrl: 'assets/images/avatars/wild-beastmaster.png', tier: 'premium' },
  { id: 'tidecaller-oracle', imageUrl: 'assets/images/avatars/tidecaller-oracle.png', tier: 'premium' },
  { id: 'nightblade-agent', imageUrl: 'assets/images/avatars/nightblade-agent.png', tier: 'premium' },
  { id: 'elder-dragon-tyrant', imageUrl: 'assets/images/avatars/elder-dragon-tyrant.png', tier: 'premium' },
  { id: 'moonlit-vampire', imageUrl: 'assets/images/avatars/moonlit-vampire.png', tier: 'premium' },
  { id: 'crimson-patriarch', imageUrl: 'assets/images/avatars/crimson-patriarch.png', tier: 'premium' },
  { id: 'golden-lawkeeper', imageUrl: 'assets/images/avatars/golden-lawkeeper.png', tier: 'premium' },
  { id: 'sky-law-artificer', imageUrl: 'assets/images/avatars/sky-law-artificer.png', tier: 'premium' },
  { id: 'sunlit-archon', imageUrl: 'assets/images/avatars/sunlit-archon.png', tier: 'premium' },
  { id: 'living-metal-sage', imageUrl: 'assets/images/avatars/living-metal-sage.png', tier: 'premium' },
  { id: 'volcanic-forger', imageUrl: 'assets/images/avatars/volcanic-forger.png', tier: 'premium' },
  { id: 'nightmare-oracle', imageUrl: 'assets/images/avatars/nightmare-oracle.png', tier: 'premium' },
  { id: 'hawk-wildwarden', imageUrl: 'assets/images/avatars/hawk-wildwarden.png', tier: 'premium' },
  { id: 'infernal-noble', imageUrl: 'assets/images/avatars/infernal-noble.png', tier: 'premium' },
  { id: 'moonstone-seer', imageUrl: 'assets/images/avatars/moonstone-seer.png', tier: 'premium' },
  { id: 'obsidian-geomancer', imageUrl: 'assets/images/avatars/obsidian-geomancer.png', tier: 'premium' },
] as const;

export const PRESET_AVATARS: readonly PresetAvatar[] = PRESET_AVATAR_DEFINITIONS.map((avatar) => ({
  ...avatar,
  labelKey: `settings.settingsAvatarEditor.presetAvatar.${avatar.id}`,
  displayUrl: publicAssetUrl(avatar.imageUrl),
}));
