import { initLifecyclePages } from '@/src/background/lifecycle-pages';
import { initBookmarkRecommendation } from '@/src/background/bookmark-recommendation';
import { initExistingBookmarkOnboarding } from '@/src/background/existing-bookmark-onboarding';
import { initDuplicateBookmarkWorkspace } from '@/src/background/duplicate-bookmark-workspace';
import { initFolderAuditWorkspace } from '@/src/background/folder-audit-workspace';
import { initSummaryToolWorkspace } from '@/src/background/summary-tool-workspace';
import { initOperationHistoryWorkspace } from '@/src/background/operation-history-workspace';
import { initBookmarkBackupWorkspace } from '@/src/background/bookmark-backup-workspace';
import { initBookmarkHealthWorkspace } from '@/src/background/bookmark-health-workspace';

export default defineBackground(() => {
  // The background worker is the extension's coordinator. Each init call
  // registers listeners or messaging handlers for one feature area.
  initLifecyclePages();
  initBookmarkRecommendation();
  initExistingBookmarkOnboarding();
  initDuplicateBookmarkWorkspace();
  initFolderAuditWorkspace();
  initSummaryToolWorkspace();
  initOperationHistoryWorkspace();
  initBookmarkBackupWorkspace();
  initBookmarkHealthWorkspace();
});
