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
      .replace(
        /<\?=\s*typeof viewMode !== ['"]undefined['"] \? viewMode : ['"]gm['"]\s*\?>/g,
        "companion"
      )
      .replace(
        /<\?=\s*typeof gmKey !== ['"]undefined['"] \? gmKey : ['"]['"]\s*\?>/g,
        ""
      )
      .replace(
        /<\?=\s*typeof webAppUrl !== ['"]undefined['"] \? webAppUrl : ['"]['"]\s*\?>/g,
        ""
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
    .replace(
      /<\?=\s*typeof viewMode !== ['"]undefined['"] \? viewMode : ['"]gm['"]\s*\?>/g,
      "gm"
    )
    .replace(
      /<\?=\s*typeof gmKey !== ['"]undefined['"] \? gmKey : ['"]['"]\s*\?>/g,
      "test-gm-key"
    )
    .replace(
      /<\?=\s*typeof webAppUrl !== ['"]undefined['"] \? webAppUrl : ['"]['"]\s*\?>/g,
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
    await page.waitForSelector("#file-list .file-item");
    await page.waitForSelector("#gm-roster-list .gm-roster-item");
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
    await expect(page.locator("#player-hud")).toBeVisible();
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

  test("7. Desktop GM: Combat Tracker, Ambush Badges, Party Roster & Floating Reactions (1440x900)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("gm");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#sidebar");
    await page.waitForSelector("#file-list .file-item");
    await page.waitForSelector("#gm-combat-tracker");

    await page.evaluate(() => {
      (window as any).renderGmCombat_({
        round: 2,
        activeIndex: 0,
        isRunning: true,
        combatants: [
          {
            id: "pog",
            name: "Pog",
            initiative: 19,
            hp: 34,
            maxHp: 42,
            ac: 16,
            isPlayerVisible: true
          },
          {
            id: "mon1",
            name: "Muttering Serpent",
            initiative: 14,
            hp: 142,
            maxHp: 142,
            ac: 17,
            isPlayerVisible: true
          },
          {
            id: "ambush1",
            name: "Sahuagin Ambushers",
            initiative: 11,
            hp: 66,
            maxHp: 66,
            ac: 14,
            isPlayerVisible: false
          }
        ]
      });

      (window as any).updateGmRosterDom_([
        { characterId: "pog", name: "Pog", claimedBy: "uid_player_1" },
        { characterId: "vaelor", name: "Vaelor", claimedBy: "uid_player_2" },
        { characterId: "orca", name: "Orca", claimedBy: null },
        { characterId: "fade", name: "Fade", claimedBy: null },
        { characterId: "guest", name: "Guest", claimedBy: null }
      ]);
    });

    await page.click("#combat-next-btn");
    await expect(page.locator("#gm-combat-list tr.active-row")).toHaveAttribute(
      "data-combatant-id",
      "mon1"
    );
    await expect(page.locator("#gm-combat-list .ambush-badge")).toContainText(
      "Hidden"
    );
    await expect(
      page.locator("#gm-roster-list .force-release-btn")
    ).toHaveCount(2);

    await page.evaluate(() => {
      const bubble = (window as any).renderFloatingReactionBubble({
        id: "rx_visual_1",
        characterName: "Pog",
        emoji: "⚔️"
      });
      if (bubble) {
        bubble.style.animation = "none";
        bubble.style.opacity = "1";
        bubble.style.left = "50%";
        bubble.style.bottom = "12px";
        bubble.style.transform = "translateX(-50%)";
      }
    });

    await page.waitForSelector(".floating-reaction-bubble");
    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "desktop-gm-combat-roster-reactions.png"
    );
  });

  test("8. Mobile Companion: Sanitized Initiative Projection, Status Bands & Turn Alert Banner (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");
    await expect(page.locator("#player-hud")).toBeVisible();

    await page.evaluate(() => {
      (window as any).selectPlayerIdentity("Pog", "pog");
      (window as any).renderPlayerCombat_({
        round: 3,
        activeIndex: 0,
        isRunning: true,
        combatants: [
          { id: "pog", name: "Pog", initiative: 19, statusBand: "INJURED" },
          {
            id: "vaelor",
            name: "Vaelor",
            initiative: 17,
            statusBand: "UNINJURED"
          },
          { id: "orca", name: "Orca", initiative: 15, statusBand: "BLOODIED" },
          {
            id: "mon1",
            name: "Muttering Serpent",
            initiative: 12,
            statusBand: "CRITICAL"
          },
          {
            id: "deckhand",
            name: "Pirate Deckhand",
            initiative: 6,
            statusBand: "DOWN"
          }
        ]
      });
    });

    await page.waitForSelector("#player-turn-banner");
    await expect(page.locator("#player-turn-banner")).toBeVisible();
    await expect(page.locator("#player-combat-tracker")).toBeVisible();
    await expect(page.locator("#player-combat-list")).toContainText("INJURED");
    await expect(page.locator("#player-combat-list")).toContainText("BLOODIED");
    await expect(page.locator("#player-combat-list")).toContainText("CRITICAL");
    await expect(page.locator("#player-combat-list")).toContainText("DOWN");
    await expect(page.locator("#player-combat-list")).not.toContainText("142");

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-combat-turn-alert.png"
    );
  });

  test("9. Mobile Companion: Character Roster Claiming, Contested Claim & Switch Confirmation Modal (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");
    await expect(page.locator("#player-hud")).toBeVisible();

    await page.evaluate(() => {
      (window as any).liveTabletopClient = {
        getCurrentUser: () => ({ uid: "uid_self" })
      };
      (window as any).selectPlayerIdentity("Pog", "pog");
      (window as any).togglePlayerIdentityModal();
      (window as any).updateRosterDom_([
        { characterId: "pog", name: "Pog", claimedBy: "uid_self" },
        { characterId: "vaelor", name: "Vaelor", claimedBy: "uid_other" },
        { characterId: "orca", name: "Orca", claimedBy: null },
        { characterId: "fade", name: "Fade", claimedBy: null },
        { characterId: "guest", name: "Guest", claimedBy: null }
      ]);
    });

    await expect(
      page.locator('.character-card[data-character-id="pog"] .claimed-badge')
    ).toContainText("You");
    await expect(
      page.locator('.character-card[data-character-id="vaelor"] .claimed-badge')
    ).toContainText("Claimed");
    await page.click('.character-card[data-character-id="orca"]');
    await page.waitForSelector("#switch-character-modal:not(.hidden)");
    await expect(page.locator("#switch-modal-msg")).toContainText(
      "Switch to Orca? Pog will be released back to the party roster."
    );
    await expect(
      page.locator('.character-card[data-character-id="vaelor"]')
    ).toBeDisabled();

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-switch-character-modal.png"
    );
  });

  test("10. Mobile Companion: Structured Rules Arbiter Card with Confidence Badges & Citations (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");
    await expect(page.locator("#player-hud")).toBeVisible();

    await page.evaluate(() => {
      (window as any).selectPlayerIdentity("Pog", "pog");
      (window as any).showRuleCard_({
        ruleTitle: "Grappling a Huge Creature",
        ruleId: "grapple_huge",
        confidence: "exact",
        summary:
          "You cannot grapple a creature more than one size larger than you.",
        ruling:
          "A Medium creature (Pog) can grapple at most a Large creature. Huge creatures cannot be grappled unless an effect increases your size.",
        citations: ["PHB p. 195", "SRD 5.1 Combat"]
      });
    });

    await page.waitForSelector("#rule-card.visible");
    await expect(
      page.locator('#card-confidence[data-confidence="exact"]')
    ).toBeVisible();
    await expect(page.locator("#card-summary")).toBeVisible();
    await expect(page.locator("#card-ruling")).toBeVisible();
    await expect(page.locator("#card-citations .citation-pill")).toHaveCount(2);

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot(
      "mobile-companion-structured-arbiter-card.png"
    );
  });

  test("11. Mobile Companion: In-App GM Login Modal & Validation Error State (390x844)", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(mockInitScript);

    const html = renderTemplateHtml("companion");
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#player-hud");
    await expect(page.locator("#player-hud")).toBeVisible();

    await page.click("#gm-login-trigger-btn");
    await page.waitForSelector("#gm-key-modal:not(.hidden)");
    await page.click("#gm-key-submit-btn");
    await expect(page.locator("#gm-key-error")).toBeVisible();
    await expect(page.locator("#gm-key-error")).toContainText(
      "Please enter your GM secret key."
    );

    await page.evaluate(() => document.fonts.ready);

    await expect(page).toHaveScreenshot("mobile-companion-gm-login-modal.png");
  });
});
