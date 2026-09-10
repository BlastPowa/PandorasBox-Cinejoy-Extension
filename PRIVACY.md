# Privacy

PBox Watch Sync tracks media playback in the browser so the signed-in user's Pandora's Box watch progress can be updated.

The extension reads page/player state needed to identify the current title, season/episode where available, playback position, duration, and completion state. Cinejoy list sync also reads the user's Pandora's Box movie/TV library so titles with TMDB IDs can be added to the user's Cinejoy list.

Playback updates are sent only to the user's active Pandora's Box web session. The extension does not collect streaming-service passwords or payment information, does not sell user data, and does not use playback data for advertising. A small rolling diagnostic history of watch-sync events is stored locally in the browser for troubleshooting.

Broad host permission is required because supported streaming players may run in cross-origin frames and because PBox Watch Sync can detect compatible long-form HTML5 players beyond the explicitly targeted providers. Short videos are ignored, and generic-provider progress is discarded when PBox cannot identify the media confidently.
