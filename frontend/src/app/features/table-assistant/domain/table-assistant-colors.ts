export interface TableAssistantColorOption {
  id: string;
  label: string;
  gradient: string;
  accent: string;
  manaSymbols: readonly string[];
  manaText: string;
}

export const TABLE_ASSISTANT_COLOR_OPTIONS: readonly TableAssistantColorOption[] = [
  option('white', 'Blanco', ['w'], ['#fffdf0', '#fff176', '#f2c14f', '#fffdf0'], '#fff176'),
  option('blue', 'Azul', ['u'], ['#48b9e8', '#114f88'], '#70d6ff'),
  option('black', 'Negro', ['b'], ['#6f6572', '#08070a'], '#b4a7bb'),
  option('red', 'Rojo', ['r'], ['#f97355', '#8d1f18'], '#ff9277'),
  option('green', 'Verde', ['g'], ['#70c96f', '#145c2d'], '#8df08f'),
  option('azorius', 'Azorius', ['w', 'u'], ['#f5f0dc', '#48b9e8'], '#d7efff'),
  option('dimir', 'Dimir', ['u', 'b'], ['#48b9e8', '#08070a'], '#70d6ff'),
  option('rakdos', 'Rakdos', ['b', 'r'], ['#08070a', '#c83224'], '#ff7f70'),
  option('gruul', 'Gruul', ['r', 'g'], ['#d93b25', '#1d7a3c'], '#ff856c'),
  option('selesnya', 'Selesnya', ['g', 'w'], ['#2f9c4c', '#f5f0dc'], '#c4f7c8'),
  option('orzhov', 'Orzhov', ['w', 'b'], ['#f5f0dc', '#08070a'], '#f1e6d0'),
  option('izzet', 'Izzet', ['u', 'r'], ['#36a8df', '#c83224'], '#70d6ff'),
  option('golgari', 'Golgari', ['b', 'g'], ['#08070a', '#1d7a3c'], '#8df08f'),
  option('boros', 'Boros', ['r', 'w'], ['#d93b25', '#f5f0dc'], '#ffd1bd'),
  option('simic', 'Simic', ['g', 'u'], ['#1d7a3c', '#36a8df'], '#86f5dc'),
  option('esper', 'Esper', ['w', 'u', 'b'], ['#f5f0dc', '#36a8df', '#08070a'], '#d7efff'),
  option('grixis', 'Grixis', ['u', 'b', 'r'], ['#36a8df', '#08070a', '#c83224'], '#70d6ff'),
  option('jund', 'Jund', ['b', 'r', 'g'], ['#08070a', '#c83224', '#1d7a3c'], '#ff7f70'),
  option('naya', 'Naya', ['r', 'g', 'w'], ['#c83224', '#1d7a3c', '#f5f0dc'], '#ffe0a3'),
  option('bant', 'Bant', ['g', 'w', 'u'], ['#1d7a3c', '#f5f0dc', '#36a8df'], '#c4f7c8'),
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
  label: string,
  manaSymbols: readonly string[],
  stops: readonly string[],
  accent: string,
): TableAssistantColorOption {
  return {
    id,
    label,
    manaSymbols,
    manaText: manaSymbols.join('').toUpperCase(),
    gradient: `linear-gradient(135deg, ${stops.join(', ')})`,
    accent,
  };
}
