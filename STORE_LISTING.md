# Chrome Web Store listing notes

## Suggested summary

Keep Pandora's Box lists and Cinejoy watch progress in sync automatically.

## Suggested description

PBox Cinejoy Auto Sync connects the Pandora's Box web app with Cinejoy. It can copy movies and shows from a signed-in Pandora's Box library into a Cinejoy list, track live Cinejoy playback progress, and update completed movies and TV/anime episodes back in Pandora's Box.

No Trakt VIP subscription is required.

## Single purpose

Synchronise Pandora's Box movie/TV library state and watch progress with Cinejoy.

## Permission justifications

- `storage`: keeps queued playback updates, sync state, and a small local diagnostic history.
- `tabs`: identifies Pandora's Box/Cinejoy tabs and opens the Cinejoy pages needed for list synchronisation.
- `scripting`: automates Cinejoy's visible Add-to-list flow and accesses player frames when required.
- `alarms`: retries queued updates and periodically checks for new Pandora's Box library items.
- `<all_urls>` host access: Cinejoy can embed its video player in third-party cross-origin iframe providers. Chrome requires host permission for the actual frame origin before the extension can observe the video element. Playback monitoring only proceeds after verifying that the containing tab is Cinejoy.

## Recommended visibility

Use **Unlisted** if the extension is intended only for Pandora's Box users who receive the install link. Chrome still handles automatic updates for unlisted store installs.
