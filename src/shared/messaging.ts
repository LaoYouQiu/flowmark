import { defineExtensionMessaging } from '@webext-core/messaging';

import type {
  BookmarkCardUpdatePayload,
  ApplyFolderMergeIssueRequest,
  ApplyFolderMergeIssueResult,
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
  SubmitBookmarkCardActionRequest,
  UndoOperationHistoryResult,
} from './types';

export interface ProtocolMap {
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
  listOperationHistory(): { entries: OperationHistoryEntry[] };
  undoOperationHistoryEntry(payload: { entryId: string }): UndoOperationHistoryResult;
  generateSummaryToolPreview(): SummaryToolPreview;
  generateBookmarkSummaries(payload: { bookmarkIds: string[] }): { updatedCount: number };
}

export const messaging = defineExtensionMessaging<ProtocolMap>();
