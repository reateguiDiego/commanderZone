export type ReportSource = 'profile' | 'game_player' | 'chat_message';

export const REPORT_SOURCE_LABEL_KEYS: Readonly<Record<ReportSource, string>> = {
  profile: 'reports.sources.profile',
  game_player: 'reports.sources.game_player',
  chat_message: 'reports.sources.chat_message',
};

export type ReportCategory =
  | 'harassment'
  | 'discrimination_or_unwanted_sexual_content'
  | 'threats_or_safety'
  | 'personal_data_exposure'
  | 'spam_advertising_scam_phishing'
  | 'impersonation'
  | 'public_offensive_content'
  | 'intentional_game_disruption'
  | 'serious_gameplay_deception'
  | 'other_problem';

/**
 * API category values are deliberately snake_case while translation keys follow
 * the application's camelCase convention. Keep the conversion here so every
 * reports surface uses the same, exhaustively typed mapping.
 */
export const REPORT_CATEGORY_LABEL_KEYS: Readonly<Record<ReportCategory, string>> = {
  harassment: 'reports.categories.harassment',
  discrimination_or_unwanted_sexual_content:
    'reports.categories.discriminationOrUnwantedSexualContent',
  threats_or_safety: 'reports.categories.threatsOrSafety',
  personal_data_exposure: 'reports.categories.personalDataExposure',
  spam_advertising_scam_phishing: 'reports.categories.spamAdvertisingScamPhishing',
  impersonation: 'reports.categories.impersonation',
  public_offensive_content: 'reports.categories.publicOffensiveContent',
  intentional_game_disruption: 'reports.categories.intentionalGameDisruption',
  serious_gameplay_deception: 'reports.categories.seriousGameplayDeception',
  other_problem: 'reports.categories.otherProblem',
};

export type ReportStatus = 'collecting_evidence' | 'pending_review' | 'resolved';
export type ReportResolutionOutcome = 'strike' | 'nothing';

export interface ReportUserSummary {
  readonly id: string | null;
  readonly displayName: string;
}

/** A named item is the only folder, deck, or owned-room detail retained as evidence. */
export interface ReportEvidenceNamedItem {
  readonly name: string;
}

/** Immutable copy of a custom uploaded avatar; preset avatars are not captured. */
export interface ReportEvidenceCustomAvatar {
  readonly type: 'upload';
  readonly imageData: string;
}

export interface ReportEvidenceProfileUser {
  readonly displayName: string;
  readonly publicHandle: string | null;
  readonly avatar?: ReportEvidenceCustomAvatar;
}

export interface ReportEvidenceProfileSnapshot {
  readonly capturedAt: string;
  readonly user: ReportEvidenceProfileUser;
  readonly folders: readonly ReportEvidenceNamedItem[];
  readonly decks: readonly ReportEvidenceNamedItem[];
  readonly ownedRooms: readonly ReportEvidenceNamedItem[];
}

export interface ReportEvidenceChatMessage {
  /** 24-hour local capture time in HH:mm format. */
  readonly time: string;
  readonly actorDisplayName: string;
  readonly body: string;
}

export interface ReportEvidenceLogEntry {
  /** 24-hour local capture time in HH:mm:ss format. */
  readonly time: string;
  readonly actorDisplayName: string | null;
  readonly action: string;
}

export interface ReportEvidenceGame {
  readonly capturedAt: string;
  readonly chat: readonly ReportEvidenceChatMessage[];
  readonly gameLog: readonly ReportEvidenceLogEntry[];
}

export interface ReportEvidence {
  readonly reportedUserSnapshot: ReportEvidenceProfileSnapshot | null;
  readonly game: ReportEvidenceGame | null;
}

export interface ReportResolution {
  readonly outcome: ReportResolutionOutcome;
  readonly note: string | null;
  readonly reviewedAt: string;
  readonly reviewer: ReportUserSummary;
}

export interface ReportSubmission {
  readonly id: string;
  readonly source: ReportSource;
  readonly category: ReportCategory;
  readonly status: ReportStatus;
  readonly createdAt: string;
}

export interface AdminReport extends ReportSubmission {
  readonly comment: string | null;
  readonly reporter: ReportUserSummary;
  readonly reportedUser: ReportUserSummary;
}

export interface AdminReportDetail extends AdminReport {
  readonly resolution?: ReportResolution | null;
  readonly evidence?: ReportEvidence;
}

export interface CreateProfileReportRequest {
  readonly source: 'profile';
  readonly category: ReportCategory;
  readonly comment?: string;
  readonly reportedUserId: string;
}

export interface CreateGamePlayerReportRequest {
  readonly source: 'game_player';
  readonly category: ReportCategory;
  readonly comment?: string;
  readonly gameId: string;
  readonly reportedUserId: string;
}

export interface CreateChatMessageReportRequest {
  readonly source: 'chat_message';
  readonly category: ReportCategory;
  readonly comment?: string;
  readonly gameId: string;
  readonly messageId: string;
}

export type CreateReportRequest =
  | CreateProfileReportRequest
  | CreateGamePlayerReportRequest
  | CreateChatMessageReportRequest;

export interface CreateReportResponse {
  readonly report: ReportSubmission;
}

export interface AdminReportsResponse {
  readonly reports: readonly AdminReport[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface AdminReportResponse {
  readonly report: AdminReportDetail;
}

export interface AdminReportsSummaryResponse {
  readonly pendingReviewCount: number;
}

export interface ResolveReportRequest {
  readonly outcome: ReportResolutionOutcome;
  readonly resolutionNote?: string;
  readonly strikeDescription?: string;
}

export interface ResolveReportResponse {
  readonly report: AdminReportDetail;
  readonly strike: UserStrike | null;
}

export interface UserStrike {
  readonly id: string;
  readonly description: string;
  readonly issuedAt: string;
  readonly issuedBy: ReportUserSummary | null;
}

export interface ModerationUser {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly reportsMadeCount: number;
  readonly reportsReceivedCount: number;
  readonly strikesCount: number;
}

export interface UserModerationResponse {
  readonly user: ModerationUser;
  readonly strikes: readonly UserStrike[];
}

export interface CreateUserStrikeRequest {
  readonly description: string;
}

export interface CreateUserStrikeResponse {
  readonly strike: UserStrike | null;
  readonly strikesCount: number;
}

export interface DeleteUserStrikeResponse {
  readonly strike: UserStrike | null;
  readonly strikesCount: number;
}

export interface ReportDraftBase {
  readonly targetDisplayName: string;
}

export interface ProfileReportDraft extends ReportDraftBase {
  readonly source: 'profile';
  readonly reportedUserId: string;
}

export interface GamePlayerReportDraft extends ReportDraftBase {
  readonly source: 'game_player';
  readonly gameId: string;
  readonly reportedUserId: string;
}

export interface ChatMessageReportDraft extends ReportDraftBase {
  readonly source: 'chat_message';
  readonly gameId: string;
  readonly messageId: string;
}

export type ReportDraft = ProfileReportDraft | GamePlayerReportDraft | ChatMessageReportDraft;
