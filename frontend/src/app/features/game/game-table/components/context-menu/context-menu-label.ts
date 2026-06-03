import { runtimeTranslationFallback } from '../../../../../core/localization/runtime-translate.pipe';

export function contextMenuDisplayLabel(label: string): string {
  const translatedLabel = runtimeTranslationFallback(label);
  const lowerLabel = translatedLabel.toLocaleLowerCase();

  return lowerLabel
    .replace(/^(\s*)(\S)/u, (_match, leadingSpace: string, firstCharacter: string) =>
      `${leadingSpace}${firstCharacter.toLocaleUpperCase()}`)
    .replace(/(^|\s)x(?=\s|$)/g, '$1X');
}
