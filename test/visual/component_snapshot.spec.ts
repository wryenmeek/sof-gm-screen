import { test, expect } from "@playwright/test";
import fs from "fs";

function renderTemplateHtml(mode: "gm" | "companion"): string {
  const rawHtml = fs.readFileSync("Index.html", "utf8");
  const sessionDate = "2026-10-31";

  if (mode === "companion") {
    // Companion Mode: Strip server-isolated GM markup and configure companion class
    const companionStripped = rawHtml.replace(
      /<\?\s*if\s*\([\s\S]*?viewMode\s*!==\s*["']companion["'][\s\S]*?\)\s*\{\s*\?>[\s\S]*?<\?\s*\}\s*\?>/i,
      ""
    );
    return companionStripped
      .replace(
        /<\?=\s*viewMode\s*===\s*['"]companion['"]\s*\?\s*['"]companion-only-mode['"]\s*:\s*['"]['"]\s*\?>/g,
        "companion-only-mode"
      )
      .replace(/<\?=\s*sessionDate\s*\?>/g, sessionDate)
      .replace(/<\?=\s*gmKey\s*\?>/g, "");
  }

  // Desktop GM Mode: Retain GM markup and omit companion-only-mode class
  return rawHtml
    .replace(
      /<\?\s*if\s*\([\s\S]*?viewMode\s*!==\s*["']companion["'][\s\S]*?\)\s*\{\s*\?>/gi,
      ""
    )
    .replace(/<\?\s*\}\s*\?>/gi, "")
    .replace(
      /<\?=\s*viewMode\s*===\s*['"]companion['"]\s*\?\s*['"]companion-only-mode['"]\s*:\s*['"]['"]\s*\?>/g,
      ""
    )
    .replace(/<\?=\s*sessionDate\s*\?>/g, sessionDate)
    .replace(/<\?=\s*gmKey\s*\?>/g, "test-gm-key");
}

const mockInitScript = `
  window.google = {
    script: {
      run: {
        withSuccessHandler: (cb) => {
          let failureCb = () => {};
          const runner = {
            withFailureHandler: (h) => {
              failureCb = h;
              return runner;
            },
            loadSessionDropdown: () => cb(["2026-10-31", "2026-10-24"]),
            refreshManifest: () => cb([]),
            getSessionList: () => cb(["2026-10-31", "2026-10-24"]),
            getSessionManifest: () =>
              cb([
                { id: "map1", name: "[1. Floor Maps] Sea_Floor_Map.png", mimeType: "image/png" },
                { id: "mon1", name: "[3. Monsters] Muttering_Serpent_Statblock.md", mimeType: "text/markdown" },
                { id: "aud1", name: "[score] Exploration_Theme.mp3", mimeType: "audio/mp3" }
              ]),
            getTableNotes: () =>
              cb({
                id: "notes_1",
                content: "# Session Notes\\n\\n- Ship anchors at Saltmarsh.",
                updated: "10:00:00 AM"
              }),
            saveTableNotes: () => cb({ id: "notes_1", updated: "10:05:00 AM" }),
            getRulesGlossary: () =>
              cb([
                { id: "grapple", title: "Grappling", source: "Combat", summary: "Athletics check contested by target Athletics/Acrobatics." },
                { id: "misty_step", title: "Misty Step", source: "Spell", summary: "Bonus action teleport up to 30ft." }
              ]),
            getAudioAuthToken: () => cb("mock-audio-auth-token"),
            getLatestAudioCue: () => cb(null),
            getLatestRuleQueryCueForCompanion: () => cb(null)
          };
          return runner;
        }
      }
    }
  };
`;

test.describe("Index.html Component Visual Snapshot Regression", () => {
  test("Desktop GM Viewport: 1440x900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#workspace");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-viewport-1440x900.png");
  });

  test("Mobile Companion Viewport: 390x844 (iPhone 14)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-viewport-390x844.png"
    );
  });
});
