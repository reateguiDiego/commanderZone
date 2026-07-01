import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withGlobalLoadingForFeature, withoutGlobalLoading } from '../loading/loading-context';
import { Card } from '../models/card.model';
import { CardImageResponse, CardResponse, DataResponse } from '../models/api-responses.model';
import { LanguagePreferencesService } from '../localization/language-preferences.service';

export interface CardSearchFilters {
  sort?: 'colors' | 'name_asc' | 'name_desc' | 'mana_value_asc' | 'mana_value_desc';
  commanderLegal?: boolean;
  colorIdentity?: string[];
  gameplayKind?: 'token' | 'emblem' | 'dungeon';
  type?: 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'battle' | 'land';
  types?: string[];
  subtypes?: string[];
  sets?: string[];
  rarities?: Array<'mythic' | 'rare' | 'uncommon' | 'common'>;
  colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  colorMatchMode?: 'all' | 'any' | 'exact';
  artifact?: boolean;
  land?: boolean;
  multicolor?: boolean;
  basic?: boolean;
  legendary?: boolean;
  oracleTextA?: string;
  oracleTextB?: string;
  oracleTextMode?: 'and' | 'or';
  manaValueMin?: number;
  manaValueMax?: number;
  manaCost?: string;
  powerMin?: number;
  powerMax?: number;
  toughnessMin?: number;
  toughnessMax?: number;
  includeVariablePower?: boolean;
  includeVariableToughness?: boolean;
  formats?: string[];
  tokenOnly?: boolean;
}

export const CARD_SEARCH_LIMIT = 500;

export interface CardSearchOption {
  code: string;
  name: string;
  aliases?: string[];
  cardCount?: number;
}

export interface CardSearchOptionsResponse {
  types: CardSearchOption[];
  subtypes: CardSearchOption[];
  sets: CardSearchOption[];
  rarities: CardSearchOption[];
  formats: CardSearchOption[];
}

@Injectable({ providedIn: 'root' })
export class CardsApi {
  private readonly http = inject(HttpClient);
  private readonly languagePreferences = inject(LanguagePreferencesService);

  search(query: string, page = 1, limit = CARD_SEARCH_LIMIT, filters: CardSearchFilters = {}): Observable<DataResponse<Card>> {
    let params = new HttpParams()
      .set('q', query)
      .set('page', page)
      .set('limit', limit)
      .set('lang', this.languagePreferences.cardLanguage());

    if (filters.commanderLegal !== undefined) {
      params = params.set('commanderLegal', String(filters.commanderLegal));
    }
    if (filters.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters.colorIdentity && filters.colorIdentity.length > 0) {
      params = params.set('colorIdentity', filters.colorIdentity.join(','));
    }
    if (filters.gameplayKind) {
      params = params.set('gameplayKind', filters.gameplayKind);
    }
    if (filters.type) {
      params = params.set('type', filters.type);
    }
    params = this.appendArrayParam(params, 'types', filters.types);
    params = this.appendArrayParam(params, 'subtypes', filters.subtypes);
    params = this.appendArrayParam(params, 'sets', filters.sets);
    params = this.appendArrayParam(params, 'rarities', filters.rarities);
    params = this.appendArrayParam(params, 'colors', filters.colors);
    if (filters.colorMatchMode) {
      params = params.set('colorMatchMode', filters.colorMatchMode);
    }
    params = this.appendBooleanParam(params, 'artifact', filters.artifact);
    params = this.appendBooleanParam(params, 'land', filters.land);
    params = this.appendBooleanParam(params, 'multicolor', filters.multicolor);
    params = this.appendBooleanParam(params, 'basic', filters.basic);
    params = this.appendBooleanParam(params, 'legendary', filters.legendary);
    params = this.appendStringParam(params, 'oracleTextA', filters.oracleTextA);
    params = this.appendStringParam(params, 'oracleTextB', filters.oracleTextB);
    if (filters.oracleTextMode) {
      params = params.set('oracleTextMode', filters.oracleTextMode);
    }
    params = this.appendNumberParam(params, 'manaValueMin', filters.manaValueMin);
    params = this.appendNumberParam(params, 'manaValueMax', filters.manaValueMax);
    params = this.appendStringParam(params, 'manaCost', filters.manaCost);
    params = this.appendNumberParam(params, 'powerMin', filters.powerMin);
    params = this.appendNumberParam(params, 'powerMax', filters.powerMax);
    params = this.appendNumberParam(params, 'toughnessMin', filters.toughnessMin);
    params = this.appendNumberParam(params, 'toughnessMax', filters.toughnessMax);
    params = this.appendBooleanParam(params, 'includeVariablePower', filters.includeVariablePower);
    params = this.appendBooleanParam(params, 'includeVariableToughness', filters.includeVariableToughness);
    params = this.appendArrayParam(params, 'formats', filters.formats);
    if (filters.tokenOnly !== undefined) {
      params = params.set('tokenOnly', String(filters.tokenOnly));
    }

    return this.http.get<DataResponse<Card>>(`${API_BASE_URL}/cards/search`, {
      params,
      context: withGlobalLoadingForFeature('cards'),
    });
  }

  searchOptions(): Observable<CardSearchOptionsResponse> {
    return this.http.get<CardSearchOptionsResponse>(`${API_BASE_URL}/cards/search/options`, {
      params: { lang: this.languagePreferences.cardLanguage() },
      context: withGlobalLoadingForFeature('cards'),
    });
  }

  get(scryfallId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${API_BASE_URL}/cards/${scryfallId}`, {
      params: { lang: this.languagePreferences.cardLanguage() },
    });
  }

  getSilently(scryfallId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${API_BASE_URL}/cards/${scryfallId}`, {
      params: { lang: this.languagePreferences.cardLanguage() },
      context: withoutGlobalLoading(),
    });
  }

  printings(scryfallId: string): Observable<DataResponse<Card>> {
    return this.http.get<DataResponse<Card>>(`${API_BASE_URL}/cards/${scryfallId}/printings`, {
      params: { lang: this.languagePreferences.cardLanguage() },
      context: withGlobalLoadingForFeature('cards'),
    });
  }

  image(scryfallId: string, format: 'small' | 'normal' | 'large' | 'png' | 'art_crop' | 'border_crop' = 'normal'): Observable<CardImageResponse> {
    return this.http.get<CardImageResponse>(`${API_BASE_URL}/cards/${scryfallId}/image`, {
      params: { format, mode: 'uri' },
      context: withGlobalLoadingForFeature('cards'),
    });
  }

  private appendArrayParam(params: HttpParams, key: string, value: readonly string[] | undefined): HttpParams {
    return value && value.length > 0 ? params.set(key, value.join(',')) : params;
  }

  private appendStringParam(params: HttpParams, key: string, value: string | undefined): HttpParams {
    const trimmed = value?.trim() ?? '';

    return trimmed ? params.set(key, trimmed) : params;
  }

  private appendNumberParam(params: HttpParams, key: string, value: number | undefined): HttpParams {
    return value !== undefined && Number.isFinite(value) ? params.set(key, String(value)) : params;
  }

  private appendBooleanParam(params: HttpParams, key: string, value: boolean | undefined): HttpParams {
    return value !== undefined ? params.set(key, String(value)) : params;
  }
}
