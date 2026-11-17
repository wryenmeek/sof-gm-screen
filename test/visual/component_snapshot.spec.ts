import { test, expect } from "@playwright/test";
import fs from "fs";

function renderTemplateHtml(mode: "gm" | "companion"): string {
  const rawHtml = fs.readFileSync("Index.html", "utf8");
  const sessionDate = "2026-10-31";
  const scriptInjection = `<script>\n${mockInitScript}\n</script>`;

  if (mode === "companion") {
    // Companion Mode: Strip server-isolated GM markup and configure companion class
    const companionStripped = rawHtml.replace(
      /<\?\s*if\s*\([\s\S]*?viewMode\s*!==\s*["']companion["'][\s\S]*?\)\s*\{\s*\?>[\s\S]*?<\?\s*\}\s*\?>/i,
      ""
    );
    return companionStripped
      .replace("<head>", `<head>\n${scriptInjection}`)
      .replace(
        /<\?=\s*viewMode\s*===\s*['"]companion['"]\s*\?\s*['"]companion-only-mode['"]\s*:\s*['"]['"]\s*\?>/g,
        "companion-only-mode"
      )
      .replace(/<\?=\s*sessionDate\s*\?>/g, sessionDate)
      .replace(/<\?=\s*gmKey\s*\?>/g, "");
  }

  // Desktop GM Mode: Retain GM markup and omit companion-only-mode class
  return rawHtml
    .replace("<head>", `<head>\n${scriptInjection}`)
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
            getFilePayload: (fileId) => {
              if (fileId === "mon1") {
                return cb({
                  id: "mon1",
                  name: "[3. Monsters] Muttering_Serpent_Statblock.md",
                  type: "markdown",
                  content: \`{monster,frame
## Muttering Serpent
*Huge monstrosity, neutral evil*
___
**Armor Class** :: 17 (natural armor)
**Hit Points** :: 142 (15d12 + 45)
**Speed** :: 40 ft., swim 40 ft.
___
| STR | DEX | CON | INT | WIS | CHA |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 21 (+5) | 14 (+2) | 17 (+3) | 10 (+0) | 12 (+1) | 8 (-1) |
___
**Saving Throws** :: Wis +4, Con +6
**Skills** :: Perception +4, Stealth +5
**Damage Resistances** :: cold, poison
**Senses** :: darkvision 60 ft., passive Perception 14
**Languages** :: Aquan, Common
**Challenge** :: 8 (3,900 XP)
___
### Actions
**Multiattack.** The serpent makes two bite attacks.
**Bite.** *Melee Weapon Attack:* +8 to hit, reach 10 ft., one target. *Hit:* 22 (3d10 + 6) piercing damage plus 7 (2d6) poison damage.
}\`
                });
              }
              if (fileId === "map1") {
                return cb({
                  id: "map1",
                  name: "[1. Floor Maps] Sea_Floor_Map.png",
                  type: "image",
                  content: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'><rect width='800' height='600' fill='%230f172a'/><circle cx='400' cy='300' r='180' fill='%231e293b' stroke='%2338bdf8' stroke-width='4'/><text x='400' y='305' fill='%2338bdf8' font-size='24' font-family='sans-serif' text-anchor='middle'>Sunken Sea Floor Map</text></svg>"
                });
              }
              return cb({
                id: fileId,
                name: "Table Notes",
                type: "markdown",
                content: "# Notes"
              });
            },
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
  test("Desktop GM Viewport: 1440x900 (Baseline Idle)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#workspace");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-viewport-1440x900.png");
  });

  test("Mobile Companion Viewport: 390x844 (Baseline Idle)", async ({
    page
  }) => {
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

  test("1. Desktop GM: Dual-Pane Pinned Workspace (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#workspace");

    // Load Floor Map into Left Pane, then pin to Right Pane
    await page.evaluate(() => {
      // @ts-expect-error test harness execution
      window.loadFile_("map1");
      // @ts-expect-error test harness execution
      window.pinCurrentToRight();
      // Load Monster Statblock into Left Pane
      // @ts-expect-error test harness execution
      window.loadFile_("mon1");
    });

    await page.waitForSelector("#left-content .dnd-statblock");
    await page.waitForSelector("#right-content .asset-img");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "desktop-gm-dual-pane-pinned-workspace.png"
    );
  });

  test("2. Desktop GM: Rendered 5e Monster Statblock & Markdown (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#workspace");

    await page.evaluate(() => {
      // @ts-expect-error test harness execution
      window.loadFile_("mon1");
    });

    await page.waitForSelector("#left-content .dnd-statblock");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-rendered-5e-statblock.png");
  });

  test("3A. Desktop GM: Active Rule Card Floating Overlay (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#workspace");

    await page.evaluate(() => {
      // @ts-expect-error test harness execution
      window.showRuleCard_({
        title: "Grappling",
        source: "Combat Mechanic",
        summary:
          "When you want to grab a creature or wrestle with it, you can use the Attack action to make a special melee attack, a grapple. Target must be within reach and no more than one size larger. Contested by target Athletics or Acrobatics check."
      });
    });

    await page.waitForSelector("#rule-card.visible");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-active-rule-card.png");
  });

  test("3B. Mobile Companion: Active Rule Card Floating Overlay (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");

    await page.evaluate(() => {
      // @ts-expect-error test harness execution
      window.selectPlayerIdentity("Pog");
      // @ts-expect-error test harness execution
      window.showRuleCard_({
        title: "Grappling",
        source: "Combat Mechanic",
        summary:
          "Contested Athletics vs Athletics/Acrobatics. Target speed becomes 0 on success."
      });
    });

    await page.waitForSelector("#rule-card.visible");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-active-rule-card.png"
    );
  });

  test("4A. Desktop GM: Search Filter Matched Results (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#file-list .file-item");

    await page.evaluate(() => {
      const input = document.getElementById("filter-input") as HTMLInputElement;
      if (input) input.value = "Serpent";
      // @ts-expect-error test harness execution
      window.filterFiles("Serpent");
    });

    await page.waitForSelector("#file-list .file-item");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-search-filter-matched.png");
  });

  test("4B. Desktop GM: Search Filter Zero Results Empty State (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#file-list .file-item");

    await page.evaluate(() => {
      const input = document.getElementById("filter-input") as HTMLInputElement;
      if (input) input.value = "Nonexistent Dragon";
      // @ts-expect-error test harness execution
      window.filterFiles("Nonexistent Dragon");
    });

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("desktop-gm-search-filter-empty.png");
  });

  test("5. Mobile Companion: PTT Listening State & Dictation Input (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");

    await page.evaluate(() => {
      // @ts-expect-error test harness execution
      window.selectPlayerIdentity("Pog");
      const pttBtn = document.getElementById("ptt-btn");
      if (pttBtn) {
        pttBtn.classList.add("listening");
        pttBtn.setAttribute("aria-pressed", "true");
        pttBtn.textContent = "🎙️ Listening... (Release to Query)";
      }
      const dictInput = document.getElementById(
        "ptt-dictation-input"
      ) as HTMLInputElement;
      if (dictInput) {
        dictInput.value = "How does Grappling work?";
      }
    });

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-ptt-listening-state.png"
    );
  });

  test("6. Desktop GM: Audio Mixer & Classifier Status Bar (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#mixer-mood-bar");

    await page.evaluate(() => {
      const combatBtn = document.querySelector(
        '.mood-cue-btn[data-mood="combat"]'
      ) as HTMLElement;
      if (combatBtn) {
        combatBtn.classList.add("primary");
        combatBtn.style.borderColor = "var(--dnd-red)";
      }
      const cacheStatus = document.getElementById("audio-cache-status");
      if (cacheStatus) {
        cacheStatus.textContent = "Audio: 3/3 ready (IndexedDB cached)";
      }
      const tierStatus = document.getElementById("classifier-tier-status");
      if (tierStatus) {
        tierStatus.textContent = "Tier: Pi Edge (OK 240ms)";
      }
    });

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "desktop-gm-audio-mixer-active-status.png"
    );
  });
});
