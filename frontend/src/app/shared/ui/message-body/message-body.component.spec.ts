import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageBodyComponent } from './message-body.component';

describe('MessageBodyComponent', () => {
  let fixture: ComponentFixture<MessageBodyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageBodyComponent],
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
      '![Preview](data:image/png;base64,aGVsbG8=)',
      '<strong>Plain text</strong>',
    ].join('\n'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h4')?.textContent).toContain('Section');
    expect(element.querySelectorAll('li').length).toBe(2);
    expect(element.querySelector('hr')).not.toBeNull();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(element.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=');
    expect(element.querySelector('strong')).toBeNull();
    expect(element.textContent).toContain('<strong>Plain text</strong>');
  });
});
