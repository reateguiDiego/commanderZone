import { SeoLocaleCode } from '../../../core/localization/locale-config';
import { SeoRouteKey } from '../../../core/localization/seo-routes';

export type SeoJsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly SeoJsonLdValue[]
  | { readonly [key: string]: SeoJsonLdValue };

export interface SeoMetadataContent {
  readonly title: string;
  readonly description: string;
  readonly ogTitle: string;
  readonly ogDescription: string;
  readonly ogImage: string;
}

export interface LandingLink {
  readonly label: string;
  readonly href: string;
  readonly ariaLabel?: string;
}

export type LandingImageLoading = 'eager' | 'lazy';
export type LandingImageFetchPriority = 'high' | 'low' | 'auto';

export interface LandingImageContent {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly loading?: LandingImageLoading;
  readonly fetchPriority?: LandingImageFetchPriority;
}

export interface LandingLocaleLink extends LandingLink {
  readonly locale: SeoLocaleCode;
}

export interface LandingBreadcrumbContent {
  readonly items: readonly LandingLink[];
}

export interface LandingTrustItem {
  readonly label: string;
  readonly value?: string;
}

export interface LandingTrustBarContent {
  readonly label: string;
  readonly items: readonly LandingTrustItem[];
}

export interface LandingHeroContent {
  readonly eyebrow?: string;
  readonly title: string;
  readonly subtitle: string;
  readonly image?: LandingImageContent;
  readonly primaryLink: LandingLink;
  readonly secondaryLink?: LandingLink;
  readonly highlights?: readonly string[];
}

export interface LandingSectionContent {
  readonly id?: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly links?: readonly LandingLink[];
}

export interface LandingFeature {
  readonly title: string;
  readonly description: string;
}

export interface LandingFeatureGridContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly features: readonly LandingFeature[];
}

export interface LandingUseCase {
  readonly title: string;
  readonly description: string;
  readonly link?: LandingLink;
}

export interface LandingUseCasesContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly useCases: readonly LandingUseCase[];
}

export interface LandingStep {
  readonly title: string;
  readonly description: string;
}

export interface LandingStepsContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly steps: readonly LandingStep[];
}

export interface LandingFaqItem {
  readonly question: string;
  readonly answer: readonly string[];
}

export interface LandingFaqContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly items: readonly LandingFaqItem[];
}

export interface LandingComparisonRow {
  readonly label: string;
  readonly firstValue: string;
  readonly secondValue: string;
}

export interface LandingComparisonContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly firstColumnLabel: string;
  readonly secondColumnLabel: string;
  readonly rows: readonly LandingComparisonRow[];
}

export interface LandingCtaContent {
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly primaryLink: LandingLink;
  readonly secondaryLink?: LandingLink;
}

export interface LandingInternalLinksContent {
  readonly id?: string;
  readonly title: string;
  readonly intro?: string;
  readonly links: readonly LandingLink[];
}

export interface SeoLandingContent {
  readonly routeKey: SeoRouteKey;
  readonly locale: SeoLocaleCode;
  readonly seo: SeoMetadataContent;
  readonly jsonLd: SeoJsonLdValue;
  readonly siteName?: string;
  readonly homeLink?: LandingLink;
  readonly publicNavigationLinks?: readonly LandingLink[];
  readonly footerLinks?: readonly LandingLink[];
  readonly localeLinks?: readonly LandingLocaleLink[];
  readonly breadcrumb: LandingBreadcrumbContent;
  readonly hero: LandingHeroContent;
  readonly trustBar?: LandingTrustBarContent;
  readonly sections?: readonly LandingSectionContent[];
  readonly featureGrid?: LandingFeatureGridContent;
  readonly steps?: LandingStepsContent;
  readonly useCases?: LandingUseCasesContent;
  readonly comparison?: LandingComparisonContent;
  readonly faqPreview?: LandingFaqContent;
  readonly fullFaq?: LandingFaqContent;
  readonly faq: LandingFaqContent;
  readonly cta?: LandingCtaContent;
  readonly internalLinks: LandingInternalLinksContent;
}
