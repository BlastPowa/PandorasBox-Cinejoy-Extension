# PBox Watch Sync

PBox Watch Sync is the Chromium browser extension for Pandora's Box. It tracks movie and episode playback from Cinejoy, Netflix, Prime Video, and compatible long-form HTML5 players, then updates the signed-in user's PBox progress. Cinejoy also supports copying the user's PBox movie/TV list into a Cinejoy list because Cinejoy URLs expose exact TMDB IDs.

## Install

1. Download the latest `pbox-watch-sync.zip` from this repository's Releases page.
2. Extract it to a permanent folder.
3. Open `chrome://extensions` in Chrome or another Chromium browser.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
6. Sign in to Pandora's Box in the same browser. Settings → Integrations will show the extension as active.

No streaming-service password and no Trakt VIP subscription are required.

## Updating

Pandora's Box checks the latest GitHub release version and shows when an update is available. Download the newest ZIP, replace the files in the existing extension folder, then click **Reload** on the extension card in `chrome://extensions`. Unpacked Chromium extensions cannot silently self-update.

## Releasing an update

1. Edit the extension.
2. Increase the version in `manifest.json` (or use `node scripts/bump-version.mjs patch` when that script is available).
3. Commit and push to `main`.

The `Release extension` GitHub Action packages `pbox-watch-sync.zip` and creates a matching `vX.Y.Z` GitHub release. Pushing without increasing the manifest version does not create a duplicate release.

## What it tracks

- Cinejoy: exact TMDB-based movie/series identity, live progress, movie completion, exact season/episode completion, and PBox-list-to-Cinejoy import.
- Netflix and Prime Video: targeted title and season/episode extraction plus playback progress.
- Other compatible sites: long-form HTML5 video tracking with conservative title matching.
- Playback updates are queued while PBox is closed or signed out and retried later.
- Short videos under five minutes are ignored.

PBox only writes generic-provider progress when it can identify the media confidently. For series, both season and episode are required. Ambiguous matches are ignored.

## Permissions

The extension uses broad host access because streaming sites can place video players in cross-origin frames and because generic HTML5-player support must inspect the active page/frame containing the video element. See `PRIVACY.md` for data-handling details.
