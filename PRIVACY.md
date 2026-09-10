# Privacy

PBox Cinejoy Auto Sync has one purpose: synchronise a user's Pandora's Box library and watch progress with Cinejoy.

The extension reads Cinejoy page/player state only to identify the current movie/episode and playback position. It reads the signed-in user's Pandora's Box library only to perform list synchronisation. Playback updates are sent to that user's Pandora's Box site session.

The extension does not sell user data, does not use data for advertising, and does not collect passwords or payment information. A small rolling diagnostic history of Cinejoy playback events is stored locally in the browser so changes to Cinejoy's player can be diagnosed.

Broad host permission is required because Cinejoy can embed its actual video player inside third-party cross-origin frames. Monitoring logic first verifies that the containing browser tab is a Cinejoy tab before processing playback.
