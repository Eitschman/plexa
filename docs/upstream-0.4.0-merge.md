# Plexa 0.4.0 integration into the German fork

Prepared on 2026-11-07. No remote branch, image tag, Alexa skill or running installation was changed.

## Merge inputs

- Target: `eitschman`, commit `33a471a3a7074f49ecc7211b9e22579a53b16b85`.
- Upstream: v0.4.0 / `main`, commit `014364b08699a01e6dc79038c3dae5980b86fcfe`.
- Local review branch: `merge-upstream-0.4.0-resolved`.
- Seven actual merge conflicts: German interaction model; Alexa handlers; playback service; playback tests; web locale list; interaction-model generator and its tests.

## Resolutions

| Area | Resolution |
| --- | --- |
| Alexa handlers | Use upstream request-locale routing and message catalogs. Remove the upstream help handler's raw request debug log, preserving the fork's earlier removal of debug instrumentation. |
| German interaction model | Use the upstream model, including `SeekToIntent`, and retain every former fork sample and slot definition. Samples are deduplicated without regard to case and written in lowercase. |
| Matching | Use upstream locale-specific query normalization and accent/ß folding. Add the fork's Levenshtein fallback after exact and unique substring matching, retaining the 0.82 threshold and 0.08 winning margin. |
| Stored names | Use upstream behavior: preserve stored titles such as `Die Ärzte`; apply command stripping to the query only. |
| Web locale selection | Use the upstream language mapping, French/German models, and unsupported-locale validation. |
| Playback | Keep upstream queue, shuffle, loop, seek and transport logic. Retain the fork's artwork-token regression test. |
| Docker | Preserve the existing fork publishing workflow, its `eitschman` and `latest-eitschman` tags, and production-mode configuration. |

The short samples `spiele {artist}` and `spiele {track}` remain present as before. Their Alexa recognition ambiguity is unchanged; local intent-level tests cannot validate Alexa's speech recognition or model compilation.

Fuzzy matching still operates only on Plex search candidates, as in the previous fork. It does not introduce a full-library search when Plex returns no candidates.

## Validation

- Lint: passed.
- Typecheck: passed for server, tests and web.
- Production build: passed.
- Server tests: 162 passed in 24 files.
- Web tests: 192 passed in 32 files.
- Added 27 tests: 4 matching tests, 13 German handler/transport tests, and 10 model-export cases for fork-specific utterances.
- Existing upstream localization and language-boundary tests remain enabled.
- German handler tests cover fuzzy playlist/artist/album/track selection, shuffle, ambiguous-match rejection, relative and absolute seek, restart, loop, next/previous, pause/resume and stop.
- All original German samples and slots and the Docker publishing workflow are checked against the original target revision during local review.

Local runtime: Node 24.22.1. The environment denies network-interface enumeration used by `@ctrl/plex` during import. Tests passed with a local-only preload that supplies a test MAC address when that enumeration fails; it is not part of the repository or patch. The upstream CI runtime is Node 22 and should run after opening the pull request.

Docker is unavailable in the local environment, so no container build or container smoke test was run. No live Plex server or Alexa device was contacted. The production build reports Vite's chunk-size advisory.

## Proposed external steps, pending explicit approval

1. Recheck that remote `eitschman` and upstream still match the input commits above; integrate any intervening changes before proceeding.
2. Publish only `merge-upstream-0.4.0-resolved`, retaining both histories with a merge commit.
3. Open a pull request targeting `eitschman`, documenting these resolutions and validation limits.
4. Wait for GitHub CI, including its Docker build and container smoke test. Leave the pull request unmerged for review.

Pushing this review branch does not trigger the fork workflow, which publishes on pushes to `eitschman`. Merging the pull request later does trigger publication of both fork image tags; any server configured to auto-update these images could then deploy them. No merge or deployment is included in the proposed review-branch step.

## Applying the standalone patch locally

The patch is a complete tree change relative to the target commit, including upstream changes and resolved conflicts. It does not encode a two-parent merge commit. Use an isolated branch/worktree based on the exact target revision:

```bash
git switch -c review-plexa-0.4.0 33a471a3a7074f49ecc7211b9e22579a53b16b85 && git apply --check --index /absolute/path/to/plexa-0.4.0-resolved.patch && git apply --index /absolute/path/to/plexa-0.4.0-resolved.patch
```

Normal project verification, in an environment with Node 22 and Docker:

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run build && docker build -t plexa:review .
```
