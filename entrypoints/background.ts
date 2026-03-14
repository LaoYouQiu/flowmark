import { initLifecyclePages } from '@/src/background/lifecycle-pages';
import { initBookmarkRecommendation } from '@/src/background/bookmark-recommendation';
import { initExistingBookmarkOnboarding } from '@/src/background/existing-bookmark-onboarding';
import { initDuplicateBookmarkWorkspace } from '@/src/background/duplicate-bookmark-workspace';
import { initFolderAuditWorkspace } from '@/src/background/folder-audit-workspace';
import { initSummaryToolWorkspace } from '@/src/background/summary-tool-workspace';
import { initOperationHistoryWorkspace } from '@/src/background/operation-history-workspace';

export default defineBackground(() => {
  initLifecyclePages();
  initBookmarkRecommendation();
  initExistingBookmarkOnboarding();
  initDuplicateBookmarkWorkspace();
  initFolderAuditWorkspace();
  initSummaryToolWorkspace();
  initOperationHistoryWorkspace();
});
