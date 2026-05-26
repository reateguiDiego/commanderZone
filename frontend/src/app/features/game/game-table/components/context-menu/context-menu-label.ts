export function contextMenuDisplayLabel(label: string): string {
  const lowerLabel = label.toLocaleLowerCase();

  return lowerLabel
    .replace(/^(\s*)(\S)/u, (_match, leadingSpace: string, firstCharacter: string) =>
      `${leadingSpace}${firstCharacter.toLocaleUpperCase()}`)
    .replace(/(^|\s)x(?=\s|$)/g, '$1X');
}
