import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import { z } from 'zod';

import type { BookmarkSuggestion, FlowmarkSettings, Locale, PageContent } from './types';

const MAX_HEADINGS = 8;

const suggestionSchema = z
  .object({
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
  settings: Pick<FlowmarkSettings, 'aiBaseURL' | 'aiApiKey' | 'aiModel' | 'sendPageText'>;
  locale: Locale;
  url: string;
  originalTitle: string;
  pageContent: PageContent;
  folderPaths: string[];
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

  const system =
    'You are a bookmark organizer. Return a JSON object with a suggested folder path, a short improved title, and a one-sentence summary.' +
    '\nRules:' +
    '\n- suggestedFolder must be a "-" separated relative path (do NOT include the root folder name).' +
    '\n- Keep suggestedFolder to at most 4 segments.' +
    '\n- Prefer choosing an existing folder path from the provided list.' +
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
  promptParts.push('Existing folders (use one of these if possible):');
  promptParts.push(input.folderPaths.join('\n') || '(none)');

  try {
    const prompt = promptParts.join('\n\n');

    try {
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
        return normalizeSuggestion(parsed.data, input.untitledFallback, input.summaryEnabled);
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

    return normalizeSuggestion(parsed.data, input.untitledFallback, input.summaryEnabled);
  } catch {
    return null;
  }
}

function normalizeSuggestion(
  value: BookmarkSuggestion,
  untitledFallback: string,
  summaryEnabled: boolean,
): BookmarkSuggestion {
  const folder = value.suggestedFolder
    .split(/[-/]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 4)
    .join('-');
  const title = value.title.trim().slice(0, 160);
  const confidence = Number.isFinite(value.confidence)
    ? Math.min(1, Math.max(0, value.confidence))
    : 0;
  const summary = summaryEnabled ? normalizeSummary(value.summary, title || untitledFallback) : '';

  return {
    suggestedFolder: folder,
    title: title.length > 0 ? title : untitledFallback,
    confidence,
    summary,
  };
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
