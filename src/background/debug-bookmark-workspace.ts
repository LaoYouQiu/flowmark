import { messaging } from '@/src/shared/messaging';
import type { DebugBookmarkSeedResult } from '@/src/shared/types';

const MAX_DEBUG_BOOKMARKS = 4000;
const DEBUG_FOLDER_PREFIX = 'FlowMark Debug';

type DebugBookmarkTemplate = {
  folder: string;
  title: string;
  url: string;
};

type DebugBookmarkPlan = {
  folder: string;
  title: string;
  url: string;
};

const messyFolderPrefixes = [
  'Inbox',
  'Saved',
  'Later',
  'Archive',
  'Quick Links',
  'Temp',
  'Old',
  'Favorites',
];

const messyFolderSuffixes = [
  '2024',
  '2025',
  'misc',
  'backup',
  'review',
  'todo',
  'v2',
  'refs',
];

const titleStyles = [
  (title: string, sequence: string) => `${title} - Test ${sequence}`,
  (title: string) => title,
  (title: string, sequence: string) => `${sequence} ${title}`,
  (title: string) => title.toLowerCase(),
  (title: string) => title.toUpperCase(),
  (title: string) => `read later: ${title}`,
  (title: string) => `TODO - ${title}`,
  (title: string) => `${title} | reference`,
  (title: string) => `${title} notes`,
  (title: string) => `www.${slugify(title)}.com`,
];

const debugBookmarkTemplates: DebugBookmarkTemplate[] = [
  {
    folder: 'Tools / AI',
    title: 'OpenAI Documentation',
    url: 'https://platform.openai.com/docs',
  },
  {
    folder: 'Tools / AI',
    title: 'Claude Documentation',
    url: 'https://docs.anthropic.com/',
  },
  {
    folder: 'Tools / AI',
    title: 'Hugging Face Models',
    url: 'https://huggingface.co/models',
  },
  {
    folder: 'Tools / Development',
    title: 'GitHub Docs',
    url: 'https://docs.github.com/',
  },
  {
    folder: 'Tools / Development',
    title: 'MDN JavaScript Guide',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
  },
  {
    folder: 'Tools / Development',
    title: 'TypeScript Handbook',
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
  },
  {
    folder: 'Tools / Development',
    title: 'Vite Guide',
    url: 'https://vite.dev/guide/',
  },
  {
    folder: 'Learning / Frontend',
    title: 'SolidJS Docs',
    url: 'https://docs.solidjs.com/',
  },
  {
    folder: 'Learning / Frontend',
    title: 'React Learn',
    url: 'https://react.dev/learn',
  },
  {
    folder: 'Learning / Frontend',
    title: 'Tailwind CSS Docs',
    url: 'https://tailwindcss.com/docs',
  },
  {
    folder: 'Learning / Design',
    title: 'Material Design',
    url: 'https://m3.material.io/',
  },
  {
    folder: 'Learning / Design',
    title: 'Apple Human Interface Guidelines',
    url: 'https://developer.apple.com/design/human-interface-guidelines',
  },
  {
    folder: 'Learning / Design',
    title: 'Nielsen Norman Group Articles',
    url: 'https://www.nngroup.com/articles/',
  },
  {
    folder: 'Reference / Web',
    title: 'Chrome Extensions Documentation',
    url: 'https://developer.chrome.com/docs/extensions',
  },
  {
    folder: 'Reference / Web',
    title: 'Web.dev Articles',
    url: 'https://web.dev/articles',
  },
  {
    folder: 'Reference / Web',
    title: 'Can I Use',
    url: 'https://caniuse.com/',
  },
  {
    folder: 'Reference / Product',
    title: 'Product Hunt',
    url: 'https://www.producthunt.com/',
  },
  {
    folder: 'Reference / Product',
    title: 'Linear Changelog',
    url: 'https://linear.app/changelog',
  },
  {
    folder: 'Reference / Product',
    title: 'Notion Help Center',
    url: 'https://www.notion.com/help',
  },
  {
    folder: 'Writing / Knowledge',
    title: 'Wikipedia Main Page',
    url: 'https://www.wikipedia.org/',
  },
  {
    folder: 'Writing / Knowledge',
    title: 'The Marginalian',
    url: 'https://www.themarginalian.org/',
  },
  {
    folder: 'Writing / Knowledge',
    title: 'Google Scholar',
    url: 'https://scholar.google.com/',
  },
  {
    folder: 'Productivity / Notes',
    title: 'Obsidian Help',
    url: 'https://help.obsidian.md/',
  },
  {
    folder: 'Productivity / Notes',
    title: 'Readwise Reader',
    url: 'https://readwise.io/read',
  },
  {
    folder: 'Productivity / Notes',
    title: 'Raindrop.io',
    url: 'https://raindrop.io/',
  },
  {
    folder: 'News / Technology',
    title: 'Hacker News',
    url: 'https://news.ycombinator.com/',
  },
  {
    folder: 'News / Technology',
    title: 'The Verge Tech',
    url: 'https://www.theverge.com/tech',
  },
  {
    folder: 'News / Technology',
    title: 'Ars Technica',
    url: 'https://arstechnica.com/',
  },
  {
    folder: 'Research / Papers',
    title: 'arXiv Computer Science',
    url: 'https://arxiv.org/list/cs/recent',
  },
  {
    folder: 'Research / Papers',
    title: 'Papers with Code',
    url: 'https://paperswithcode.com/',
  },
  {
    folder: 'Research / Papers',
    title: 'Semantic Scholar',
    url: 'https://www.semanticscholar.org/',
  },
  {
    folder: 'Infrastructure / Cloud',
    title: 'Cloudflare Docs',
    url: 'https://developers.cloudflare.com/',
  },
  {
    folder: 'Infrastructure / Cloud',
    title: 'AWS Documentation',
    url: 'https://docs.aws.amazon.com/',
  },
  {
    folder: 'Infrastructure / Cloud',
    title: 'Vercel Docs',
    url: 'https://vercel.com/docs',
  },
];

export function initDebugBookmarkWorkspace(): void {
  messaging.onMessage('createDebugBookmarks', async ({ data }) => {
    return await createDebugBookmarks(data.count);
  });
}

async function createDebugBookmarks(requestedCount: number): Promise<DebugBookmarkSeedResult> {
  const count = clampCount(requestedCount);
  const rootParentId = await getWritableRootParentId();
  const folderTitle = `${DEBUG_FOLDER_PREFIX} ${formatDateForFolder(new Date())}`;
  const rootFolder = await browser.bookmarks.create({ parentId: rootParentId, title: folderTitle });
  const folderIds = new Map<string, string>();
  const plans = shuffle(Array.from({ length: count }, (_, index) => createBookmarkPlan(index)));

  for (const plan of plans) {
    const parentId = await ensureFolderPath(rootFolder.id, plan.folder, folderIds);
    await browser.bookmarks.create({
      parentId,
      title: plan.title,
      url: plan.url,
    });
  }

  return {
    requestedCount,
    createdCount: count,
    rootFolderId: rootFolder.id,
    rootFolderTitle: folderTitle,
  };
}

async function ensureFolderPath(
  rootFolderId: string,
  folder: string,
  folderIds: Map<string, string>,
): Promise<string> {
  let parentId = rootFolderId;
  const parts = folder.split(' / ');
  const pathParts: string[] = [];
  for (const part of parts) {
    pathParts.push(part);
    const path = pathParts.join(' / ');
    const existingId = folderIds.get(path);
    if (existingId) {
      parentId = existingId;
      continue;
    }
    const created = await browser.bookmarks.create({ parentId, title: part });
    folderIds.set(path, created.id);
    parentId = created.id;
  }

  return parentId;
}

async function getWritableRootParentId(): Promise<string | undefined> {
  const [root] = await browser.bookmarks.getTree();
  const firstRootFolder = root.children?.find((node) => !node.url);
  return firstRootFolder?.id;
}

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 100;
  return Math.min(MAX_DEBUG_BOOKMARKS, Math.max(1, Math.floor(count)));
}

function createBookmarkPlan(index: number): DebugBookmarkPlan {
  const template = randomItem(debugBookmarkTemplates);
  return {
    folder: makeFolderPath(template, index),
    title: makeTitle(template.title, index),
    url: makeUrl(template.url, index),
  };
}

function makeTitle(baseTitle: string, index: number): string {
  const sequence = String(index + 1).padStart(4, '0');
  const style = randomItem(titleStyles);
  const title = style(baseTitle, sequence).replace(/\s+/g, ' ').trim();
  return title || `${baseTitle} - Test ${sequence}`;
}

function makeFolderPath(template: DebugBookmarkTemplate, index: number): string {
  const baseParts = template.folder.split(' / ');
  const variant = randomInt(0, 9);

  if (variant === 0) return template.folder;
  if (variant === 1) return [...baseParts].reverse().join(' / ');
  if (variant === 2) return [randomItem(messyFolderPrefixes), ...baseParts].join(' / ');
  if (variant === 3) return [...baseParts, randomItem(messyFolderSuffixes)].join(' / ');
  if (variant === 4) return [baseParts[0], randomItem(messyFolderSuffixes), baseParts[1] ?? 'General'].join(' / ');
  if (variant === 5) return `${baseParts.join('-')} / ${randomItem(messyFolderSuffixes)}`;
  if (variant === 6) return [randomItem(messyFolderPrefixes), randomItem(messyFolderSuffixes)].join(' / ');
  if (variant === 7) return `${baseParts[0] ?? 'Links'} ${randomItem(messyFolderSuffixes)}`;
  if (variant === 8) return [baseParts[0] ?? 'Links', `Batch ${String((index % 9) + 1)}`].join(' / ');
  return [randomItem(messyFolderPrefixes), baseParts[0] ?? 'Links', baseParts[1] ?? 'General', randomItem(messyFolderSuffixes)].join(' / ');
}

function makeUrl(baseUrl: string, index: number): string {
  // Reuse real public URLs. A fragment keeps every saved URL browser-openable
  // while still allowing repeated normalized URLs for duplicate-cleanup tests.
  if (index > 0 && index % 12 === 0) return baseUrl;
  return `${baseUrl}#flowmark-debug-${index + 1}`;
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomItem<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatDateForFolder(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}
