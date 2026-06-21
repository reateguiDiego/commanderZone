import { TestBed } from '@angular/core/testing';
import { CommunityPageComponent } from './community-page.component';

describe('CommunityPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommunityPageComponent],
    }).compileComponents();
  });

  it('renders the community placeholder', () => {
    const fixture = TestBed.createComponent(CommunityPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('¡Hello world! WIP: community-page');
  });
});
