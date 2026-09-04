<?php

namespace App\Application\Message;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Renders the intentionally small message markup supported by MessageBodyComponent
 * into a safe HTML email. It does not accept arbitrary HTML.
 */
final class AdminMessageEmailBodyRenderer
{
    public function __construct(
        #[Autowire('%env(AUTH_PUBLIC_APP_URL)%')]
        private readonly string $publicAppUrl,
    ) {
    }

    public function render(string $subject, string $body): AdminMessageEmailContent
    {
        $blocks = [];
        $paragraphLines = [];
        $listItems = [];
        $inlineImages = [];

        $flushParagraph = static function () use (&$blocks, &$paragraphLines): void {
            if ($paragraphLines === []) {
                return;
            }

            $blocks[] = sprintf(
                '<p style="margin:0 0 18px;color:#d7d7d7;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;">%s</p>',
                implode('<br>', $paragraphLines),
            );
            $paragraphLines = [];
        };
        $flushList = static function () use (&$blocks, &$listItems): void {
            if ($listItems === []) {
                return;
            }

            $blocks[] = sprintf(
                '<ul style="margin:0 0 18px;padding-left:22px;color:#d7d7d7;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;">%s</ul>',
                implode('', array_map(
                    static fn (string $item): string => sprintf('<li style="margin:0 0 6px;">%s</li>', $item),
                    $listItems,
                )),
            );
            $listItems = [];
        };

        $lines = preg_split('/\r\n|\r|\n/', $body) ?: [];
        foreach ($lines as $rawLine) {
            $line = rtrim($rawLine);
            $trimmedLine = trim($line);

            if ($trimmedLine === '') {
                $flushParagraph();
                $flushList();
                continue;
            }

            if (preg_match('/^-{3,}$/', $trimmedLine) === 1) {
                $flushParagraph();
                $flushList();
                $blocks[] = '<hr style="height:1px;margin:24px 0;border:0;background:#d4af37;">';
                continue;
            }

            if (str_starts_with($trimmedLine, '## ')) {
                $flushParagraph();
                $flushList();
                $blocks[] = sprintf(
                    '<h2 style="margin:0 0 14px;color:#f1c84b;font-family:Arial,sans-serif;font-size:22px;line-height:1.25;">%s</h2>',
                    $this->escape(trim(substr($trimmedLine, 3))),
                );
                continue;
            }

            $image = $this->renderImageLine($trimmedLine, $inlineImages);
            if ($image !== null) {
                $flushParagraph();
                $flushList();
                $blocks[] = $image;
                continue;
            }

            if (str_starts_with($trimmedLine, '- ')) {
                $flushParagraph();
                $listItems[] = $this->renderInline(trim(substr($trimmedLine, 2)));
                continue;
            }

            $flushList();
            $paragraphLines[] = $this->renderInline($line);
        }

        $flushParagraph();
        $flushList();

        return new AdminMessageEmailContent(
            $this->emailDocument($subject, implode("\n", $blocks)),
            $inlineImages,
        );
    }

    /**
     * @param list<AdminMessageEmailInlineImage> $inlineImages
     */
    private function renderImageLine(string $line, array &$inlineImages): ?string
    {
        if (preg_match('/^!\[([^\]]*)\]\(([^)\s]+)\)$/', $line, $matches) !== 1) {
            return null;
        }

        $alt = trim($matches[1]);
        $url = trim($matches[2]);
        $source = $this->imageSource($url, $inlineImages);
        if ($source === null) {
            return null;
        }

        return sprintf(
            '<figure style="margin:0 0 20px;text-align:center;"><img src="%s" alt="%s" style="display:block;width:auto;max-width:100%%;max-height:320px;margin:0 auto;border:0;border-radius:8px;">%s</figure>',
            $this->escape($source),
            $this->escape($alt),
            $alt === ''
                ? ''
                : sprintf('<figcaption style="margin-top:8px;color:#a6a6a6;font-family:Arial,sans-serif;font-size:12px;line-height:1.4;">%s</figcaption>', $this->escape($alt)),
        );
    }

    /**
     * @param list<AdminMessageEmailInlineImage> $inlineImages
     */
    private function imageSource(string $url, array &$inlineImages): ?string
    {
        if (preg_match('/^https?:\/\//i', $url) === 1) {
            return $url;
        }

        if (preg_match('/^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+\/=]+)$/i', $url, $matches) !== 1) {
            return null;
        }

        $content = base64_decode($matches[2], true);
        if ($content === false || $content === '') {
            return null;
        }

        $contentType = strtolower($matches[1]);
        $contentType = $contentType === 'image/jpg' ? 'image/jpeg' : $contentType;
        $position = count($inlineImages) + 1;
        $contentId = sprintf('admin-message-image-%d@commanderzone', $position);
        $inlineImages[] = new AdminMessageEmailInlineImage(
            $contentId,
            sprintf('message-image-%d.%s', $position, $this->fileExtension($contentType)),
            $contentType,
            $content,
        );

        return 'cid:'.$contentId;
    }

    private function renderInline(string $text): string
    {
        $pattern = '/\[([^\]]+)\]\(([^)\s]+)\)/';
        $result = '';
        $lastOffset = 0;

        if (preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE) !== false) {
            foreach ($matches[0] as $index => $match) {
                $fullMatch = $match[0];
                $offset = $match[1];
                $result .= $this->escape(substr($text, $lastOffset, $offset - $lastOffset));

                $label = $matches[1][$index][0];
                $url = $matches[2][$index][0];
                $result .= $this->isSafeLinkUrl($url)
                    ? sprintf(
                        '<a href="%s" style="color:#f1c84b;font-weight:700;text-decoration:underline;">%s</a>',
                        $this->escape($this->absoluteLinkUrl($url)),
                        $this->escape($label),
                    )
                    : $this->escape($fullMatch);
                $lastOffset = $offset + strlen($fullMatch);
            }
        }

        return $result.$this->escape(substr($text, $lastOffset));
    }

    private function isSafeLinkUrl(string $url): bool
    {
        return preg_match('/^\/(?!\/)/', $url) === 1
            || preg_match('/^(?:https?:\/\/|mailto:)/i', $url) === 1;
    }

    private function absoluteLinkUrl(string $url): string
    {
        return str_starts_with($url, '/')
            ? rtrim(trim($this->publicAppUrl), '/').$url
            : $url;
    }

    private function emailDocument(string $subject, string $content): string
    {
        return sprintf(<<<'HTML'
<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#111111;">
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" border="0" style="width:100%%;background:#111111;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%%;max-width:600px;background:#1c1c1c;border:1px solid #51451c;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px;color:#f1c84b;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">CommanderZone</td>
          </tr>
          <tr>
            <td style="padding:8px 28px 12px;"><h1 style="margin:0;color:#ffffff;font-family:Arial,sans-serif;font-size:26px;line-height:1.25;">%s</h1></td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px;">%s</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
HTML, $this->escape($subject), $content);
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function fileExtension(string $contentType): string
    {
        return match ($contentType) {
            'image/jpeg' => 'jpg',
            default => substr($contentType, strlen('image/')),
        };
    }
}

final readonly class AdminMessageEmailContent
{
    /**
     * @param list<AdminMessageEmailInlineImage> $inlineImages
     */
    public function __construct(
        public string $html,
        public array $inlineImages,
    ) {
    }
}

final readonly class AdminMessageEmailInlineImage
{
    public function __construct(
        public string $contentId,
        public string $filename,
        public string $contentType,
        public string $content,
    ) {
    }
}
