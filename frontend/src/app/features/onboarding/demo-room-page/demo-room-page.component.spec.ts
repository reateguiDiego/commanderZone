import { convertToParamMap } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { DemoRoomPageComponent } from './demo-room-page.component';

describe('DemoRoomPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DemoRoomPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'demo-1' }) } },
        },
      ],
    }).compileComponents();
  });

  it('renders the demo room id', () => {
    const fixture: ComponentFixture<DemoRoomPageComponent> = TestBed.createComponent(DemoRoomPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('demo-1');
  });
});
