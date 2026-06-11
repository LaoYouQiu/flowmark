export type Locale = "en" | "zh-CN";
export type LocaleOverride = "auto" | Locale;
export type OrganizeIntensity = "conservative" | "balanced" | "aggressive";

export interface FlowmarkSettings {
  // User-facing switches and AI provider settings. The resolved settings layer
  // turns these raw preferences into per-feature enablement flags.
  enabled: boolean;
  duplicateCheckEnabled: boolean;
  pageQualityFilterEnabled: boolean;
  summaryEnabled: boolean;
  autoAcceptEnabled: boolean;
  autoAcceptSeconds: number;
  sendPageText: boolean;
  maxPageChars: number;
  organizeIntensity: OrganizeIntensity;
  smartOrganizeBatchSize: number;
  folderCandidateLimit: number;
  aiBaseURL: string;
  aiApiKey: string;
  aiModel: string;
  localeOverride: LocaleOverride;
}

export const DEFAULT_SETTINGS: FlowmarkSettings = {
  enabled: true,
  duplicateCheckEnabled: true,
  pageQualityFilterEnabled: true,
  summaryEnabled: true,
  autoAcceptEnabled: true,
  autoAcceptSeconds: 5,
  sendPageText: false,
  maxPageChars: 5000,
  organizeIntensity: "balanced",
  smartOrganizeBatchSize: 20,
  folderCandidateLimit: 12,
  aiBaseURL: "",
  aiApiKey: "",
  aiModel: "",
  localeOverride: "auto",
};

export interface FlowmarkFeatureConfig {
  recommendation: { enabled: boolean };
  duplicate: { enabled: boolean };
  pageQuality: { enabled: boolean };
  summary: { enabled: boolean };
}

export interface ResolvedFlowmarkSettings {
  raw: FlowmarkSettings;
  features: FlowmarkFeatureConfig;
}

export interface PageContent {
  // A compact page snapshot collected by the content script. Background
  // policies use these signals before deciding whether an AI call is worthwhile.
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string | null;
  hasPasswordField: boolean;
  formFieldCount: number;
  linkCount: number;
}

export interface GetPageContentRequest {
  includeText: boolean;
  maxChars: number;
}

export interface BookmarkSuggestion {
  suggestedFolder: string;
  title: string;
  confidence: number;
  summary: string;
}

export interface BookmarkFolderCandidate {
  // Candidate folders are a token-conscious view of the user's bookmark tree.
  // The app sends only these likely folders to AI, then maps the returned ID
  // back to the real path locally.
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  bookmarkCount?: number;
}

export type ExistingBookmarkPlanAction =
  // Smart Organize suggestions are represented as explicit actions so the UI
  // can show exactly what will happen before applying a recommendation.
  | {
      type: "move";
      targetFolderPath: string;
    }
  | {
      type: "rename";
      title: string;
    }
  | {
      type: "summary";
      summary: string;
    }
  | {
      type: "create_folder";
      parentFolderPath: string;
      folderName: string;
      targetFolderPath: string;
    }
  | {
      type: "delete";
      reason: "duplicate" | "low_quality" | "broken" | "other";
    }
  | {
      type: "merge";
      targetBookmarkId: string;
    }
  | {
      type: "keep";
    };

export type ExistingBookmarkSuggestionReason =
  | "new_folder"
  | "move_folder"
  | "folder_and_metadata"
  | "metadata_only"
  | "rename_only"
  | "summary_only"
  | "keep";

export interface ExistingBookmarkSuggestionItem {
  bookmarkId: string;
  url: string;
  originalTitle: string;
  currentFolderPath: string;
  suggestedFolder: string;
  suggestedTitle: string;
  confidence: number;
  summary: string;
  reason: ExistingBookmarkSuggestionReason;
  actions: ExistingBookmarkPlanAction[];
}

export interface ExistingBookmarkSuggestionPreview {
  totalBookmarksScanned: number;
  suggestionCount: number;
  suggestions: ExistingBookmarkSuggestionItem[];
}

export interface SmartOrganizeJobSnapshot {
  // Public progress shape for long Smart Organize scans. The background keeps
  // extra cursor state privately and returns this snapshot to the organize UI.
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  total: number;
  scanned: number;
  suggestionCount: number;
  batchSize: number;
  suggestions: ExistingBookmarkSuggestionItem[];
  error?: string;
}

export interface ExistingBookmarkApplyActions {
  moveToFolder: boolean;
  renameTitle: boolean;
  updateSummary: boolean;
}

export interface DuplicateBookmarkCandidate {
  id: string;
  title: string;
  url: string;
  folderPath: string;
  hasSummary?: boolean;
}

export interface DuplicateBookmarkGroup {
  // One normalized URL can have many bookmark records with different titles or
  // folders. The group stores both the recommended merge plan and the user's
  // chosen keep/delete selection.
  normalizedUrl: string;
  url: string;
  items: DuplicateBookmarkCandidate[];
  keepBookmarkId: string;
  suggestedTitle: string;
  suggestedFolderPath: string;
  removeBookmarkIds: string[];
  actions: Array<
    | {
        type: "rename";
        bookmarkId: string;
        title: string;
      }
    | {
        type: "merge_summary";
        fromBookmarkIds: string[];
        toBookmarkId: string;
      }
    | {
        type: "delete";
        bookmarkIds: string[];
      }
  >;
}

export interface DuplicateBookmarkPreview {
  totalBookmarksScanned: number;
  duplicateGroupCount: number;
  groups: DuplicateBookmarkGroup[];
}

export interface DuplicateBookmarkScanJobSnapshot extends DuplicateBookmarkPreview {
  id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  scanned: number;
  error?: string;
}

export interface DuplicateBookmarkMergeSelection {
  normalizedUrl: string;
  keepBookmarkId: string;
  removeBookmarkIds: string[];
}

export interface FolderAuditIssue {
  // Folder Audit normalizes several structural concerns into one card shape:
  // empty folders, sparse folders, deep paths, and similar-path merge candidates.
  id: string;
  path: string;
  type: "empty_folder" | "sparse_folder" | "deep_folder" | "similar_folder";
  bookmarkCount: number;
  subfolderCount: number;
  depth: number;
  similarFolderPaths?: string[];
  suggestedTargetFolderId?: string;
  suggestedTargetFolderPath?: string;
  mergeBookmarkCount?: number;
}

export interface ApplyFolderMergeIssueRequest {
  sourceFolderId: string;
  targetFolderId: string;
}

export interface ApplyFolderMergeIssueResult {
  movedCount: number;
  removedDuplicateCount: number;
  deletedFolderCount: number;
}

export interface FolderAuditPreview {
  totalFoldersScanned: number;
  emptyFolderCount: number;
  sparseFolderCount: number;
  deepFolderCount: number;
  similarFolderCount: number;
  issues: FolderAuditIssue[];
}

export type BookmarkHealthIssueType =
  | "invalid_url"
  | "unsupported_protocol"
  | "permission_missing"
  | "timeout"
  | "network_error"
  | "http_error"
  | "login_required"
  | "redirect";

export interface BookmarkHealthIssue {
  bookmarkId: string;
  url: string;
  title: string;
  folderPath: string;
  type: BookmarkHealthIssueType;
  checkedAt: number;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
}

export interface BookmarkHealthPreview {
  // Health checks are read-only. Network probing is capped so users can review
  // a useful sample without hammering every saved site at once.
  totalBookmarksScanned: number;
  checkedCount: number;
  healthyCount: number;
  issueCount: number;
  networkPermissionGranted: boolean;
  issues: BookmarkHealthIssue[];
}

export interface SummaryToolItem {
  bookmarkId: string;
  url: string;
  title: string;
  folderPath: string;
  summary: string | null;
  hasSummary: boolean;
}

export interface SummaryToolPreview {
  totalBookmarksScanned: number;
  missingSummaryCount: number;
  items: SummaryToolItem[];
}

export interface SummarySearchResultItem {
  bookmarkId: string;
  url: string;
  title: string;
  folderPath: string;
  summary: string;
  updatedAt: number;
}

export interface SummarySearchResult {
  query: string;
  totalBookmarksScanned: number;
  matchCount: number;
  items: SummarySearchResultItem[];
}

export interface BookmarkBackupNode {
  // Portable bookmark-tree snapshot used for user backups. It intentionally
  // avoids browser-internal parent references because children already encode
  // the structure needed for inspection or future restore tooling.
  id: string;
  title: string;
  type: "folder" | "bookmark";
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  summary?: BookmarkSummaryRecord;
  children?: BookmarkBackupNode[];
}

export interface BookmarkBackupExport {
  // JSON export payload returned by background and downloaded by the organizer.
  // schemaVersion lets future import/restore features evolve this format safely.
  schemaVersion: 1;
  exportedAt: string;
  source: "flowmark";
  bookmarkCount: number;
  folderCount: number;
  summaryCount: number;
  roots: BookmarkBackupNode[];
}

export type BookmarkBackupFormat = "json" | "html";

export interface BookmarkBackupDownload {
  // Download-ready backup response. Keeping the serialized content in one
  // shape lets the UI support more export formats without knowing their internals.
  fileName: string;
  mimeType: string;
  content: string;
  format: BookmarkBackupFormat;
  bookmarkCount: number;
  folderCount: number;
}

export interface DebugBookmarkSeedResult {
  requestedCount: number;
  createdCount: number;
  rootFolderId: string;
  rootFolderTitle: string;
}

export interface DuplicateBookmarkMatch {
  id: string;
  title: string;
  url: string;
  folderPath: string;
}

export type BookmarkPageQualityReason =
  | "login_page"
  | "search_results"
  | "low_information_density";

export interface BookmarkSummaryRecord {
  bookmarkId: string;
  url: string;
  normalizedUrl: string;
  title: string;
  folderPath: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

export type OperationHistoryChange =
  | {
      type: "move_bookmark";
      bookmarkId: string;
      title: string;
      url: string;
      fromParentId: string;
      toParentId: string;
    }
  | {
      type: "rename_bookmark";
      bookmarkId: string;
      fromTitle: string;
      toTitle: string;
    }
  | {
      type: "delete_bookmark";
      bookmarkId: string;
      title: string;
      url: string;
      parentId: string;
      summary?: BookmarkSummaryRecord;
    }
  | {
      // Summary writes are reversible: restore the previous record, or remove
      // the summary if Smart Organize created it from scratch.
      type: "update_summary";
      bookmarkId: string;
      fromSummary: BookmarkSummaryRecord | null;
      toSummary: BookmarkSummaryRecord;
    }
  | {
      type: "delete_empty_folder";
      folderId: string;
      title: string;
      parentId: string;
    };

export interface OperationHistoryEntry {
  id: string;
  kind:
    | "duplicate_cleanup"
    | "folder_merge"
    | "smart_organize"
    | "bookmark_recommendation";
  label: string;
  createdAt: number;
  changes: OperationHistoryChange[];
}

export interface UndoOperationHistoryResult {
  restoredCount: number;
  skippedCount: number;
}

export interface BookmarkEvaluationSignals {
  textLength: number;
  hasPasswordField: boolean;
  formFieldCount: number;
  linkCount: number;
  searchParamKeys: string[];
  normalizedTitle: string;
  normalizedDescription: string;
  normalizedHeadings: string;
  normalizedText: string;
}

export interface BookmarkTreeNodeSnapshot {
  id: string;
  title: string;
  url?: string | undefined;
  children?: BookmarkTreeNodeSnapshot[] | undefined;
  parentId?: string | undefined;
  dateAdded?: number | undefined;
  dateGroupModified?: number | undefined;
}

export type BookmarkEvaluationState =
  | "pending_confirmation"
  | "evaluating"
  | "waiting_user_decision"
  | "continuing_after_decision"
  | "completed"
  | "dismissed";

export interface BookmarkEvaluationContext {
  bookmarkId: string;
  url: string;
  originalTitle: string;
  tabId: number;
  locale: Locale;
  settings: ResolvedFlowmarkSettings;
  pageContent: PageContent;
  signals: BookmarkEvaluationSignals;
  bookmarksBarId: string | null;
  bookmarkTreeSnapshot: BookmarkTreeNodeSnapshot[];
}

export interface BookmarkCardMetaItem {
  label?: string;
  value: string;
  tone?: "default" | "muted" | "success" | "warning" | "danger";
}

export interface BookmarkCardActionPayload {
  targetBookmarkId?: string;
  suggestedFolder?: string;
  title?: string;
  summary?: string;
  suppressMs?: number;
}

export interface BookmarkCardAction {
  id: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  intent: "submit" | "open-options";
  payload?: BookmarkCardActionPayload;
}

export interface BookmarkDecisionCard {
  id: string;
  policyId: string;
  kind: "info" | "warning" | "decision" | "error" | "recommendation";
  bookmarkId: string;
  url: string;
  title: string;
  headline: string;
  body?: string;
  badge?: string;
  meta?: BookmarkCardMetaItem[];
  actions: BookmarkCardAction[];
  autoDismissMs?: number;
  autoActionId?: string;
}

export interface BookmarkCardUpdatePayload {
  card: BookmarkDecisionCard;
}

export interface SubmitBookmarkCardActionRequest {
  bookmarkId: string;
  cardId: string;
  actionId: string;
  payload?: BookmarkCardActionPayload;
}

export interface BookmarkPolicyContinuation {
  nextPolicyIndex: number;
}

export type PolicyResult =
  | { type: "pass" }
  | {
      type: "card";
      card: BookmarkDecisionCard;
      continuation?: BookmarkPolicyContinuation;
    }
  | {
      type: "terminal";
      reason: "bookmark_missing" | "dismissed" | "completed";
    };

export interface BookmarkActionStore {
  removeJob(bookmarkId: string): void;
  setState(bookmarkId: string, state: BookmarkEvaluationState): void;
  setActiveCard(bookmarkId: string, card?: BookmarkDecisionCard): void;
  setContinuation(
    bookmarkId: string,
    continuation?: BookmarkPolicyContinuation,
  ): void;
  enqueue(bookmarkId: string): void;
  suppress(bookmarkId: string, durationMs: number): void;
}

export interface BookmarkActionServices {
  store: BookmarkActionStore;
  continueEvaluation(bookmarkId: string): void;
  bookmarkExists(bookmarkId: string): Promise<boolean>;
  removeBookmark(bookmarkId: string): Promise<void>;
  moveBookmark(bookmarkId: string, parentId: string): Promise<void>;
  updateBookmarkTitle(
    bookmarkId: string,
    title: string,
  ): Promise<{ id: string; title: string; url?: string | undefined }>;
  getBookmark(bookmarkId: string): Promise<{
    id: string;
    title: string;
    url?: string | undefined;
    parentId?: string | undefined;
  } | null>;
  getBookmarksBarId(): Promise<string | null>;
  getBookmarksBarLabel(
    settings?: Pick<FlowmarkSettings, "localeOverride">,
  ): Promise<string>;
  findOrCreateFolderPath(
    bookmarksBarId: string,
    folderPath: string,
  ): Promise<string>;
  openBookmarkById(bookmarkId: string): Promise<void>;
  getResolvedSettings(): Promise<ResolvedFlowmarkSettings>;
  upsertBookmarkSummary(input: {
    bookmarkId: string;
    url: string;
    title: string;
    folderPath: string;
    summary: string;
  }): Promise<void>;
}

export type BookmarkPolicyActionResult =
  | { type: "completed" }
  | { type: "dismissed" }
  | { type: "continue" }
  | { type: "noop" };

export interface BookmarkPolicyActionInput {
  context: BookmarkEvaluationContext;
  card: BookmarkDecisionCard;
  actionId: string;
  payload?: BookmarkCardActionPayload;
  services: BookmarkActionServices;
}

export interface BookmarkPolicy {
  id: string;
  enabled(context: BookmarkEvaluationContext): boolean;
  getProgressCard?(
    context: BookmarkEvaluationContext,
  ): BookmarkDecisionCard | null;
  evaluate(context: BookmarkEvaluationContext): Promise<PolicyResult>;
  executeAction(
    input: BookmarkPolicyActionInput,
  ): Promise<BookmarkPolicyActionResult>;
}
