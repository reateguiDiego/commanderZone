import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
﻿import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { TableAssistantSetupComponent } from '../table-assistant-setup/table-assistant-setup.component';

interface Benefit {
  title: string;
  description: string;
}

@Component({
  selector: 'app-table-assistant-page',
  imports: [RuntimeTranslatePipe, TableAssistantSetupComponent],
  templateUrl: './table-assistant-page.component.html',
  styleUrl: './table-assistant-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantPageComponent implements OnInit, OnDestroy {
  private readonly pageHeader = inject(PageHeaderStore);

  readonly setupOpen = signal(false);
  readonly benefits: Benefit[] = [
    {
      title: 'tableAssistant.page.benefits.lifeAndCommander.title',
      description: 'tableAssistant.page.benefits.lifeAndCommander.description',
    },
    {
      title: 'tableAssistant.page.benefits.simpleTurns.title',
      description: 'tableAssistant.page.benefits.simpleTurns.description',
    },
    {
      title: 'tableAssistant.page.benefits.sharedTable.title',
      description: 'tableAssistant.page.benefits.sharedTable.description',
    },
  ];

  ngOnInit(): void {
    this.setHeader();
  }

  ngOnDestroy(): void {
    this.pageHeader.clear();
  }

  openSetup(): void {
    if (this.setupOpen()) {
      return;
    }

    this.setupOpen.set(true);
    this.setHeader();
  }

  handleSetupDestroyed(): void {
    this.setupOpen.set(false);
    this.setHeader();
  }

  private setHeader(): void {
    this.pageHeader.set({
      title: 'tableAssistant.page.header.title',
      actions: [
        {
          id: 'start-table-assistant',
          label: 'tableAssistant.page.header.startGame',
          icon: 'play',
          disabled: this.setupOpen(),
          variant: 'primary',
          execute: () => this.openSetup(),
        },
      ],
    });
  }
}
