export interface TableAssistantColorOption {
  id: string;
  labelKey: string;
  gradient: string;
  accent: string;
  manaSymbols: readonly string[];
  manaText: string;
}

export const TABLE_ASSISTANT_COLOR_OPTIONS: readonly TableAssistantColorOption[] = [
  option('white', 'shared.text.white', ['w'], ['#fffdf0', '#fff176', '#f2c14f', '#fffdf0'], '#fff176'),
  option('blue', 'shared.text.blue', ['u'], ['#48b9e8', '#114f88'], '#70d6ff'),
  option('black', 'shared.text.black', ['b'], ['#6f6572', '#08070a'], '#b4a7bb'),
  option('red', 'shared.text.red', ['r'], ['#f97355', '#8d1f18'], '#ff9277'),
  option('green', 'shared.text.green', ['g'], ['#70c96f', '#145c2d'], '#8df08f'),
  option('azorius', 'common.ui.colorAzorius', ['w', 'u'], ['#f5f0dc', '#48b9e8'], '#d7efff'),
  option('dimir', 'common.ui.colorDimir', ['u', 'b'], ['#48b9e8', '#08070a'], '#70d6ff'),
  option('rakdos', 'common.ui.colorRakdos', ['b', 'r'], ['#08070a', '#c83224'], '#ff7f70'),
  option('gruul', 'common.ui.colorGruul', ['r', 'g'], ['#d93b25', '#1d7a3c'], '#ff856c'),
  option('selesnya', 'common.ui.colorSelesnya', ['g', 'w'], ['#2f9c4c', '#f5f0dc'], '#c4f7c8'),
  option('orzhov', 'common.ui.colorOrzhov', ['w', 'b'], ['#f5f0dc', '#08070a'], '#f1e6d0'),
  option('izzet', 'common.ui.colorIzzet', ['u', 'r'], ['#36a8df', '#c83224'], '#70d6ff'),
  option('golgari', 'common.ui.colorGolgari', ['b', 'g'], ['#08070a', '#1d7a3c'], '#8df08f'),
  option('boros', 'common.ui.colorBoros', ['r', 'w'], ['#d93b25', '#f5f0dc'], '#ffd1bd'),
  option('simic', 'common.ui.colorSimic', ['g', 'u'], ['#1d7a3c', '#36a8df'], '#86f5dc'),
  option('esper', 'common.ui.colorEsper', ['w', 'u', 'b'], ['#f5f0dc', '#36a8df', '#08070a'], '#d7efff'),
  option('grixis', 'common.ui.colorGrixis', ['u', 'b', 'r'], ['#36a8df', '#08070a', '#c83224'], '#70d6ff'),
  option('jund', 'common.ui.colorJund', ['b', 'r', 'g'], ['#08070a', '#c83224', '#1d7a3c'], '#ff7f70'),
  option('naya', 'common.ui.colorNaya', ['r', 'g', 'w'], ['#c83224', '#1d7a3c', '#f5f0dc'], '#ffe0a3'),
  option('bant', 'common.ui.colorBant', ['g', 'w', 'u'], ['#1d7a3c', '#f5f0dc', '#36a8df'], '#c4f7c8'),
];

const FALLBACK_COLOR = TABLE_ASSISTANT_COLOR_OPTIONS[0];
const LEGACY_COLOR_ALIASES: Record<string, string> = {
  yellow: 'white',
  purple: 'dimir',
  orange: 'red',
};

export function tableAssistantColorOption(colorId: string): TableAssistantColorOption {
  const normalizedColorId = LEGACY_COLOR_ALIASES[colorId] ?? colorId;

  return TABLE_ASSISTANT_COLOR_OPTIONS.find((option) => option.id === normalizedColorId) ?? FALLBACK_COLOR;
}

function option(
  id: string,
  labelKey: string,
  manaSymbols: readonly string[],
  stops: readonly string[],
  accent: string,
): TableAssistantColorOption {
  return {
    id,
    labelKey,
    manaSymbols,
    manaText: manaSymbols.join('').toUpperCase(),
    gradient: `linear-gradient(135deg, ${stops.join(', ')})`,
    accent,
  };
}
