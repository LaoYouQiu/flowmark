import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import { z } from 'zod';

import type {
  BookmarkFolderCandidate,
  BookmarkSuggestion,
  FlowmarkSettings,
  Locale,
  PageContent,
} from './types';

const MAX_HEADINGS = 8;

const suggestionSchema = z
  .object({
    folderId: z.string().optional(),
    suggestedFolder: z.string(),
    title: z.string(),
    confidence: z.number().min(0).max(1),
    summary: z.string(),
  })
  .strict();

export async function getAiConfigError(
  settings: Pick<FlowmarkSettings, 'aiBaseURL' | 'aiModel'>,
  t: (
    key:
      | 'background.aiNotConfigured'
      | 'background.hostPermissionNotGranted'
      | 'background.invalidAiBaseUrl',
  ) => string,
): Promise<string | null> {
  // Validate the provider setup before the user triggers a recommendation.
  // Extension host permissions are origin-based, so the configured Base URL
  // must also be granted in manifest/runtime permissions.
  if (!settings.aiBaseURL || !settings.aiModel) {
    return t('background.aiNotConfigured');
  }

  try {
    const originPattern = `${new URL(settings.aiBaseURL).origin}/*`;
    const granted = await browser.permissions.contains({ origins: [originPattern] });
    if (!granted) {
      return t('background.hostPermissionNotGranted');
    }
  } catch {
    return t('background.invalidAiBaseUrl');
  }

  return null;
}

export async function getBookmarkSuggestion(input: {
  settings: Pick<FlowmarkSettings, 'aiBaseURL' | 'aiApiKey' | 'aiModel' | 'sendPageText' | 'organizeIntensity'>;
  locale: Locale;
  url: string;
  originalTitle: string;
  pageContent: PageContent;
  folderPaths?: string[];
  folderCandidates?: BookmarkFolderCandidate[];
  bookmarksBarLabel?: string;
  summaryEnabled: boolean;
  untitledFallback: string;
}): Promise<BookmarkSuggestion | null> {
  const provider = createOpenAICompatible({
    name: 'flowmark',
    baseURL: input.settings.aiBaseURL,
    apiKey: input.settings.aiApiKey.trim() || undefined,
  });

  const model = provider.chatModel(input.settings.aiModel);
  const pageTitle = input.pageContent.title || input.originalTitle;
  const headings = input.pageContent.headings.slice(0, MAX_HEADINGS);
  const outputLanguage = input.locale === 'zh-CN' ? 'Simplified Chinese' : 'English';
  const intensityRule = toOrganizeIntensityRule(input.settings.organizeIntensity);

  // Folder candidates are converted to compact F1/F2 rows. AI chooses a short
  // ID, while FlowMark keeps the real path mapping local and deterministic.
  const folderOptions = input.folderCandidates
    ? toFolderOptionsFromCandidates(input.folderCandidates, input.bookmarksBarLabel)
    : toFolderOptions(input.folderPaths ?? [], input.bookmarksBarLabel);

  const system =
    'You are a bookmark organizer. Return a JSON object with a folderId, suggested folder path, short improved title, and one-sentence summary.' +
    '\nRules:' +
    '\n- Prefer the user\'s existing organization habits and choose one provided folderId whenever possible.' +
    `\n- Organization intensity: ${intensityRule}` +
    '\n- Use folderId NEW only when none of the candidates fits.' +
    '\n- For an existing folderId, suggestedFolder may be empty because the app will map the ID back to the folder path.' +
    '\n- For NEW, suggestedFolder must be a "-" separated relative path with at most 4 segments.' +
    '\n- title must be short, readable, and not include extra quotes.' +
    '\n- summary must be exactly one sentence, plain text only, and explain why this page is worth saving or what it is mainly about.' +
    '\n- summary must not repeat the title verbatim.' +
    '\n- confidence must be a number between 0 and 1.' +
    `\n- title and summary must be written in ${outputLanguage}.`;

  const promptParts: string[] = [];
  promptParts.push(`URL: ${input.url}`);
  if (pageTitle) promptParts.push(`Page title: ${pageTitle}`);
  if (input.pageContent.description) promptParts.push(`Description: ${input.pageContent.description}`);
  if (headings.length > 0) promptParts.push(`Headings: ${headings.join(' | ')}`);
  if (input.settings.sendPageText && input.pageContent.text) {
    promptParts.push(`Page text (truncated):\n${input.pageContent.text}`);
  }
  promptParts.push('Candidate folder nodes (choose by folderId; parentId shows hierarchy):');
  promptParts.push(formatFolderOptions(folderOptions) || 'NEW: create a short path');

  try {
    const prompt = promptParts.join('\n\n');

    try {
      // Prefer structured outputs when the provider supports them. Some
      // OpenAI-compatible providers do not, so the plain JSON fallback below
      // keeps the extension usable across more endpoints.
      const result = await generateText({
        model,
        system,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 260,
        output: Output.object({
          schema: suggestionSchema,
        }),
      });

      const parsed = suggestionSchema.safeParse(result.output);
      if (parsed.success) {
        return normalizeSuggestion(parsed.data, {
          folderOptions,
          untitledFallback: input.untitledFallback,
          summaryEnabled: input.summaryEnabled,
        });
      }
    } catch {
      // Fall back to plain JSON parsing for providers without structured outputs.
    }

    const { text } = await generateText({
      model,
      system: `${system}\n\nReturn ONLY valid JSON.`,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 280,
    });

    const json = extractFirstJsonObject(text);
    if (!json) return null;

    const parsed = suggestionSchema.safeParse(json);
    if (!parsed.success) return null;

    return normalizeSuggestion(parsed.data, {
      folderOptions,
      untitledFallback: input.untitledFallback,
      summaryEnabled: input.summaryEnabled,
    });
  } catch {
    return null;
  }
}

function normalizeSuggestion(
  value: BookmarkSuggestion & { folderId?: string },
  options: {
    folderOptions: FolderOption[];
    untitledFallback: string;
    summaryEnabled: boolean;
  },
): BookmarkSuggestion {
  // Never trust the model response directly: clamp confidence, shorten titles,
  // suppress summaries when disabled, and resolve folder IDs to known paths.
  const existingFolder = options.folderOptions.find((option) => option.id === value.folderId);
  const folder = existingFolder
    ? existingFolder.path
    : normalizeFolderPath(value.suggestedFolder);
  const title = value.title.trim().slice(0, 160);
  const confidence = Number.isFinite(value.confidence)
    ? Math.min(1, Math.max(0, value.confidence))
    : 0;
  const summary = options.summaryEnabled
    ? normalizeSummary(value.summary, title || options.untitledFallback)
    : '';

  return {
    suggestedFolder: folder,
    title: title.length > 0 ? title : options.untitledFallback,
    confidence,
    summary,
  };
}

type FolderOption = {
  id: string;
  path: string;
  name: string;
  parentId: string | null;
  depth: number;
  bookmarkCount?: number;
};

function toFolderOptions(folderPaths: string[], bookmarksBarLabel?: string): FolderOption[] {
  const uniquePaths = [...new Set(folderPaths.map((path) => path.trim()).filter(Boolean))];
  const options = uniquePaths.map((path, index) => {
    const isRoot = bookmarksBarLabel ? path === bookmarksBarLabel : false;
    const parts = isRoot ? [] : path.split('-').map((part) => part.trim()).filter(Boolean);
    return {
      id: `F${index + 1}`,
      path: isRoot ? '' : path,
      name: isRoot ? bookmarksBarLabel ?? path : parts.at(-1) ?? path,
      parentId: null,
      depth: isRoot ? 0 : parts.length,
    };
  });
  return withParentIds(options, bookmarksBarLabel);
}

function toFolderOptionsFromCandidates(
  candidates: BookmarkFolderCandidate[],
  bookmarksBarLabel?: string,
): FolderOption[] {
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
  const options = uniqueCandidates.map((candidate, index) => ({
    id: `F${index + 1}`,
    path: candidate.path === bookmarksBarLabel ? '' : candidate.path,
    name: candidate.name,
    parentId: null,
    depth: candidate.depth,
    bookmarkCount: candidate.bookmarkCount,
  }));
  return withParentIds(options, bookmarksBarLabel);
}

function withParentIds(options: FolderOption[], bookmarksBarLabel?: string): FolderOption[] {
  // Add an explicit ROOT row so multiple first-level folders share a clear
  // parent instead of looking like several unrelated empty-parent roots.
  const hasRoot = options.some((option) => option.id === 'ROOT');
  const idByPath = new Map(options.map((option) => [option.path || bookmarksBarLabel || '', option.id]));
  const resolved = options.map((option) => {
    if (option.id === 'ROOT') return option;
    if (option.depth === 0) return option;
    const parentPath = option.path.split('-').slice(0, -1).join('-') || bookmarksBarLabel || '';
    return {
      ...option,
      parentId: idByPath.get(parentPath) ?? (hasRoot && option.depth === 1 ? 'ROOT' : null),
    };
  });

  if (!bookmarksBarLabel || hasRoot) return resolved;

  return [
    {
      id: 'ROOT',
      path: '',
      name: bookmarksBarLabel,
      parentId: null,
      depth: 0,
      bookmarkCount: undefined,
    },
    ...resolved.map((option) => option.depth === 0 ? { ...option, parentId: 'ROOT', depth: 1 } : option),
  ];
}

function formatFolderOptions(options: FolderOption[]): string {
  if (options.length === 0) return '';

  const rows = options
    .map((option) => {
      const count = option.bookmarkCount ?? '';
      return [
        option.id,
        escapeCell(option.name),
        option.parentId ?? '',
        option.depth,
        count,
      ].join(',');
    })
    .join('\n');
  // Short table rows save tokens versus repeating field names for each folder.
  return `Folders [id,name,parent,depth,count]\n${rows}`;
}

function escapeCell(value: string): string {
  return value.replace(/[,|\n\r]+/g, ' ').trim();
}

function normalizeFolderPath(folderPath: string): string {
  return folderPath
    .split(/[-/]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 4)
    .join('-');
}

function normalizeSummary(summary: string, title: string): string {
  const cleaned = summary
    .replace(/\s+/g, ' ')
    .replace(/^[-*\d.)\s]+/, '')
    .trim()
    .slice(0, 240);

  if (!cleaned) return '';
  if (cleaned.toLowerCase() === title.trim().toLowerCase()) return '';
  if (/[.!?。！？]$/.test(cleaned)) return cleaned;
  return `${cleaned}.`;
}

function extractFirstJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function toOrganizeIntensityRule(intensity: FlowmarkSettings['organizeIntensity']): string {
  switch (intensity) {
    case 'conservative':
      return 'conservative. Prefer the current folder, avoid creating new folders, and suggest metadata-only improvements unless the current folder is clearly wrong.';
    case 'aggressive':
      return 'aggressive. You may suggest stronger folder changes or a new folder when it creates a clearer structure.';
    case 'balanced':
      return 'balanced. Prefer existing folders, move when there is a clear better fit, and create a new folder only with a strong reason.';
  }
}
