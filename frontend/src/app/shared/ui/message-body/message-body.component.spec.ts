import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageBodyComponent } from './message-body.component';

describe('MessageBodyComponent', () => {
  let fixture: ComponentFixture<MessageBodyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageBodyComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageBodyComponent);
  });

  it('renders plain paragraphs, headings, lists and separators safely', () => {
    fixture.componentRef.setInput('body', [
      'Hello',
      'again',
      '',
      '## Section',
      '- First',
      '- Second',
      '---',
      '[Open site](https://example.com)',
      '[Contact](/contact)',
      '[Bad](javascript:alert(1))',
      '![Preview](data:image/png;base64,aGVsbG8=)',
      '<strong>Plain text</strong>',
    ].join('\n'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h4')?.textContent).toContain('Section');
    expect(element.querySelectorAll('li').length).toBe(2);
    expect(element.querySelector('hr')).not.toBeNull();
    const links = Array.from(element.querySelectorAll('a'));
    expect(links[0]?.getAttribute('href')).toBe('https://example.com');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[1]?.getAttribute('href')).toBe('/contact');
    expect(links[1]?.getAttribute('target')).toBeNull();
    expect(element.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=');
    expect(element.querySelector('strong')).toBeNull();
    expect(element.textContent).toContain('[Bad](javascript:alert(1))');
    expect(element.textContent).toContain('<strong>Plain text</strong>');
  });
});
