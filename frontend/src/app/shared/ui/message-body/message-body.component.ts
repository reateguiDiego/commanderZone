import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface MessageTextSegment {
  readonly type: 'text';
  readonly text: string;
}

interface MessageLinkSegment {
  readonly type: 'link';
  readonly text: string;
  readonly url: string;
}

type MessageInlineSegment = MessageTextSegment | MessageLinkSegment;

type MessageBodyBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'image'; readonly alt: string; readonly url: string }
  | { readonly type: 'list'; readonly items: readonly MessageInlineSegment[][] }
  | { readonly type: 'paragraph'; readonly lines: readonly MessageInlineSegment[][] }
  | { readonly type: 'separator' };

@Component({
  selector: 'app-message-body',
  templateUrl: './message-body.component.html',
  styleUrl: './message-body.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageBodyComponent {
  readonly body = input('');
  readonly blocks = computed(() => this.parseBody(this.body()));

  private parseBody(body: string): readonly MessageBodyBlock[] {
    const blocks: MessageBodyBlock[] = [];
    let paragraphLines: MessageInlineSegment[][] = [];
    let listItems: MessageInlineSegment[][] = [];

    const flushParagraph = (): void => {
      if (paragraphLines.length === 0) {
        return;
      }

      blocks.push({ type: 'paragraph', lines: paragraphLines });
      paragraphLines = [];
    };

    const flushList = (): void => {
      if (listItems.length === 0) {
        return;
      }

      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    };

    for (const rawLine of body.replace(/\r\n/g, '\n').split('\n')) {
      const line = rawLine.trimEnd();
      const trimmedLine = line.trim();

      if (trimmedLine === '') {
        flushParagraph();
        flushList();
        continue;
      }

      if (/^-{3,}$/.test(trimmedLine)) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'separator' });
        continue;
      }

      if (trimmedLine.startsWith('## ')) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'heading', text: trimmedLine.slice(3).trim() });
        continue;
      }

      const image = this.parseImageLine(trimmedLine);
      if (image) {
        flushParagraph();
        flushList();
        blocks.push(image);
        continue;
      }

      if (trimmedLine.startsWith('- ')) {
        flushParagraph();
        listItems.push(this.parseInlineSegments(trimmedLine.slice(2).trim()));
        continue;
      }

      flushList();
      paragraphLines.push(this.parseInlineSegments(line));
    }

    flushParagraph();
    flushList();

    return blocks;
  }

  private parseImageLine(line: string): MessageBodyBlock | null {
    const imageMatch = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (!imageMatch) {
      return null;
    }

    const url = imageMatch[2].trim();
    if (!this.isSafeImageUrl(url)) {
      return null;
    }

    return {
      type: 'image',
      alt: imageMatch[1].trim(),
      url,
    };
  }

  private parseInlineSegments(text: string): MessageInlineSegment[] {
    const segments: MessageInlineSegment[] = [];
    const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }

      const url = match[2].trim();
      if (this.isSafeLinkUrl(url)) {
        segments.push({ type: 'link', text: match[1], url });
      } else {
        segments.push({ type: 'text', text: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'text', text: text.slice(lastIndex) });
    }

    return segments.length > 0 ? segments : [{ type: 'text', text }];
  }

  private isSafeLinkUrl(url: string): boolean {
    return /^(?:https?:\/\/|mailto:)/i.test(url);
  }

  private isSafeImageUrl(url: string): boolean {
    return /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(url);
  }
}
