# PBox Cinejoy Auto Sync

Chrome/Chromium extension for Pandora's Box. It copies a user's Pandora's Box movie/TV library into Cinejoy and mirrors Cinejoy playback progress, completed movies, and completed TV/anime episodes back into Pandora's Box.

## Install

For development, download the latest GitHub release ZIP, extract it, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder.

For normal users, publish the extension through the Chrome Web Store. Store-installed copies update automatically through Chrome after each approved release, so users do not need to download new ZIPs or reload unpacked files.

## Releasing an update

1. Edit the extension.
2. Run `node scripts/bump-version.mjs patch` (or `minor` / `major`).
3. Commit and push to `main`.

The `Release extension` GitHub Action detects the new manifest version, creates `pbox-cinejoy-auto-sync.zip`, creates a matching GitHub release, and—after Chrome Web Store automation is enabled—uploads and submits the update through the Chrome Web Store API v2.

Pushing code without increasing `manifest.json`'s version does not create a second release for the same version.

## One-time Chrome Web Store setup

Chrome Web Store API v2 can update an existing store item but cannot create the first item. Do this once in the Chrome Web Store Developer Dashboard:

1. Register/verify the publisher account and create the extension item by uploading a release ZIP.
2. Complete the Store listing and Privacy tabs and choose the intended visibility (Unlisted is suitable if this is only for Pandora's Box users/friends).
3. In Google Cloud, enable **Chrome Web Store API** and create a service account.
4. Add the service-account email to the publisher account in the Chrome Web Store Developer Dashboard.
5. Create a JSON key for that service account.
6. In this GitHub repository add these Actions variables:
   - `CHROME_WEBSTORE_PUBLISHER_ID`
   - `CHROME_WEBSTORE_EXTENSION_ID`
   - `CHROME_WEBSTORE_ENABLED` = `true`
7. Add this Actions secret:
   - `CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON` = the full service-account JSON key.

After that, a version-bumped push to `main` packages the extension and submits it to Chrome Web Store review automatically. Chrome then distributes the approved update to installed copies.

## What it syncs

- Detects Cinejoy movie and TV playback.
- Sends live progress to Pandora's Box roughly every 30 seconds and on play/pause/seek/end events.
- Marks a movie or episode complete at the configured completion threshold.
- Copies Pandora's Box movies and shows with TMDB IDs into a Cinejoy `Pandora's Box` list.
- Queues updates while Pandora's Box is closed, offline, or signed out, then retries later.

## Broad site access

Cinejoy may place the actual video player in a cross-origin third-party iframe. Chrome needs host permission for those iframe origins before the extension can observe the video element. The content script asks the background worker whether the containing tab is Cinejoy before it monitors playback, so non-Cinejoy tabs are ignored by the tracking logic.

See `PRIVACY.md` and `STORE_LISTING.md` for the store disclosure/permission text.
