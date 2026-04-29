export interface TableAssistantColorOption {
  id: string;
  label: string;
  gradient: string;
  accent: string;
}

export const TABLE_ASSISTANT_COLOR_OPTIONS: readonly TableAssistantColorOption[] = [
  { id: 'white', label: 'Blanco', gradient: 'linear-gradient(135deg, #f8fafc, #facc15)', accent: '#f8fafc' },
  { id: 'blue', label: 'Azul', gradient: 'linear-gradient(135deg, #38bdf8, #1d4ed8)', accent: '#38bdf8' },
  { id: 'black', label: 'Negro', gradient: 'linear-gradient(135deg, #64748b, #020617)', accent: '#94a3b8' },
  { id: 'red', label: 'Rojo', gradient: 'linear-gradient(135deg, #fb7185, #dc2626)', accent: '#fb7185' },
  { id: 'green', label: 'Verde', gradient: 'linear-gradient(135deg, #86efac, #15803d)', accent: '#86efac' },
  { id: 'azorius', label: 'Azorius', gradient: 'linear-gradient(135deg, #f8fafc, #38bdf8)', accent: '#bae6fd' },
  { id: 'dimir', label: 'Dimir', gradient: 'linear-gradient(135deg, #38bdf8, #020617)', accent: '#38bdf8' },
  { id: 'rakdos', label: 'Rakdos', gradient: 'linear-gradient(135deg, #020617, #dc2626)', accent: '#f87171' },
  { id: 'gruul', label: 'Gruul', gradient: 'linear-gradient(135deg, #dc2626, #15803d)', accent: '#fb7185' },
  { id: 'selesnya', label: 'Selesnya', gradient: 'linear-gradient(135deg, #f8fafc, #15803d)', accent: '#bbf7d0' },
  { id: 'orzhov', label: 'Orzhov', gradient: 'linear-gradient(135deg, #f8fafc, #020617)', accent: '#e2e8f0' },
  { id: 'izzet', label: 'Izzet', gradient: 'linear-gradient(135deg, #38bdf8, #dc2626)', accent: '#38bdf8' },
  { id: 'golgari', label: 'Golgari', gradient: 'linear-gradient(135deg, #020617, #15803d)', accent: '#86efac' },
  { id: 'boros', label: 'Boros', gradient: 'linear-gradient(135deg, #f8fafc, #dc2626)', accent: '#fecaca' },
  { id: 'simic', label: 'Simic', gradient: 'linear-gradient(135deg, #38bdf8, #15803d)', accent: '#67e8f9' },
  { id: 'esper', label: 'Esper', gradient: 'linear-gradient(135deg, #f8fafc, #38bdf8, #020617)', accent: '#bfdbfe' },
  { id: 'grixis', label: 'Grixis', gradient: 'linear-gradient(135deg, #38bdf8, #020617, #dc2626)', accent: '#60a5fa' },
  { id: 'jund', label: 'Jund', gradient: 'linear-gradient(135deg, #020617, #dc2626, #15803d)', accent: '#f87171' },
  { id: 'naya', label: 'Naya', gradient: 'linear-gradient(135deg, #dc2626, #f8fafc, #15803d)', accent: '#fde68a' },
  { id: 'bant', label: 'Bant', gradient: 'linear-gradient(135deg, #f8fafc, #38bdf8, #15803d)', accent: '#bbf7d0' },
];

const FALLBACK_COLOR = TABLE_ASSISTANT_COLOR_OPTIONS[0];

export function tableAssistantColorOption(colorId: string): TableAssistantColorOption {
  return TABLE_ASSISTANT_COLOR_OPTIONS.find((option) => option.id === colorId) ?? FALLBACK_COLOR;
}
