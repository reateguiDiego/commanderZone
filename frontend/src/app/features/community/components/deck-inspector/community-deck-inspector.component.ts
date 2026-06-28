import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CommunityDeckDetail } from '../../../../core/models/community.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { TabListComponent, TabListItem } from '../../../../shared/ui/tab-list/tab-list.component';
import { CommunityDeckViewerStore } from '../deck-viewer/community-deck-viewer.store';
import { ClientCommanderIssue, ClientCommanderValidationService } from '../../../decks/services/client-commander-validation.service';
import { DeckAnalysisPanelComponent } from '../../../decks/deck-editor/deck-analysis-panel/deck-analysis-panel.component';

type CommunityDeckInspectorTab = 'analysis' | 'considering' | 'validation';

const COMMUNITY_INSPECTOR_TABS: ReadonlyArray<TabListItem> = [
  { id: 'analysis', label: 'deckBuilder.deckEditor.analysis', icon: 'bar-chart-3' },
  { id: 'considering', label: 'deckBuilder.deckEditor.considering', icon: 'layers-3' },
  { id: 'validation', label: 'deckBuilder.deckEditor.validation', icon: 'shield-check' },
];

@Component({
  selector: 'app-community-deck-inspector',
  imports: [RuntimeTranslatePipe, ManaSymbolsComponent, TabListComponent, DeckAnalysisPanelComponent],
  templateUrl: './community-deck-inspector.component.html',
  styleUrl: './community-deck-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDeckInspectorComponent {
  private readonly validationService = inject(ClientCommanderValidationService);

  readonly store = inject(CommunityDeckViewerStore);
  readonly deck = input.required<CommunityDeckDetail>();
  readonly activeTab = signal<CommunityDeckInspectorTab>('analysis');
  readonly clientIssues = computed(() => this.validationService.validate(this.deck()));
  readonly consideringCards = computed(() => this.deck().sections.maybeboard ?? []);
  readonly commanderNames = computed(() => this.deck().commanders.map((commander) => commander.name).join(' / '));
  readonly tabItems = computed<readonly TabListItem[]>(() => COMMUNITY_INSPECTOR_TABS.map((item) => {
    if (item.id === 'considering') {
      return { ...item, badge: this.consideringCards().length || undefined };
    }

    if (item.id === 'validation') {
      return {
        ...item,
        attention: !this.deck().valid || this.clientIssues().some((issue) => issue.severity === 'error'),
        badge: this.clientIssues().length || undefined,
      };
    }

    return item;
  }));

  selectTab(tab: string): void {
    if (tab === 'analysis' || tab === 'considering' || tab === 'validation') {
      this.activeTab.set(tab);
    }
  }

  issueSeverityKey(issue: ClientCommanderIssue): string {
    return issue.severity === 'error'
      ? 'community.detail.readonly.validation.error'
      : 'community.detail.readonly.validation.warning';
  }
}
