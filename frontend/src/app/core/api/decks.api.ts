import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, finalize, Observable, shareReplay } from 'rxjs';
import { AuthStore } from '../auth/auth.store';
import { API_BASE_URL } from './api.config';
import { withGlobalLoading } from '../loading/loading-context';
import {
  CommanderValidationResponse,
  DataResponse,
  DeckImportResponse,
  DeckResponse,
} from '../models/api-responses.model';
import { AdvancedAnalysisResponse } from '../models/deck-advanced-analysis.model';
import { DeckAnalysis, DeckAnalysisOptions, DeckBracketAnalysisResponse } from '../models/deck-analysis.model';
import { Deck, DeckCardPrintingsResponse, DeckEditorTokensResponse, DeckFormat, DeckSection, DeckSectionsResponse, DeckTokensResponse, DeckVisibility } from '../models/deck.model';

export interface DeckCardMutationPayload {
  scryfallId?: string;
  name?: string;
  setCode?: string;
  collectorNumber?: string;
  quantity?: number;
  section?: DeckSection;
}

export interface DeckCardBatchMutationPayload {
  deckCardId: string;
  quantity?: number;
  section?: DeckSection;
}

export interface CommanderReplacementPayload {
  deckCardId?: string;
  scryfallId?: string;
  name?: string;
  setCode?: string;
  collectorNumber?: string;
}

export interface DeckImportCommanderSelectionPayload {
  commanderScryfallId?: string;
  commanderScryfallIds?: string[];
  commander?: CommanderReplacementPayload;
  commanders?: CommanderReplacementPayload[];
}

export interface DeckVisualSelectionPayload {
  backgroundName?: string;
  sleevesName?: string;
}

export interface OwnedDeckListPage extends DataResponse<Deck> {
  nextCursor: string | null;
}

export interface OwnedDeckListOptions {
  limit?: number;
  cursor?: string;
  q?: string;
  color?: string;
  sort?: 'updated-desc' | 'name-asc' | 'name-desc';
}

export interface OwnedDeckSummary {
  total: number;
  public: number;
  private: number;
  folders: { folderId: string | null; count: number }[];
  manaColorStats: { color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; percentage: number }[];
}

@Injectable({ providedIn: 'root' })
export class DecksApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);
  private readonly analysisRequests = new Map<string, Observable<unknown>>();

  private shareAnalysis<T>(key: string, request: () => Observable<T>): Observable<T> {
    return defer(() => {
      const scopedKey = `${this.auth.token() ?? ''}|${key}`;
      const pending = this.analysisRequests.get(scopedKey);
      if (pending) return pending as Observable<T>;
      const shared = request().pipe(
        finalize(() => { if (this.analysisRequests.get(scopedKey) === shared) this.analysisRequests.delete(scopedKey); }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.analysisRequests.set(scopedKey, shared);
      return shared;
    });
  }

  list(folderId?: string | null, _skipGlobalLoading = false, options: OwnedDeckListOptions = {}): Observable<OwnedDeckListPage> {
    return this.listPage(folderId, options);
  }

  summary(): Observable<OwnedDeckSummary> {
    return this.http.get<OwnedDeckSummary>(`${API_BASE_URL}/decks/summary`);
  }

  listPage(folderId?: string | null, options: OwnedDeckListOptions = {}): Observable<OwnedDeckListPage> {
    return this.http.get<OwnedDeckListPage>(`${API_BASE_URL}/decks`, {
      params: { ...(folderId === undefined ? {} : { folderId: folderId ?? 'null' }), ...options },
    });
  }

  create(
    name: string,
    folderId: string | null = null,
    visibility: DeckVisibility = 'private',
    format: DeckFormat['id'] = 'commander',
    visuals: DeckVisualSelectionPayload = {},
  ): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks`, { name, folderId, visibility, format, ...visuals });
  }

  quickBuild(payload: { name: string; folderId?: string | null; visibility?: DeckVisibility; format?: DeckFormat['id']; cards?: DeckCardMutationPayload[] }): Observable<DeckImportResponse> {
    this.analysisRequests.clear();
    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/quick-build`, payload);
  }

  get(id: string): Observable<DeckResponse> {
    return this.http.get<DeckResponse>(`${API_BASE_URL}/decks/${id}`);
  }

  getBySlug(slug: string): Observable<DeckResponse> {
    return this.http.get<DeckResponse>(`${API_BASE_URL}/decks/by-slug/${encodeURIComponent(slug)}`, {
      context: withGlobalLoading(),
    });
  }

  analysis(id: string, options: DeckAnalysisOptions = {}): Observable<DeckAnalysis> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    }

    return this.shareAnalysis(`${id}|basic|${JSON.stringify(Object.entries(params).sort())}`, () => this.http.get<DeckAnalysis>(`${API_BASE_URL}/decks/${id}/analysis`, {
      context: withGlobalLoading(),
      params,
    }));
  }

  bracketAnalysis(id: string): Observable<DeckBracketAnalysisResponse> {
    return this.shareAnalysis(`${id}|bracket`, () => this.http.get<DeckBracketAnalysisResponse>(`${API_BASE_URL}/decks/${id}/analysis`, {
      context: withGlobalLoading(),
      params: { view: 'bracket' },
    }));
  }

  getDeckAdvancedAnalysis(deckId: string): Observable<AdvancedAnalysisResponse> {
    return this.shareAnalysis(`${deckId}|advanced`, () => this.http.get<AdvancedAnalysisResponse>(`${API_BASE_URL}/decks/${deckId}/analysis/advanced`, {
      context: withGlobalLoading(),
    }));
  }

  sections(id: string): Observable<DeckSectionsResponse> {
    return this.http.get<DeckSectionsResponse>(`${API_BASE_URL}/decks/${id}/sections`);
  }

  tokens(id: string): Observable<DeckTokensResponse> {
    return this.http.get<DeckTokensResponse>(`${API_BASE_URL}/decks/${id}/tokens`, {
      context: withGlobalLoading(),
    });
  }

  editorTokens(id: string): Observable<DeckEditorTokensResponse> {
    return this.http.get<DeckEditorTokensResponse>(`${API_BASE_URL}/decks/${id}/tokens/editor`, {
      context: withGlobalLoading(),
    });
  }

  rename(id: string, name: string): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, { name });
  }

  update(id: string, payload: {
    name?: string;
    visibility?: DeckVisibility;
    folderId?: string | null;
    backgroundName?: string;
    sleevesName?: string;
  }): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    this.analysisRequests.clear();
    return this.http.delete<void>(`${API_BASE_URL}/decks/${id}`);
  }

  importDecklist(id: string, decklist: string, commanderSelection: DeckImportCommanderSelectionPayload = {}): Observable<DeckImportResponse> {
    const payload: { decklist: string } & DeckImportCommanderSelectionPayload = { decklist };
    if (commanderSelection.commanderScryfallId) {
      payload.commanderScryfallId = commanderSelection.commanderScryfallId;
    }
    if (Array.isArray(commanderSelection.commanderScryfallIds) && commanderSelection.commanderScryfallIds.length > 0) {
      payload.commanderScryfallIds = commanderSelection.commanderScryfallIds;
    }
    if (commanderSelection.commander) {
      payload.commander = commanderSelection.commander;
    }
    if (Array.isArray(commanderSelection.commanders) && commanderSelection.commanders.length > 0) {
      payload.commanders = commanderSelection.commanders;
    }

    this.analysisRequests.clear();
    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/${id}/import`, payload);
  }

  addCard(id: string, payload: DeckCardMutationPayload): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards`, payload);
  }

  updateCards(id: string, cards: DeckCardBatchMutationPayload[]): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards`, { cards });
  }

  replaceCommanders(id: string, cards: CommanderReplacementPayload[]): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.put<DeckResponse>(`${API_BASE_URL}/decks/${id}/commanders`, { cards });
  }

  updateCard(id: string, deckCardId: string, payload: { quantity?: number; section?: DeckSection }): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`, payload);
  }

  printings(id: string, deckCardId: string): Observable<DeckCardPrintingsResponse> {
    return this.http.get<DeckCardPrintingsResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}/printings`);
  }

  selectPrinting(id: string, deckCardId: string, scryfallId: string): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}/printing`, { scryfallId });
  }

  removeCard(id: string, deckCardId: string): Observable<DeckResponse> {
    this.analysisRequests.clear();
    return this.http.delete<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`);
  }

  validateCommander(id: string, _skipGlobalLoading = false): Observable<CommanderValidationResponse> {
    this.analysisRequests.clear();
    return this.http.post<CommanderValidationResponse>(`${API_BASE_URL}/decks/${id}/validate-commander`, {});
  }
}
