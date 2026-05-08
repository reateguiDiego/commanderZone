import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { TableAssistantSetupComponent } from '../table-assistant-setup/table-assistant-setup.component';

interface Benefit {
  title: string;
  description: string;
}

@Component({
  selector: 'app-table-assistant-page',
  imports: [TableAssistantSetupComponent],
  templateUrl: './table-assistant-page.component.html',
  styleUrl: './table-assistant-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantPageComponent implements OnInit, OnDestroy {
  private readonly pageHeader = inject(PageHeaderStore);

  readonly setupOpen = signal(false);
  readonly benefits: Benefit[] = [
    {
      title: 'Vidas y comandante',
      description: 'Controla vidas y daño de comandante sin convertir la partida en una hoja de cálculo.',
    },
    {
      title: 'Turnos simples',
      description: 'Marca jugador activo y temporizador si la mesa quiere ritmo, sin reglas automáticas.',
    },
    {
      title: 'Mesa compartida',
      description: 'Pensado para un único móvil o tablet en el centro de la mesa.',
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
      title: 'Asistente de Mesa',
      actions: [
        {
          id: 'start-table-assistant',
          label: 'Empezar partida',
          icon: 'play',
          disabled: this.setupOpen(),
          variant: 'primary',
          execute: () => this.openSetup(),
        },
      ],
    });
  }
}
