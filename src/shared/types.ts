export type Locale = "en" | "zh-CN";
export type LocaleOverride = "auto" | Locale;

export interface FlowmarkSettings {
  enabled: boolean;
  duplicateCheckEnabled: boolean;
  pageQualityFilterEnabled: boolean;
  summaryEnabled: boolean;
  autoAcceptEnabled: boolean;
  autoAcceptSeconds: number;
  sendPageText: boolean;
  maxPageChars: number;
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
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  bookmarkCount?: number;
}

export type ExistingBookmarkPlanAction =
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

export interface ExistingBookmarkSuggestionItem {
  bookmarkId: string;
  url: string;
  originalTitle: string;
  currentFolderPath: string;
  suggestedFolder: string;
  suggestedTitle: string;
  confidence: number;
  summary: string;
  reason: string;
  actions: ExistingBookmarkPlanAction[];
}

export interface ExistingBookmarkSuggestionPreview {
  totalBookmarksScanned: number;
  suggestionCount: number;
  suggestions: ExistingBookmarkSuggestionItem[];
}

export interface SmartOrganizeJobSnapshot {
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

export interface DuplicateBookmarkMergeSelection {
  normalizedUrl: string;
  keepBookmarkId: string;
  removeBookmarkIds: string[];
}

export interface FolderAuditIssue {
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
