import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTableSelectionService } from './game-table-selection.service';

describe('GameTableSelectionService', () => {
  let service: GameTableSelectionService;

  beforeEach(() => {
    service = new GameTableSelectionService();
  });

  it('only adds cards to the current selection with shift click', () => {
    const firstCard = card('card-1');
    const secondCard = card('card-2');

    service.toggleSelection(mouseEvent({ shiftKey: true }), 'player-1', 'battlefield', firstCard);
    service.toggleSelection(mouseEvent({ ctrlKey: true }), 'player-1', 'battlefield', secondCard);

    expect(service.selectedCards().map((selected) => selected.card.instanceId)).toEqual(['card-2']);

    service.toggleSelection(mouseEvent({ shiftKey: true }), 'player-1', 'battlefield', firstCard);

    expect(service.selectedCards().map((selected) => selected.card.instanceId)).toEqual(['card-2', 'card-1']);
  });
});

function mouseEvent(modifiers: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}): MouseEvent {
  return {
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  } as MouseEvent;
}

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
  };
}
