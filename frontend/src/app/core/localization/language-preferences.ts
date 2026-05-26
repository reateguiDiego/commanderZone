import { publicAssetUrl } from '../assets/app-image-url';

export const SUPPORTED_LANGUAGE_CODES = ['en', 'fr', 'de', 'it', 'es', 'ja', 'zhs', 'pt', 'ru', 'ko', 'zht', 'nl', 'ca'] as const;
export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGE_CODES[number];
export const DEFAULT_LANGUAGE_CODE: SupportedLanguageCode = 'en';

export interface LanguageOption {
  readonly code: SupportedLanguageCode;
  readonly label: string;
  readonly flagAsset: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'es', label: 'Espanol', flagAsset: publicAssetUrl('assets/icons/flags/spain.png') },
  { code: 'fr', label: 'Frances', flagAsset: publicAssetUrl('assets/icons/flags/france.png') },
  { code: 'en', label: 'Ingles', flagAsset: publicAssetUrl('assets/icons/flags/uk.png') },
  { code: 'de', label: 'Aleman', flagAsset: publicAssetUrl('assets/icons/flags/germany.png') },
  { code: 'it', label: 'Italiano', flagAsset: publicAssetUrl('assets/icons/flags/italy.png') },
  { code: 'pt', label: 'Portugues', flagAsset: publicAssetUrl('assets/icons/flags/portugal.png') },
  { code: 'ja', label: 'Japones', flagAsset: publicAssetUrl('assets/icons/flags/japan.png') },
  { code: 'zhs', label: 'Chino (S)', flagAsset: publicAssetUrl('assets/icons/flags/china.png') },
  { code: 'zht', label: 'Chino (T)', flagAsset: publicAssetUrl('assets/icons/flags/china.png') },
  { code: 'ru', label: 'Ruso', flagAsset: publicAssetUrl('assets/icons/flags/uk.png') },
  { code: 'ko', label: 'Coreano', flagAsset: publicAssetUrl('assets/icons/flags/japan.png') },
  { code: 'nl', label: 'Holandes', flagAsset: publicAssetUrl('assets/icons/flags/holand.png') },
  { code: 'ca', label: 'Catalan', flagAsset: publicAssetUrl('assets/icons/flags/catalan.png') },
];

export function isSupportedLanguageCode(value: string | null | undefined): value is SupportedLanguageCode {
  return typeof value === 'string' && (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(value);
}

export function normalizeLanguageCode(value: string | null | undefined): SupportedLanguageCode {
  return isSupportedLanguageCode(value) ? value : DEFAULT_LANGUAGE_CODE;
}
