import { defineExtensionMessaging } from '@webext-core/messaging';

import type {
  BookmarkCardUpdatePayload,
  ApplyFolderMergeIssueRequest,
  ApplyFolderMergeIssueResult,
  BookmarkBackupDownload,
  BookmarkBackupFormat,
  BookmarkHealthPreview,
  DuplicateBookmarkPreview,
  DuplicateBookmarkMergeSelection,
  ExistingBookmarkApplyActions,
  ExistingBookmarkSuggestionPreview,
  FolderAuditPreview,
  GetPageContentRequest,
  PageContent,
  OperationHistoryEntry,
  SmartOrganizeJobSnapshot,
  SummaryToolPreview,
  SummarySearchResult,
  SubmitBookmarkCardActionRequest,
  UndoOperationHistoryResult,
} from './types';

export interface ProtocolMap {
  // Typed message contract between content scripts, UI pages, and background.
  // Keeping the payloads here makes feature modules evolve without stringly
  // typed request/response pairs scattered through the extension.
  bookmarkCardUpdate(payload: BookmarkCardUpdatePayload): void;
  submitBookmarkCardAction(payload: SubmitBookmarkCardActionRequest): void;
  getPageContent(payload: GetPageContentRequest): PageContent;
  openOptions(): void;
  generateExistingBookmarkPreview(): ExistingBookmarkSuggestionPreview;
  applyExistingBookmarkPreview(payload: {
    preview: ExistingBookmarkSuggestionPreview;
    actions: ExistingBookmarkApplyActions;
  }): { appliedCount: number };
  startSmartOrganizeJob(payload?: { batchSize?: number }): SmartOrganizeJobSnapshot;
  runSmartOrganizeJobBatch(payload: { jobId: string }): SmartOrganizeJobSnapshot;
  cancelSmartOrganizeJob(payload: { jobId: string }): SmartOrganizeJobSnapshot;
  generateDuplicateBookmarkPreview(): DuplicateBookmarkPreview;
  removeDuplicateBookmarks(payload: {
    bookmarkIds: string[];
    mergeSelections?: DuplicateBookmarkMergeSelection[];
  }): { removedCount: number };
  generateFolderAuditPreview(): FolderAuditPreview;
  applyFolderMergeIssue(payload: ApplyFolderMergeIssueRequest): ApplyFolderMergeIssueResult;
  generateBookmarkHealthPreview(payload?: { limit?: number }): BookmarkHealthPreview;
  exportBookmarkBackup(payload?: { format?: BookmarkBackupFormat }): BookmarkBackupDownload;
  listOperationHistory(): { entries: OperationHistoryEntry[] };
  undoOperationHistoryEntry(payload: { entryId: string }): UndoOperationHistoryResult;
  generateSummaryToolPreview(): SummaryToolPreview;
  generateBookmarkSummaries(payload: { bookmarkIds: string[] }): { updatedCount: number };
  searchBookmarkSummaries(payload: { query: string; limit?: number }): SummarySearchResult;
}

export const messaging = defineExtensionMessaging<ProtocolMap>();
