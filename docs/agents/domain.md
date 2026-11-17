# Domain Docs

How the engineering skills consume this repo's domain documentation and architectural decisions.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root.
- **[`CODING_STANDARDS.md`](../../CODING_STANDARDS.md)** at the repo root (lists all active ADRs with exact filenames and cross-boundary conventions).
- **[`docs/adr/`](../adr/)**: read the numbered ADRs (`0001`–`0010`) that touch the area you're working in.

## Repository layout

```text
/
├── AGENTS.md
├── CLAUDE.md
├── CODING_STANDARDS.md
├── GLOSSARY.md
├── Code.gs                        # Google Apps Script V8 server entrypoints & triggers
├── Index.html                     # GM Screen & Player Companion template, CSS & client JS
├── validate_session_artifacts.py  # Pre-flight validator for HTML, MD, Python & RPC contracts
├── .github/
│   ├── copilot-instructions.md    # GitHub Copilot context pointer
│   └── workflows/ci.yml           # Automated quality gate workflow
├── scripts/
│   ├── act/                       # Local GitHub Actions (act) runner helpers
│   └── rpi_vad_chunker.py         # Raspberry Pi Stage 1 Silero VAD & Stage 2 3-tier classifier
├── docs/
│   ├── adr/                       # Architectural Decision Records (0001–0010)
│   └── agents/                    # Workflow, issue tracker, triage & domain pointers
└── test/
    ├── helpers/client-harness.ts  # Shared Happy-DOM & Web Audio / IndexedDB test harness
    ├── mocks/google-apps-script.ts# Shared Apps Script VM mocks (Drive, Calendar, Tasks, Cache)
    ├── client.test.ts             # Tactical search & manifest UI tests
    ├── audio_engine.test.ts       # Tabletop Mixer, IndexedDB cache & classifier tier tests
    ├── mobile_ux.test.ts          # Player Companion isolation & dictation rules sniffer tests
    ├── server.test.ts             # Apps Script VM server & governance tests
    └── vad_chunker.test.ts        # Edge Pi VAD chunker & 3-tier classifier CLI tests
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, spec, code symbol, or test description), use the term as defined in [`GLOSSARY.md`](../../GLOSSARY.md) and avoid the listed synonyms.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR in [`docs/adr/`](../adr/), surface it explicitly:

> _Contradicts ADR-0008 (Server-Isolated Player Companion), but worth reopening because…_
