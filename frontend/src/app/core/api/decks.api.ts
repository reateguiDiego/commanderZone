import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';
import {
  CommanderValidationResponse,
  DataResponse,
  DeckImportResponse,
  DeckResponse,
} from '../models/api-responses.model';
import { DeckAnalysis, DeckAnalysisOptions } from '../models/deck-analysis.model';
import { Deck, DeckCardPrintingsResponse, DeckFormat, DeckSection, DeckSectionsResponse, DeckTokensResponse, DeckVisibility } from '../models/deck.model';

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

@Injectable({ providedIn: 'root' })
export class DecksApi {
  private readonly http = inject(HttpClient);

  list(folderId?: string | null, skipGlobalLoading = false): Observable<DataResponse<Deck>> {
    const context = skipGlobalLoading ? withoutGlobalLoading() : undefined;

    return folderId === undefined
      ? this.http.get<DataResponse<Deck>>(`${API_BASE_URL}/decks`, { context })
      : this.http.get<DataResponse<Deck>>(`${API_BASE_URL}/decks`, { context, params: { folderId: folderId ?? 'null' } });
  }

  create(name: string, folderId: string | null = null, visibility: DeckVisibility = 'private', format: DeckFormat['id'] = 'commander'): Observable<DeckResponse> {
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks`, { name, folderId, visibility, format });
  }

  quickBuild(payload: { name: string; folderId?: string | null; visibility?: DeckVisibility; format?: DeckFormat['id']; cards?: DeckCardMutationPayload[] }): Observable<DeckImportResponse> {
    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/quick-build`, payload);
  }

  get(id: string): Observable<DeckResponse> {
    return this.http.get<DeckResponse>(`${API_BASE_URL}/decks/${id}`);
  }

  analysis(id: string, options: DeckAnalysisOptions = {}): Observable<DeckAnalysis> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    }

    return this.http.get<DeckAnalysis>(`${API_BASE_URL}/decks/${id}/analysis`, { params });
  }

  sections(id: string): Observable<DeckSectionsResponse> {
    return this.http.get<DeckSectionsResponse>(`${API_BASE_URL}/decks/${id}/sections`);
  }

  tokens(id: string): Observable<DeckTokensResponse> {
    return this.http.get<DeckTokensResponse>(`${API_BASE_URL}/decks/${id}/tokens`);
  }

  rename(id: string, name: string): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, { name });
  }

  update(id: string, payload: { name?: string; visibility?: DeckVisibility; folderId?: string | null }): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, payload);
  }

  delete(id: string): Observable<void> {
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

    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/${id}/import`, payload);
  }

  addCard(id: string, payload: DeckCardMutationPayload): Observable<DeckResponse> {
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards`, payload);
  }

  updateCards(id: string, cards: DeckCardBatchMutationPayload[]): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards`, { cards });
  }

  replaceCommanders(id: string, cards: CommanderReplacementPayload[]): Observable<DeckResponse> {
    return this.http.put<DeckResponse>(`${API_BASE_URL}/decks/${id}/commanders`, { cards });
  }

  updateCard(id: string, deckCardId: string, payload: { quantity?: number; section?: DeckSection }): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`, payload);
  }

  printings(id: string, deckCardId: string): Observable<DeckCardPrintingsResponse> {
    return this.http.get<DeckCardPrintingsResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}/printings`);
  }

  selectPrinting(id: string, deckCardId: string, scryfallId: string): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}/printing`, { scryfallId });
  }

  removeCard(id: string, deckCardId: string): Observable<DeckResponse> {
    return this.http.delete<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`);
  }

  validateCommander(id: string, skipGlobalLoading = false): Observable<CommanderValidationResponse> {
    return this.http.post<CommanderValidationResponse>(`${API_BASE_URL}/decks/${id}/validate-commander`, {}, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }
}
