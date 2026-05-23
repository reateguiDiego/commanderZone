import { Card } from '../../core/models/card.model';

export function isCommanderCandidate(card: Card): boolean {
  const typeLines = [
    card.typeLine ?? '',
    ...(card.cardFaces ?? []).map((face) => face.typeLine ?? ''),
  ].map((value) => value.toLowerCase());

  const oracleTexts = [
    card.oracleText ?? '',
    ...(card.cardFaces ?? []).map((face) => face.oracleText ?? ''),
  ].map((value) => value.toLowerCase());

  const hasLegendaryCreatureType = typeLines.some((typeLine) => (
    typeLine.includes('legendary') && typeLine.includes('creature')
  ));
  const hasCommanderExceptionText = oracleTexts.some((oracleText) => oracleText.includes('can be your commander'));

  return hasLegendaryCreatureType || hasCommanderExceptionText;
}
