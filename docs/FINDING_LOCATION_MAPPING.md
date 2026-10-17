# Stable Finding Location Mapping

A finding's line number goes stale as soon as code above it changes. Location mapping stores a
content **anchor** with each finding, so the finding can be re-pointed at the same code in a
newer revision of the file, or reported as lost when the code no longer exists.

| Layer | Location |
| --- | --- |
| Anchor + matcher (pure, engine) | `libs/engine/core/location-mapper.ts` |
| Relocation planning (pure, API) | `apps/api/src/findings/finding-location.ts` |
| Persistence | `FindingsService.relocateFindings` (`apps/api/src/findings/findings.service.ts`) |
| Anchor capture at scan time | `apps/api/src/scanner/command-injection-scan.job.ts` |
| Fixtures | `tests/fixtures/location-mapping/` |
| Tests | `libs/engine/core/location-mapper.spec.ts`, `apps/api/src/findings/__tests__/findings.relocation.spec.ts` |

## How it works

`createLocationAnchor(content, { startLine, endLine })` records:

- the hash of the flagged first line and of the whole flagged span,
- hashes of up to 3 nearest non-blank lines above and below (nearest first).

Lines are hashed after trimming and collapsing whitespace. Line endings, indentation and blank-line
changes therefore never affect a match.

`mapLocation(anchor, content)` looks for lines with the same hash and scores each candidate:

```
confidence = 0.2 (line text matches)
           + 0.3 (whole span matches)
           + 0.5 * context agreement
```

Context agreement is the average, over the lines above and below, of how much of the nearest-first
neighbour run still matches. It stops at the first mismatch. The best candidate must reach
`minConfidence` (default 0.65). Ties are broken by distance from the old line, then by the lowest line.

| Status | Meaning |
| --- | --- |
| `exact` | Same lines, same place. |
| `moved` | Same code found at a different line. |
| `modified` | The flagged line was edited, but exactly one place has identical surroundings on both sides (confidence 0.65). |
| `ambiguous` | Several equally good matches (identical copies). The closest was chosen. |
| `lost` | No acceptable match. The last known line and anchor are kept. |

An edited line is never pinned to an identical-looking line elsewhere: the surrounding context has to
agree as well. A line that moved to a place with entirely different surroundings is reported `lost`
rather than guessed. Callers can lower `minConfidence` to accept weaker matches.

## Public interface

```ts
import { createLocationAnchor, mapLocation } from '@engine/core/location-mapper';

const anchor = createLocationAnchor(oldContent, { startLine: 9, endLine: 9 });
const mapping = mapLocation(anchor, newContent);
// { status: 'moved', startLine: 17, endLine: 17, confidence: 1, delta: 8 }
```

API findings gain two optional fields: `locationAnchor` and `locationStatus`.
`CreateFindingInput.locationAnchor` stores an anchor at creation.

```ts
findingsService.relocateFindings({
  organizationId,
  repositoryId,
  files: { 'src/runner.ts': newContent },   // or Map
  deletedFiles: ['src/old.ts'],             // optional
  options: { minConfidence: 0.65 },         // optional
});
// -> { examined, unchanged, relocated, lost, skippedNoAnchor, skippedFileNotProvided }
```

## Determinism

The same anchor, content and options always produce the same mapping. Nothing depends on the clock,
input order or shared state. Relocation is idempotent: running it again over the same contents
reports every finding as `unchanged`. `locationStatus` records the outcome of the last relocation that
changed something (`moved`, `modified`, `ambiguous`, `lost`), and is kept on reruns that find the code
exactly where it was left. After a successful move the anchor is re-captured at the new
location, so mappings chain across many revisions.

## Failure semantics and configuration

- **Tenant isolation**: `relocateFindings` only reads and writes findings of the given
  `organizationId` and `repositoryId`. Both are required (`VALIDATION_ERROR`, 400).
- **Unsupported input**: findings without a usable anchor or `filePath` are skipped, not failed
  (`skippedNoAnchor`). Corrupt anchors are treated the same way. Paths are normalized with
  `normalizeFindingPath`, and unsafe paths (`..`, absolute) are ignored.
- **Partial failure**: only files present in `files` are processed. A file missing from the snapshot
  is `skippedFileNotProvided` and never marks findings lost. Use `deletedFiles` to say a file is gone.
- **Lost findings**: the line and anchor stay as they were, so a later revision where the code
  returns recovers the finding.
- **Retries**: safe, because the operation is idempotent.
- **Never throws** on malformed content or anchors. `mapLocation` returns `lost`, and
  `createLocationAnchor` returns `undefined` when the span is outside the file.
- **Cost**: `contextLines` (default 3) and `maxCandidates` (default 500) bound the work per lookup.
  Build a `FileLineIndex` once per file to map many anchors.

## Backward compatibility

- Findings created before this feature have no anchor and are left untouched.
- The fingerprint ignores line numbers, so relocating a finding never changes its identity or
  its history.
- `Finding.line` keeps its meaning (1-based start line); relocation only updates it.
- The anchor has a `version` (currently `1`). An unknown version is ignored like a missing anchor.
- The command-injection scan job now attaches an anchor to each finding it creates. Other jobs are
  unchanged and can pass `locationAnchor` the same way.
- **Not covered**: file renames. A renamed file is seen as a deleted file plus a new one.
