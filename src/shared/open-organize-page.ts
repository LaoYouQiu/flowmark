const ORGANIZE_PAGE_PATH = '/organize.html' as const;

export async function openOrganizePage(): Promise<void> {
  const url = browser.runtime.getURL(ORGANIZE_PAGE_PATH as Parameters<typeof browser.runtime.getURL>[0]);
  const existingTabs = await browser.tabs.query({ url });
  const existingTab = existingTabs.find((tab) => tab.id != null);

  if (existingTab?.id != null) {
    await browser.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId != null) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url });
}
