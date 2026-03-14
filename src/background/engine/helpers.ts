import { normalizeBookmarkUrl } from '@/src/shared/bookmark-summary';
import type {
  BookmarkEvaluationSignals,
  BookmarkFolderCandidate,
  BookmarkTreeNodeSnapshot,
  DuplicateBookmarkMatch,
  PageContent,
} from '@/src/shared/types';

const MAX_FOLDER_PATHS = 300;
const MAX_FOLDER_DEPTH = 4;
const MAX_RECOMMENDATION_FOLDER_CANDIDATES = 12;
const MAX_DUPLICATE_MATCHES = 3;

export function buildEvaluationSignals(url: string, pageContent: PageContent): BookmarkEvaluationSignals {
  const parsedUrl = parseUrlSafely(url);
  const normalizedText = normalizeSpace(pageContent.text ?? '').toLowerCase();

  return {
    textLength: normalizeSpace(pageContent.text ?? '').length,
    hasPasswordField: pageContent.hasPasswordField,
    formFieldCount: pageContent.formFieldCount,
    linkCount: pageContent.linkCount,
    searchParamKeys: parsedUrl ? [...parsedUrl.searchParams.keys()].map((key) => key.toLowerCase()) : [],
    normalizedTitle: normalizeSpace(pageContent.title).toLowerCase(),
    normalizedDescription: normalizeSpace(pageContent.description).toLowerCase(),
    normalizedHeadings: normalizeSpace(pageContent.headings.join(' ')).toLowerCase(),
    normalizedText,
  };
}

export function getBookmarksBarId(tree: BookmarkTreeNodeSnapshot[]): string | null {
  return tree[0]?.children?.[0]?.id ?? null;
}

export function collectFolderPaths(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
): string[] {
  if (!bookmarksBarId) return [];

  const barNode = findNodeById(tree, bookmarksBarId);
  if (!barNode?.children) return [];

  const paths: string[] = [];
  const stack: Array<{ node: BookmarkTreeNodeSnapshot; path: string; depth: number }> = [];

  for (const child of barNode.children) {
    if (!child.url) stack.push({ node: child, path: child.title, depth: 1 });
  }

  while (stack.length > 0 && paths.length < MAX_FOLDER_PATHS) {
    const item = stack.pop();
    if (!item) break;

    paths.push(item.path);
    if (item.depth >= MAX_FOLDER_DEPTH) continue;

    for (const child of item.node.children ?? []) {
      if (child.url) continue;
      const title = trimTitle(child.title);
      if (!title) continue;
      stack.push({
        node: child,
        path: `${item.path}-${title}`,
        depth: item.depth + 1,
      });
    }
  }

  return paths.slice(0, MAX_FOLDER_PATHS);
}

export function selectFolderCandidatePaths(input: {
  tree: BookmarkTreeNodeSnapshot[];
  bookmarksBarId: string | null;
  bookmarksBarLabel: string;
  url: string;
  title: string;
  pageContent?: Pick<PageContent, 'title' | 'description' | 'headings' | 'text'>;
  currentFolderPath?: string;
  maxCandidates?: number;
}): string[] {
  return selectFolderCandidateNodes(input).map((candidate) => candidate.path);
}

export function selectFolderCandidateNodes(input: {
  tree: BookmarkTreeNodeSnapshot[];
  bookmarksBarId: string | null;
  bookmarksBarLabel: string;
  url: string;
  title: string;
  pageContent?: Pick<PageContent, 'title' | 'description' | 'headings' | 'text'>;
  currentFolderPath?: string;
  maxCandidates?: number;
}): BookmarkFolderCandidate[] {
  const maxCandidates = input.maxCandidates ?? MAX_RECOMMENDATION_FOLDER_CANDIDATES;
  if (!input.bookmarksBarId || maxCandidates <= 0) return [];

  const profiles = collectFolderProfiles(input.tree, input.bookmarksBarId, input.bookmarksBarLabel);
  const targetText = [
    input.title,
    input.pageContent?.title,
    input.pageContent?.description,
    input.pageContent?.headings?.join(' '),
    input.pageContent?.text?.slice(0, 800),
    extractUrlTerms(input.url).join(' '),
  ].filter(Boolean).join(' ');
  const targetTokens = tokenize(targetText);
  const targetDomain = getHostname(input.url);
  const targetRootDomain = getRootDomain(targetDomain);

  const scored = profiles
    .map((profile) => {
      let score = 0;
      const pathTokens = tokenize(profile.path);
      for (const token of targetTokens) {
        if (pathTokens.has(token)) score += 8;
        if (profile.titleTokens.has(token)) score += 3;
      }

      if (targetDomain && profile.hostnames.has(targetDomain)) score += 36;
      if (targetRootDomain && profile.rootDomains.has(targetRootDomain)) score += 24;
      if (input.currentFolderPath && profile.path === input.currentFolderPath) score += 18;
      if (profile.bookmarkCount > 0) score += Math.min(6, profile.bookmarkCount);
      score -= Math.max(0, profile.depth - 2);

      return { path: profile.path, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const selected: string[] = [];
  const addPath = (path: string) => {
    if (!selected.includes(path)) selected.push(path);
  };

  if (input.currentFolderPath) addPath(input.currentFolderPath);
  for (const item of scored) {
    if (selected.length >= maxCandidates) break;
    addPath(item.path);
  }

  const expanded = expandWithAncestorPaths(selected.slice(0, maxCandidates), input.bookmarksBarLabel);
  const profilesByPath = new Map(profiles.map((profile) => [profile.path, profile]));
  return expanded.map((path) =>
    toFolderCandidate(path, input.bookmarksBarLabel, profilesByPath.get(path)?.bookmarkCount),
  );
}

export function detectDuplicateMatches(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  bookmarkId: string,
  url: string,
  bookmarksBarLabel: string,
  untitledLabel: string,
): DuplicateBookmarkMatch[] {
  const normalizedTarget = normalizeBookmarkUrl(url);
  if (!normalizedTarget) return [];

  const matches: Array<DuplicateBookmarkMatch & { depth: number }> = [];
  const root = tree[0];

  for (const child of root?.children ?? []) {
    if (child.id === bookmarksBarId) {
      for (const grandchild of child.children ?? []) {
        collectDuplicateMatches(grandchild, [], normalizedTarget, bookmarkId, matches, bookmarksBarLabel, untitledLabel);
      }
      continue;
    }

    collectDuplicateMatches(child, [], normalizedTarget, bookmarkId, matches, bookmarksBarLabel, untitledLabel);
  }

  return matches
    .sort((a, b) => a.depth - b.depth || a.folderPath.localeCompare(b.folderPath) || a.title.localeCompare(b.title))
    .slice(0, MAX_DUPLICATE_MATCHES)
    .map(({ depth: _depth, ...match }) => match);
}

export function getRelativeFolderPath(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  parentId: string | null | undefined,
  bookmarksBarLabel: string,
): string {
  if (!parentId || !bookmarksBarId || parentId === bookmarksBarId) return bookmarksBarLabel;

  const parts: string[] = [];
  let currentId: string | null = parentId;

  while (currentId && currentId !== bookmarksBarId) {
    const node = findNodeById(tree, currentId);
    if (!node) break;
    const title = trimTitle(node.title);
    if (title) parts.unshift(title);
    currentId = node.parentId ?? null;
  }

  return parts.join('-') || bookmarksBarLabel;
}

export function findNodeById(
  tree: BookmarkTreeNodeSnapshot[],
  id: string,
): BookmarkTreeNodeSnapshot | null {
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.id === id) return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

export function trimTitle(title: string | undefined): string {
  return title?.trim() ?? '';
}

function collectDuplicateMatches(
  node: BookmarkTreeNodeSnapshot,
  folderPathParts: string[],
  normalizedTarget: string,
  currentBookmarkId: string,
  matches: Array<DuplicateBookmarkMatch & { depth: number }>,
  bookmarksBarLabel: string,
  untitledLabel: string,
): void {
  if (node.url) {
    const normalizedNodeUrl = normalizeBookmarkUrl(node.url);
    if (node.id !== currentBookmarkId && normalizedNodeUrl === normalizedTarget) {
      const relativeParts = folderPathParts.filter((part) => part.length > 0);
      matches.push({
        id: node.id,
        title: trimTitle(node.title) || untitledLabel,
        url: node.url,
        folderPath: relativeParts.join('-') || bookmarksBarLabel,
        depth: relativeParts.length,
      });
    }
    return;
  }

  const nextParts = node.title ? [...folderPathParts, trimTitle(node.title)] : [...folderPathParts];
  for (const child of node.children ?? []) {
    collectDuplicateMatches(child, nextParts, normalizedTarget, currentBookmarkId, matches, bookmarksBarLabel, untitledLabel);
  }
}

function parseUrlSafely(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectFolderProfiles(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string,
  bookmarksBarLabel: string,
): Array<{
  path: string;
  depth: number;
  bookmarkCount: number;
  hostnames: Set<string>;
  rootDomains: Set<string>;
  titleTokens: Set<string>;
}> {
  const barNode = findNodeById(tree, bookmarksBarId);
  if (!barNode) return [];

  const profiles: Array<{
    path: string;
    depth: number;
    bookmarkCount: number;
    hostnames: Set<string>;
    rootDomains: Set<string>;
    titleTokens: Set<string>;
  }> = [];
  const stack: Array<{ node: BookmarkTreeNodeSnapshot; path: string; depth: number }> = [];

  profiles.push({
    path: bookmarksBarLabel,
    depth: 0,
    bookmarkCount: 0,
    hostnames: new Set(),
    rootDomains: new Set(),
    titleTokens: new Set(),
  });

  for (const child of barNode.children ?? []) {
    if (!child.url) stack.push({ node: child, path: trimTitle(child.title), depth: 1 });
  }

  while (stack.length > 0 && profiles.length < MAX_FOLDER_PATHS) {
    const item = stack.pop();
    if (!item || !item.path) continue;

    const bookmarks = flattenBookmarkChildren(item.node);
    const hostnames = new Set<string>();
    const rootDomains = new Set<string>();
    const titleTokens = new Set<string>();

    for (const bookmark of bookmarks) {
      const hostname = getHostname(bookmark.url ?? '');
      if (hostname) hostnames.add(hostname);
      const rootDomain = getRootDomain(hostname);
      if (rootDomain) rootDomains.add(rootDomain);
      for (const token of tokenize(bookmark.title ?? '')) titleTokens.add(token);
      for (const token of tokenize(extractUrlTerms(bookmark.url ?? '').join(' '))) titleTokens.add(token);
    }

    profiles.push({
      path: item.path,
      depth: item.depth,
      bookmarkCount: bookmarks.length,
      hostnames,
      rootDomains,
      titleTokens,
    });

    if (item.depth >= MAX_FOLDER_DEPTH) continue;
    for (const child of item.node.children ?? []) {
      if (child.url) continue;
      const title = trimTitle(child.title);
      if (!title) continue;
      stack.push({
        node: child,
        path: `${item.path}-${title}`,
        depth: item.depth + 1,
      });
    }
  }

  return profiles;
}

function flattenBookmarkChildren(node: BookmarkTreeNodeSnapshot): BookmarkTreeNodeSnapshot[] {
  const result: BookmarkTreeNodeSnapshot[] = [];
  const stack = [...(node.children ?? [])];

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child) break;
    if (child.url) {
      result.push(child);
      continue;
    }
    for (const grandchild of child.children ?? []) stack.push(grandchild);
  }

  return result;
}

function tokenize(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!normalized) return new Set();

  return new Set(
    normalized
      .split(/\s+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  );
}

function extractUrlTerms(url: string): string[] {
  const parsed = parseUrlSafely(url);
  if (!parsed) return [];
  return [
    parsed.hostname.replace(/^www\./, ''),
    ...parsed.pathname.split(/[/?#._-]+/g),
  ].filter(Boolean);
}

function getHostname(url: string): string {
  const parsed = parseUrlSafely(url);
  return parsed?.hostname.replace(/^www\./, '').toLowerCase() ?? '';
}

function getRootDomain(hostname: string): string {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'http',
  'https',
  'www',
  'com',
  'org',
  'net',
  'app',
  '工具',
  '页面',
  '网站',
]);

function toFolderCandidate(
  path: string,
  bookmarksBarLabel: string,
  bookmarkCount?: number,
): BookmarkFolderCandidate {
  if (path === bookmarksBarLabel) {
    return {
      path,
      name: bookmarksBarLabel,
      parentPath: null,
      depth: 0,
      bookmarkCount,
    };
  }

  const parts = path.split('-').map((part) => part.trim()).filter(Boolean);
  const name = parts.at(-1) ?? path;
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('-') : bookmarksBarLabel;
  return {
    path,
    name,
    parentPath,
    depth: parts.length,
    bookmarkCount,
  };
}

function expandWithAncestorPaths(paths: string[], bookmarksBarLabel: string): string[] {
  const expanded: string[] = [];
  const addPath = (path: string) => {
    if (!expanded.includes(path)) expanded.push(path);
  };

  addPath(bookmarksBarLabel);
  for (const path of paths) {
    if (path === bookmarksBarLabel) continue;
    const parts = path.split('-').map((part) => part.trim()).filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      addPath(parts.slice(0, index).join('-'));
    }
  }

  return expanded;
}
