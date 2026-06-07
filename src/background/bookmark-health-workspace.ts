import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkHealthIssue,
  BookmarkHealthIssueType,
  BookmarkHealthPreview,
  BookmarkTreeNodeSnapshot,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const DEFAULT_HEALTH_CHECK_LIMIT = 80;
const MAX_HEALTH_CHECK_LIMIT = 200;
const HEALTH_CHECK_TIMEOUT_MS = 8000;
const NETWORK_PERMISSION_ORIGINS = ['http://*/*', 'https://*/*'];

export function initBookmarkHealthWorkspace(): void {
  // Read-only health scan for the organizer page. It reports risky bookmarks
  // but leaves deletion or repair decisions to later explicit workflows.
  messaging.onMessage('generateBookmarkHealthPreview', async ({ data }) => {
    return await generateBookmarkHealthPreview(data?.limit);
  });
}

async function generateBookmarkHealthPreview(limit?: number): Promise<BookmarkHealthPreview> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree);
  const networkPermissionGranted = await hasNetworkProbePermission();
  const maxChecks = clampCheckLimit(limit);
  const issues: BookmarkHealthIssue[] = [];
  let checkedCount = 0;
  let healthyCount = 0;

  for (const node of bookmarkNodes) {
    if (!node.url || checkedCount >= maxChecks) continue;

    const base = {
      bookmarkId: node.id,
      url: node.url,
      title: node.title?.trim() || t('common.untitled'),
      folderPath: getRelativeFolderPath(
        tree,
        bookmarksBarId,
        node.parentId ?? null,
        bookmarksBarLabel,
      ),
      checkedAt: Date.now(),
    };

    const localIssue = inspectBookmarkUrl(base);
    if (localIssue) {
      issues.push(localIssue);
      checkedCount += 1;
      continue;
    }

    if (!networkPermissionGranted) {
      // Without host permission we can still validate URL shape, but we should
      // not treat every unprobed HTTP bookmark as an actual bookmark issue.
      checkedCount += 1;
      continue;
    }

    const networkIssue = await probeBookmarkUrl(base);
    if (networkIssue) {
      issues.push(networkIssue);
    } else {
      healthyCount += 1;
    }
    checkedCount += 1;
  }

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    checkedCount,
    healthyCount,
    issueCount: issues.length,
    networkPermissionGranted,
    issues,
  };
}

function inspectBookmarkUrl(
  base: Omit<BookmarkHealthIssue, 'type'>,
): BookmarkHealthIssue | null {
  try {
    const url = new URL(base.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        ...base,
        type: 'unsupported_protocol',
      };
    }
    return null;
  } catch {
    return {
      ...base,
      type: 'invalid_url',
    };
  }
}

async function probeBookmarkUrl(
  base: Omit<BookmarkHealthIssue, 'type'>,
): Promise<BookmarkHealthIssue | null> {
  try {
    const response = await fetchWithTimeout(base.url);
    const issueType = classifyResponse(response);
    if (!issueType) return null;

    return {
      ...base,
      type: issueType,
      httpStatus: response.status,
      finalUrl: response.url !== base.url ? response.url : undefined,
    };
  } catch (error) {
    return {
      ...base,
      type: isAbortError(error) ? 'timeout' : 'network_error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    // HEAD keeps checks light. Some sites reject HEAD, so retry with GET only
    // for method-specific failures instead of marking those pages broken.
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status !== 405) return response;
    return await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function classifyResponse(response: Response): BookmarkHealthIssueType | null {
  if (response.status === 401 || response.status === 403) return 'login_required';
  if (response.status >= 400) return 'http_error';
  if (response.redirected) return 'redirect';
  return null;
}

async function hasNetworkProbePermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: NETWORK_PERMISSION_ORIGINS });
  } catch {
    return false;
  }
}

function flattenBookmarkNodes(tree: BookmarkTreeNodeSnapshot[]): BookmarkTreeNodeSnapshot[] {
  const result: BookmarkTreeNodeSnapshot[] = [];
  const stack = [...tree];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.url) result.push(node);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function clampCheckLimit(limit: number | undefined): number {
  const parsed = Number.isFinite(limit)
    ? Math.trunc(limit ?? DEFAULT_HEALTH_CHECK_LIMIT)
    : DEFAULT_HEALTH_CHECK_LIMIT;
  return Math.max(1, Math.min(MAX_HEALTH_CHECK_LIMIT, parsed));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
