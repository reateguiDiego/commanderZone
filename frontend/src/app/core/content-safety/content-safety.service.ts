import { Injectable, computed, signal } from '@angular/core';
import { Profanity } from '@2toad/profanity';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { CATALAN_PROFANITY_WORDS } from './catalan-profanity-words';
import { CATALAN_FALSE_POSITIVE_EXPRESSIONS } from './catalan-false-positive-expressions';
import { CORPUS_FALSE_POSITIVE_EXPRESSIONS } from './corpus-false-positive-expressions';
import { DUTCH_PROFANITY_WORDS } from './dutch-profanity-words';
import { ENGLISH_PROFANITY_WORDS } from './english-profanity-words';
import { normalizeContentSafetyText } from './content-safety-normalizer';
import { SPANISH_LATAM_PROFANITY_WORDS } from './spanish-latam-profanity-words';
import { SPANISH_PROFANITY_WORDS } from './spanish-profanity-words';
import { SUPPLEMENTAL_LANGUAGE_PROFANITY_WORDS } from './supplemental-language-profanity-words';

type ContentRestrictionReason = 'external-url' | 'prohibited-language';

const SEPARATED_LETTERS_PATTERN = /(?:^|[^\p{L}\p{N}])((?:[\p{L}\p{N}][._-]){2,}[\p{L}\p{N}])(?=$|[^\p{L}\p{N}])/gu;
const EXTERNAL_URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|www\.)[^\s<>"']*[\p{L}\p{N}][^\s<>"']*/iu;
const BARE_EXTERNAL_DOMAIN_PATTERN = /(?:^|[^\p{L}\p{N}_@])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?=$|[^\p{L}\p{N}_-])/giu;
const FILE_EXTENSION_SUFFIXES = new Set(['csv', 'gif', 'html', 'jpeg', 'jpg', 'json', 'md', 'pdf', 'png', 'svg', 'txt', 'webp', 'xml', 'zip']);
const OBFUSCATED_DOMAIN_PATTERN = /(?:^|[^\p{L}\p{N}_@])(?:\p{L}[\p{L}\p{N}-]*\s*(?:\[\.|\(\.|\{\.|\s+\.\s*|\s+(?:dot|punto)\s+)[\]\)}]?\s*)+\p{L}[\p{L}\p{N}-]*(?=$|[^\p{L}\p{N}_-])/iu;
const OBFUSCATED_PROTOCOL_PATTERN = /h(?:tt|xx)p(?:s)?\s*(?::|\[:\])\s*(?:\/|\\)\s*(?:\/|\\)\s*[\p{L}\p{N}\[]/iu;
const COMPACT_PROHIBITED_EXPRESSIONS: readonly string[] = [
  'filldeputa',
  'filhodeputa',
  'filsdepute',
  'figliodiputtana',
  'hijodeputa',
  'hurensohn',
  'motherfucker',
  'puta',
  'putamadre',
  'sonofabitch',
];
const COMPACT_REPEATED_CHARACTER_PATTERN = /(.)\1+/gu;
const NORMALIZED_COMPACT_PROHIBITED_EXPRESSIONS = COMPACT_PROHIBITED_EXPRESSIONS.map((expression) => expression.replace(COMPACT_REPEATED_CHARACTER_PATTERN, '$1'));
const ALLOWED_FALSE_POSITIVE_WORD_PATTERN = /(?<!\p{L})(?:debes|no|reputaci(?:on(?:es)?|onal(?:es)?)|(?:dis|am|em)put(?:a(?:s|r|ba(?:n)?|ndo|d[oa]s?|n|mos|is|re(?:mos)?|ria(?:s|mos)?|ra(?:s|mos)?|se(?:s|mos)?|cion(?:es)?)?|e(?:s|n|mos)?|o))(?!\p{L})/giu;
const SUPPORTED_LANGUAGE_CODES: readonly string[] = ['en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'pt', 'ru'];
const OBFUSCATION_SEPARATOR_PATTERN = '[\\s._*\\-\\u00AD\\u00B7\\u2027\\u2219\\u30FB]*';
const CUSTOM_PROFANITY_WORDS: readonly string[] = [
  ...CATALAN_PROFANITY_WORDS,
  ...DUTCH_PROFANITY_WORDS,
  ...ENGLISH_PROFANITY_WORDS,
  ...SPANISH_LATAM_PROFANITY_WORDS,
  ...SPANISH_PROFANITY_WORDS,
  ...SUPPLEMENTAL_LANGUAGE_PROFANITY_WORDS,
];
const NORMALIZED_CUSTOM_PROFANITY_WORDS = [...new Set(CUSTOM_PROFANITY_WORDS.map((word) => normalizeContentSafetyText(word)))];
const COMPACT_PROFANITY_PHRASES = NORMALIZED_CUSTOM_PROFANITY_WORDS
  .filter((word) => /\s/u.test(word))
  .map((word) => compactLettersAndNumbers(word));
const TYPO_PROFANITY_WORDS_BY_LENGTH = groupWordsByLength(
  NORMALIZED_CUSTOM_PROFANITY_WORDS
    .map((word) => compactLettersAndNumbers(word))
    .filter((word) => [...word].length >= 4),
);
const OBFUSCATED_PROFANITY_PATTERNS = [
  ...CUSTOM_PROFANITY_WORDS,
  ...NORMALIZED_CUSTOM_PROFANITY_WORDS,
].map((word) => createObfuscationPattern(word));
const OBFUSCATION_MARKER_PATTERN = /[\s._*\-\u00AD\u00B7\u2027\u2219\u30FB\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]|(.)\1/u;

@Injectable({ providedIn: 'root' })
export class ContentSafetyService {
  private readonly englishEvasionMatcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers,
  });
  private readonly filter = new Profanity({
    languages: [...SUPPORTED_LANGUAGE_CODES],
    unicodeWordBoundaries: true,
  });

  constructor() {
    this.filter.addWords([
      ...CUSTOM_PROFANITY_WORDS,
      ...NORMALIZED_CUSTOM_PROFANITY_WORDS,
    ]);
  }

  private readonly restrictionReason = signal<ContentRestrictionReason>('prohibited-language');

  readonly prohibitedContentModalOpen = signal(false);
  readonly prohibitedContentModalMessage = computed(() => this.restrictionReason() === 'external-url'
    ? 'contentSafety.modal.external-url-message'
    : 'contentSafety.modal.prohibited-language-message');

  hasProhibitedContent(value: string | null | undefined): boolean {
    if (value === undefined || value === null || value.trim() === '') {
      return false;
    }

    if (containsExternalUrl(value)) {
      this.restrictionReason.set('external-url');
      return true;
    }

    const languageCheckValue = this.removeAllowedFalsePositiveWords(value);
    const normalizedLanguageCheckValue = normalizeContentSafetyText(languageCheckValue);
    const hasProhibitedLanguage = this.englishEvasionMatcher.hasMatch(languageCheckValue)
      || this.filter.exists(languageCheckValue)
      || this.filter.exists(normalizedLanguageCheckValue)
      || this.hasObfuscatedProfanity(languageCheckValue)
      || this.hasObfuscatedProfanity(normalizedLanguageCheckValue)
      || this.hasProhibitedSeparatedLetters(languageCheckValue)
      || this.hasProhibitedCompactedExpression(languageCheckValue)
      || this.hasProhibitedTypo(languageCheckValue);

    if (hasProhibitedLanguage) {
      this.restrictionReason.set('prohibited-language');
    }

    return hasProhibitedLanguage;
  }

  hasProhibitedContentIn(values: readonly (string | null | undefined)[]): boolean {
    return values.some((value) => this.hasProhibitedContent(value));
  }

  showProhibitedContentModal(): void {
    this.prohibitedContentModalOpen.set(true);
  }

  dismissProhibitedContentModal(): void {
    this.prohibitedContentModalOpen.set(false);
  }

  private hasProhibitedSeparatedLetters(value: string): boolean {
    for (const match of value.matchAll(SEPARATED_LETTERS_PATTERN)) {
      const compacted = match[1].replace(/[._-]/g, '');
      if (this.filter.exists(compacted)) {
        return true;
      }
    }

    return false;
  }

  private hasObfuscatedProfanity(value: string): boolean {
    return OBFUSCATION_MARKER_PATTERN.test(value)
      && OBFUSCATED_PROFANITY_PATTERNS.some((pattern) => pattern.test(value));
  }

  private removeAllowedFalsePositiveWords(value: string): string {
    const normalizedValue = value
      .normalize('NFD')
      .replace(/\p{M}/gu, '');

    const normalizedExpression = normalizedValue.toLowerCase().trim();
    if (
      CATALAN_FALSE_POSITIVE_EXPRESSIONS.has(normalizedExpression)
      || CORPUS_FALSE_POSITIVE_EXPRESSIONS.has(value.toLowerCase().trim())
    ) {
      return '';
    }

    const valueWithoutSpanishExceptions = normalizedValue.replace(ALLOWED_FALSE_POSITIVE_WORD_PATTERN, '');

    return valueWithoutSpanishExceptions === normalizedValue
      ? value
      : valueWithoutSpanishExceptions;
  }

  private hasProhibitedCompactedExpression(value: string): boolean {
    const compacted = compactLettersAndNumbers(normalizeContentSafetyText(value))
      .replace(COMPACT_REPEATED_CHARACTER_PATTERN, '$1');

    return NORMALIZED_COMPACT_PROHIBITED_EXPRESSIONS.some((expression) => compacted.includes(expression))
      || COMPACT_PROFANITY_PHRASES.some((expression) => compacted.includes(expression));
  }

  private hasProhibitedTypo(value: string): boolean {
    const compactedValue = compactLettersAndNumbers(normalizeContentSafetyText(value));
    const compactedValueLength = [...compactedValue].length;
    if (compactedValueLength < 4) {
      return false;
    }

    return [
      ...getWordsWithLength(compactedValueLength - 1),
      ...getWordsWithLength(compactedValueLength),
      ...getWordsWithLength(compactedValueLength + 1),
    ].some((word) => isSingleDeletionOrAdjacentTransposition(compactedValue, word));
  }
}

export function containsExternalUrl(value: string): boolean {
  const normalizedValue = value
    .normalize('NFKC')
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, '')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/%3a/giu, ':')
    .replace(/%2f/giu, '/')
    .replace(/\\\//gu, '/');

  return EXTERNAL_URL_PATTERN.test(normalizedValue)
    || containsBareExternalDomain(normalizedValue)
    || OBFUSCATED_PROTOCOL_PATTERN.test(normalizedValue)
    || OBFUSCATED_DOMAIN_PATTERN.test(normalizedValue);
}

function containsBareExternalDomain(value: string): boolean {
  for (const match of value.matchAll(BARE_EXTERNAL_DOMAIN_PATTERN)) {
    const domain = match[0].trim().toLowerCase().replace(/[.,!?;:]+$/u, '');
    const suffix = domain.slice(domain.lastIndexOf('.') + 1);

    if (!FILE_EXTENSION_SUFFIXES.has(suffix)) {
      return true;
    }
  }

  return false;
}

function compactLettersAndNumbers(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, '');
}

function groupWordsByLength(words: readonly string[]): ReadonlyMap<number, readonly string[]> {
  const wordsByLength = new Map<number, string[]>();

  for (const word of new Set(words)) {
    const length = [...word].length;
    wordsByLength.set(length, [...(wordsByLength.get(length) ?? []), word]);
  }

  return wordsByLength;
}

function getWordsWithLength(length: number): readonly string[] {
  return TYPO_PROFANITY_WORDS_BY_LENGTH.get(length) ?? [];
}

function isSingleDeletionOrAdjacentTransposition(value: string, candidate: string): boolean {
  const valueCharacters = [...value];
  const candidateCharacters = [...candidate];
  const lengthDifference = valueCharacters.length - candidateCharacters.length;

  if (Math.abs(lengthDifference) > 1) {
    return false;
  }

  if (lengthDifference !== 0) {
    const longer = lengthDifference > 0 ? valueCharacters : candidateCharacters;
    const shorter = lengthDifference > 0 ? candidateCharacters : valueCharacters;
    let longerIndex = 0;
    let shorterIndex = 0;
    let skippedCharacter = false;

    while (longerIndex < longer.length && shorterIndex < shorter.length) {
      if (longer[longerIndex] === shorter[shorterIndex]) {
        longerIndex += 1;
        shorterIndex += 1;
      } else if (skippedCharacter) {
        return false;
      } else {
        skippedCharacter = true;
        longerIndex += 1;
      }
    }

    return true;
  }

  const mismatches = valueCharacters
    .map((character, index) => character === candidateCharacters[index] ? -1 : index)
    .filter((index) => index !== -1);

  return mismatches.length === 2
    && mismatches[1] === mismatches[0] + 1
    && valueCharacters[mismatches[0]] === candidateCharacters[mismatches[1]]
    && valueCharacters[mismatches[1]] === candidateCharacters[mismatches[0]];
}

function createObfuscationPattern(expression: string): RegExp {
  const letters = [...expression].filter((character) => /\p{L}|\p{N}/u.test(character));
  const pattern = letters
    .map((character) => `${escapeRegularExpression(character)}+`)
    .join(OBFUSCATION_SEPARATOR_PATTERN);

  return new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, 'iu');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
