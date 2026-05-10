import { publicAssetUrl } from '../../../../core/assets/app-image-url';

export type PresetAvatarTier = 'basic' | 'premium';

export interface PresetAvatar {
  readonly id: string;
  readonly label: string;
  readonly imageUrl: string;
  readonly displayUrl: string;
  readonly tier: PresetAvatarTier;
}

const PRESET_AVATAR_DEFINITIONS = [
  { id: 'arcane-duelist', label: 'Arcane Duelist', imageUrl: 'assets/images/avatars/arcane-duelist.png', tier: 'basic' },
  { id: 'storm-seer', label: 'Storm Seer', imageUrl: 'assets/images/avatars/storm-seer.png', tier: 'basic' },
  { id: 'verdant-warden', label: 'Verdant Warden', imageUrl: 'assets/images/avatars/verdant-warden.png', tier: 'basic' },
  { id: 'rune-knight', label: 'Rune Knight', imageUrl: 'assets/images/avatars/rune-knight.png', tier: 'basic' },
  { id: 'ember-marshal', label: 'Ember Marshal', imageUrl: 'assets/images/avatars/ember-marshal.png', tier: 'basic' },
  { id: 'moonlit-necromancer', label: 'Moonlit Necromancer', imageUrl: 'assets/images/avatars/moonlit-necromancer.png', tier: 'basic' },
  { id: 'black-clad-mage', label: 'Black-Clad Mage', imageUrl: 'assets/images/avatars/black-clad-mage.png', tier: 'basic' },
  { id: 'friendly-robot', label: 'Friendly Robot', imageUrl: 'assets/images/avatars/friendly-robot.png', tier: 'basic' },
  { id: 'ironroot-boar', label: 'Ironroot Boar', imageUrl: 'assets/images/avatars/ironroot-boar.png', tier: 'basic' },
  { id: 'elderwood-ent', label: 'Elderwood Ent', imageUrl: 'assets/images/avatars/elderwood-ent.png', tier: 'basic' },
  { id: 'shadow-necromancer', label: 'Shadow Necromancer', imageUrl: 'assets/images/avatars/shadow-necromancer.png', tier: 'premium' },
  { id: 'serpent-assassin', label: 'Serpent Assassin', imageUrl: 'assets/images/avatars/serpent-assassin.png', tier: 'premium' },
  { id: 'wandering-blade', label: 'Wandering Blade', imageUrl: 'assets/images/avatars/wandering-blade.png', tier: 'premium' },
  { id: 'abyssal-overlord', label: 'Abyssal Overlord', imageUrl: 'assets/images/avatars/abyssal-overlord.png', tier: 'premium' },
  { id: 'radiant-paladin', label: 'Radiant Paladin', imageUrl: 'assets/images/avatars/radiant-paladin.png', tier: 'premium' },
  { id: 'porcelain-priestess', label: 'Porcelain Priestess', imageUrl: 'assets/images/avatars/porcelain-priestess.png', tier: 'premium' },
  { id: 'chaos-court-mage', label: 'Chaos Court Mage', imageUrl: 'assets/images/avatars/chaos-court-mage.png', tier: 'premium' },
  { id: 'rootbound-dryad', label: 'Rootbound Dryad', imageUrl: 'assets/images/avatars/rootbound-dryad.png', tier: 'premium' },
  { id: 'leonine-champion', label: 'Leonine Champion', imageUrl: 'assets/images/avatars/leonine-champion.png', tier: 'premium' },
  { id: 'spectral-dragon-sage', label: 'Spectral Dragon Sage', imageUrl: 'assets/images/avatars/spectral-dragon-sage.png', tier: 'premium' },
  { id: 'emerald-prophet', label: 'Emerald Prophet', imageUrl: 'assets/images/avatars/emerald-prophet.png', tier: 'premium' },
  { id: 'temporal-scholar', label: 'Temporal Scholar', imageUrl: 'assets/images/avatars/temporal-scholar.png', tier: 'premium' },
  { id: 'mind-illusionist', label: 'Mind Illusionist', imageUrl: 'assets/images/avatars/mind-illusionist.png', tier: 'premium' },
  { id: 'dragonblood-shaman', label: 'Dragonblood Shaman', imageUrl: 'assets/images/avatars/dragonblood-shaman.png', tier: 'premium' },
  { id: 'wild-beastmaster', label: 'Wild Beastmaster', imageUrl: 'assets/images/avatars/wild-beastmaster.png', tier: 'premium' },
  { id: 'tidecaller-oracle', label: 'Tidecaller Oracle', imageUrl: 'assets/images/avatars/tidecaller-oracle.png', tier: 'premium' },
  { id: 'nightblade-agent', label: 'Nightblade Agent', imageUrl: 'assets/images/avatars/nightblade-agent.png', tier: 'premium' },
  { id: 'elder-dragon-tyrant', label: 'Elder Dragon Tyrant', imageUrl: 'assets/images/avatars/elder-dragon-tyrant.png', tier: 'premium' },
  { id: 'moonlit-vampire', label: 'Moonlit Vampire', imageUrl: 'assets/images/avatars/moonlit-vampire.png', tier: 'premium' },
  { id: 'crimson-patriarch', label: 'Crimson Patriarch', imageUrl: 'assets/images/avatars/crimson-patriarch.png', tier: 'premium' },
  { id: 'golden-lawkeeper', label: 'Golden Lawkeeper', imageUrl: 'assets/images/avatars/golden-lawkeeper.png', tier: 'premium' },
  { id: 'sky-law-artificer', label: 'Sky-Law Artificer', imageUrl: 'assets/images/avatars/sky-law-artificer.png', tier: 'premium' },
  { id: 'sunlit-archon', label: 'Sunlit Archon', imageUrl: 'assets/images/avatars/sunlit-archon.png', tier: 'premium' },
  { id: 'living-metal-sage', label: 'Living Metal Sage', imageUrl: 'assets/images/avatars/living-metal-sage.png', tier: 'premium' },
  { id: 'volcanic-forger', label: 'Volcanic Forger', imageUrl: 'assets/images/avatars/volcanic-forger.png', tier: 'premium' },
  { id: 'nightmare-oracle', label: 'Nightmare Oracle', imageUrl: 'assets/images/avatars/nightmare-oracle.png', tier: 'premium' },
  { id: 'hawk-wildwarden', label: 'Hawk Wildwarden', imageUrl: 'assets/images/avatars/hawk-wildwarden.png', tier: 'premium' },
  { id: 'infernal-noble', label: 'Infernal Noble', imageUrl: 'assets/images/avatars/infernal-noble.png', tier: 'premium' },
  { id: 'moonstone-seer', label: 'Moonstone Seer', imageUrl: 'assets/images/avatars/moonstone-seer.png', tier: 'premium' },
  { id: 'obsidian-geomancer', label: 'Obsidian Geomancer', imageUrl: 'assets/images/avatars/obsidian-geomancer.png', tier: 'premium' },
] as const;

export const PRESET_AVATARS: readonly PresetAvatar[] = PRESET_AVATAR_DEFINITIONS.map((avatar) => ({
  ...avatar,
  displayUrl: publicAssetUrl(avatar.imageUrl),
}));
