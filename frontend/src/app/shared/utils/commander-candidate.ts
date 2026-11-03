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
  const front = card.cardFaces?.[0];
  const frontType = (front?.typeLine ?? card.typeLine?.split('//')[0] ?? '').toLowerCase();
  const power = front?.power ?? card.power;
  const toughness = front?.toughness ?? card.toughness;
  const hasLegendaryArtifactType = /\blegendary\b/.test(frontType) && (
    /\bvehicle\b/.test(frontType)
    || (/\bspacecraft\b/.test(frontType) && !!power?.trim() && !!toughness?.trim())
  );

  return hasLegendaryCreatureType || hasCommanderExceptionText || hasLegendaryArtifactType;
}
