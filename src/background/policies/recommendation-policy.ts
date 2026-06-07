import {
  getAiConfigError,
  getBookmarkSuggestion,
} from "@/src/shared/bookmark-ai";
import { createTranslator } from "@/src/shared/i18n";
import type { BookmarkPolicy, PolicyResult } from "@/src/shared/types";

import {
  findNodeById,
  getRelativeFolderPath,
  selectFolderCandidateNodes,
} from "../engine/helpers";

export const recommendationPolicy: BookmarkPolicy = {
  id: "recommendation-policy",
  enabled(context) {
    return context.settings.features.recommendation.enabled;
  },
  getProgressCard(context) {
    // Shown while the AI request is in flight so users understand why the
    // newly-created bookmark has a temporary FlowMark card.
    const { t } = createTranslator(context.locale);
    return {
      id: `loading:${context.bookmarkId}`,
      policyId: "recommendation-policy",
      kind: "info",
      bookmarkId: context.bookmarkId,
      url: context.url,
      title: context.originalTitle || t("common.saving"),
      headline: t("content.smartRecommendation"),
      body:
        context.originalTitle ||
        context.pageContent.title ||
        t("common.bookmark"),
      actions: [],
    };
  },
  async evaluate(context): Promise<PolicyResult> {
    const { t } = createTranslator(context.locale);
    const configError = await getAiConfigError(context.settings.raw, t);
    if (configError) {
      return {
        type: "card",
        card: {
          id: `error:${context.bookmarkId}`,
          policyId: "recommendation-policy",
          kind: "error",
          bookmarkId: context.bookmarkId,
          url: context.url,
          title: context.originalTitle || t("common.bookmark"),
          headline: configError,
          body: t("content.tryBookmarkingAgain"),
          actions: [
            {
              id: "open_options",
              label: t("content.openSettings"),
              variant: "secondary",
              intent: "open-options",
            },
          ],
          autoDismissMs: 4000,
          autoActionId: "dismiss_error",
        },
      };
    }

    const bookmarksBarLabel = t("common.bookmarksBar");
    const currentBookmark = findNodeById(
      context.bookmarkTreeSnapshot,
      context.bookmarkId,
    );
    const currentFolderPath = getRelativeFolderPath(
      context.bookmarkTreeSnapshot,
      context.bookmarksBarId,
      currentBookmark?.parentId ?? null,
      bookmarksBarLabel,
    );
    // Keep AI focused on the user's existing habits by sending only relevant
    // candidate folders instead of the full bookmark tree. The saved intensity
    // setting further controls how willing the model should be to move/create.
    const folderCandidates = selectFolderCandidateNodes({
      tree: context.bookmarkTreeSnapshot,
      bookmarksBarId: context.bookmarksBarId,
      bookmarksBarLabel,
      url: context.url,
      title: context.originalTitle,
      pageContent: context.pageContent,
      currentFolderPath,
      maxCandidates: context.settings.raw.folderCandidateLimit,
    });
    const suggestion = await getBookmarkSuggestion({
      settings: context.settings.raw,
      locale: context.locale,
      url: context.url,
      originalTitle: context.originalTitle,
      pageContent: context.pageContent,
      folderCandidates,
      bookmarksBarLabel,
      summaryEnabled: context.settings.features.summary.enabled,
      untitledFallback: t("common.untitled"),
    });
    if (!suggestion) {
      return {
        type: "card",
        card: {
          id: `error:${context.bookmarkId}`,
          policyId: "recommendation-policy",
          kind: "error",
          bookmarkId: context.bookmarkId,
          url: context.url,
          title: context.originalTitle || t("common.bookmark"),
          headline: t("background.failedRecommendation"),
          body: t("content.tryBookmarkingAgain"),
          actions: [],
          autoDismissMs: 4000,
          autoActionId: "dismiss_error",
        },
      };
    }

    const autoAcceptEnabled = context.settings.raw.autoAcceptEnabled;
    const autoAcceptSeconds = Math.max(
      0,
      Math.trunc(context.settings.raw.autoAcceptSeconds),
    );

    return {
      type: "card",
      card: {
        id: `recommendation:${context.bookmarkId}`,
        policyId: "recommendation-policy",
        kind: "recommendation",
        bookmarkId: context.bookmarkId,
        url: context.url,
        title: suggestion.title,
        headline: suggestion.suggestedFolder || t("common.bookmarksBar"),
        body: suggestion.title,
        badge: `${Math.round(suggestion.confidence * 100)}%`,
        actions: [
          {
            id: "reject",
            label: t("content.reject"),
            variant: "secondary",
            intent: "submit",
          },
          {
            id: "accept",
            label: t("content.accept"),
            variant: "primary",
            intent: "submit",
            payload: {
              suggestedFolder: suggestion.suggestedFolder,
              title: suggestion.title,
              summary: suggestion.summary,
            },
          },
        ],
        autoActionId:
          autoAcceptEnabled && autoAcceptSeconds > 0 ? "accept" : undefined,
        autoDismissMs:
          autoAcceptEnabled && autoAcceptSeconds > 0
            ? autoAcceptSeconds * 1000
            : undefined,
      },
    };
  },
  async executeAction({ card, actionId, payload, services }) {
    switch (actionId) {
      case "accept": {
        // Accept applies the model's plan through local, validated services:
        // create/move folder path, update title, then persist optional summary.
        services.store.suppress(card.bookmarkId, 8000);
        services.store.removeJob(card.bookmarkId);

        const bookmarksBarId = await services.getBookmarksBarId();
        if (!bookmarksBarId) return { type: "noop" };
        const suggestedFolder = payload?.suggestedFolder ?? "";
        const title = payload?.title ?? card.title;
        const summary = payload?.summary ?? "";
        const parentId = await services.findOrCreateFolderPath(
          bookmarksBarId,
          suggestedFolder,
        );
        await services.moveBookmark(card.bookmarkId, parentId);
        const updatedBookmark = await services.updateBookmarkTitle(
          card.bookmarkId,
          title,
        );

        const settings = await services.getResolvedSettings();
        if (
          !settings.features.summary.enabled ||
          !updatedBookmark.url ||
          !summary.trim()
        ) {
          return { type: "completed" };
        }
        await services.upsertBookmarkSummary({
          bookmarkId: updatedBookmark.id,
          url: updatedBookmark.url,
          title: updatedBookmark.title,
          folderPath:
            suggestedFolder ||
            (await services.getBookmarksBarLabel(settings.raw)),
          summary: summary.trim(),
        });
        return { type: "completed" };
      }
      case "reject":
      case "dismiss_error":
        services.store.suppress(card.bookmarkId, 2000);
        services.store.removeJob(card.bookmarkId);
        return { type: "dismissed" };
      default:
        return { type: "noop" };
    }
  },
};
