import { defineExtensionMessaging } from '@webext-core/messaging';

import type {
  BookmarkCardUpdatePayload,
  DuplicateBookmarkPreview,
  ExistingBookmarkApplyActions,
  ExistingBookmarkSuggestionPreview,
  FolderAuditPreview,
  GetPageContentRequest,
  PageContent,
  SummaryToolPreview,
  SubmitBookmarkCardActionRequest,
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
  generateDuplicateBookmarkPreview(): DuplicateBookmarkPreview;
  removeDuplicateBookmarks(payload: { bookmarkIds: string[] }): { removedCount: number };
  generateFolderAuditPreview(): FolderAuditPreview;
  generateSummaryToolPreview(): SummaryToolPreview;
  generateBookmarkSummaries(payload: { bookmarkIds: string[] }): { updatedCount: number };
}

export const messaging = defineExtensionMessaging<ProtocolMap>();
