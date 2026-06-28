const ROOM_CODE_REGEX = /^(?:CZ[-\s]?)?([A-Fa-f0-9]{3})[-\s]?([A-Fa-f0-9]{3})[-\s]?([A-Fa-f0-9]{3})$/;

export function formatRoomCodeFromId(roomId: string): string {
  const compactId = roomId.replace(/-/g, '').slice(-9).toUpperCase();
  return formatRoomCodeGroups(compactId.slice(0, 3), compactId.slice(3, 6), compactId.slice(6, 9));
}

export function normalizeRoomCodeInput(value: string): string | null {
  const match = value.trim().match(ROOM_CODE_REGEX);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  return formatRoomCodeGroups(match[1], match[2], match[3]);
}

export function isValidRoomCodeInput(value: string): boolean {
  return normalizeRoomCodeInput(value) !== null;
}

function formatRoomCodeGroups(first: string, second: string, third: string): string {
  return `CZ-${first.toUpperCase()}-${second.toUpperCase()}-${third.toUpperCase()}`;
}
