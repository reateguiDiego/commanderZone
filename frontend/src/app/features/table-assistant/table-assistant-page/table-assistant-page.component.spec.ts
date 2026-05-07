import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { TableAssistantPageComponent } from './table-assistant-page.component';

describe('TableAssistantPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableAssistantPageComponent],
      providers: [
        provideRouter([]),
        { provide: TableAssistantApi, useValue: { create: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('registers the page header action and opens setup from it', () => {
    const fixture = TestBed.createComponent(TableAssistantPageComponent);
    const pageHeader = TestBed.inject(PageHeaderStore);
    fixture.detectChanges();

    expect(pageHeader.state()?.title).toBe('Asistente de Mesa');
    expect(pageHeader.state()?.actions?.[0]?.label).toBe('Empezar partida');
    expect(fixture.nativeElement.textContent).toContain('Mesa manual de Commander');

    pageHeader.state()?.actions?.[0]?.execute();
    fixture.detectChanges();

    expect(pageHeader.state()?.actions?.[0]?.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Configura la mesa');
    expect(fixture.nativeElement.textContent).not.toContain('Un movil por jugador');
  });
});
