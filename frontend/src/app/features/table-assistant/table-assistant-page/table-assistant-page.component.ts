import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TableAssistantSetupComponent } from '../table-assistant-setup/table-assistant-setup.component';

interface Benefit {
  title: string;
  description: string;
}

@Component({
  selector: 'app-table-assistant-page',
  imports: [RouterLink, TableAssistantSetupComponent],
  templateUrl: './table-assistant-page.component.html',
  styleUrl: './table-assistant-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantPageComponent {
  readonly setupOpen = signal(false);
  readonly benefits: Benefit[] = [
    {
      title: 'Vidas siempre claras',
      description: 'Actualiza vidas rapido con controles grandes pensados para usar durante la partida.',
    },
    {
      title: 'Turnos y fases bajo control',
      description: 'Marca el jugador activo, pasa turno y activa fases solo si tu mesa las necesita.',
    },
    {
      title: 'Daño de comandante sin líos',
      description: 'Registra el daño recibido de cada comandante y detecta amenazas letales de un vistazo.',
    },
    {
      title: 'Uno o varios moviles',
      description: 'Usad un unico dispositivo en el centro de la mesa o conectad un movil por jugador.',
    },
    {
      title: 'Invita a tus amigos',
      description: 'Comparte la sala con un enlace, un codigo o invita directamente a tus amigos de CommanderZone.',
    },
    {
      title: 'Trackers configurables',
      description: 'Activa solo lo que necesitas: veneno, commander tax, energia, experiencia, monarch, initiative y storm.',
    },
    {
      title: 'Temporizadores flexibles',
      description: 'Juega sin timer, con temporizador por turno o con temporizador por fase.',
    },
  ];
}

