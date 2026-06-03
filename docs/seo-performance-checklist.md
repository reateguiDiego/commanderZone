# SEO Performance Checklist

Use this checklist for every public SEO landing before release.

## Lighthouse and PageSpeed

- Run Lighthouse/PageSpeed against at least one product landing, one guide landing, one comparison landing, and the FAQ landing.
- Test desktop and mobile.
- Verify the page is served from the prerendered HTML, not an empty shell that waits for client JavaScript.
- Keep Performance, SEO, Accessibility, and Best Practices regressions visible in review notes.

## Core Web Vitals

- LCP should be the visible hero text or hero image and must not wait for non-critical JavaScript.
- Hero image must be eager-loaded, have `fetchpriority="high"`, and be preloaded from the SEO metadata.
- Images must include explicit width and height, or a stable aspect ratio, to avoid CLS.
- Below-the-fold images, if added later, should use `loading="lazy"`.
- Avoid layout shifts from late-loading fonts, media, banners, cookie UI, or injected widgets.

## JavaScript and Assets

- SEO landing routes must stay lazy-loaded.
- Do not import heavy runtime libraries into `features/seo-landings`.
- Do not add executable third-party scripts to SEO landing templates.
- JSON-LD scripts are allowed because they are non-executable structured data.
- Keep public landing content static and SSR/prerender-friendly.

## Validation

- Run `npm run validate:seo-assets`.
- Run `npm test -- --watch=false`.
- Run `npm run build`.
- Confirm representative prerendered HTML contains meaningful copy, canonical/hreflang, metadata, JSON-LD, hero image attributes, and crawlable links.
