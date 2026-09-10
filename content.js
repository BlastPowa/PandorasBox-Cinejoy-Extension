(() => {
  const SOURCE = "pbox-cinejoy-scrobbler";
  const seenVideos = new WeakSet();
  const lastSentBucket = new WeakMap();
  let lastContextUrl = "";
  let pboxRegistered = false;
  let pboxSyncListenersRegistered = false;

  function parseCinejoyUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (!/(^|\.)cinejoy\.to$/i.test(url.hostname)) return null;

      let match = url.pathname.match(/^\/watch\/tv\/(\d+)\/(\d+)\/(\d+)(?:\/|$)/i);
      if (match) {
        return {
          mediaType: "series",
          tmdbId: Number(match[1]),
          season: Number(match[2]),
          episode: Number(match[3]),
        };
      }

      match = url.pathname.match(/^\/watch\/movie\/(\d+)(?:\/|$)/i);
      if (match) return { mediaType: "movie", tmdbId: Number(match[1]), season: null, episode: null };

      match = url.pathname.match(/^\/movie\/(\d+)(?:-|\/|$)/i);
      if (match) return { mediaType: "movie", tmdbId: Number(match[1]), season: null, episode: null };

      match = url.pathname.match(/^\/series\/(\d+)(?:-|\/|$)/i);
      if (match) return { mediaType: "series", tmdbId: Number(match[1]), season: null, episode: null };
    } catch {}
    return null;
  }

  function titleEpisode() {
    const text = `${document.title} ${document.body?.innerText?.slice(0, 2000) ?? ""}`;
    const match = text.match(/\bS(?:eason\s*)?(\d+)\s*[: -]?\s*E(?:pisode\s*)?(\d+)\b/i);
    return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
  }

  function cinejoyContext() {
    const own = parseCinejoyUrl(location.href);
    if (!own) return null;
    const inferred = titleEpisode();
    return {
      ...own,
      season: own.season ?? inferred?.season ?? null,
      episode: own.episode ?? inferred?.episode ?? null,
      pageUrl: location.href,
      title: document.querySelector("h1")?.textContent?.trim() || document.title || null,
    };
  }

  function sendContext(reason) {
    const context = cinejoyContext();
    if (!context) return;
    if (reason === "tick" && context.pageUrl === lastContextUrl) return;
    lastContextUrl = context.pageUrl;
    chrome.runtime.sendMessage({ source: SOURCE, type: "cinejoy-context", reason, ...context }).catch(() => {});
  }

  function registerPbox() {
    if (pboxRegistered) return;
    const marker = document.querySelector('meta[name="application-name"]');
    if (marker?.getAttribute("content") !== "PBox") return;
    pboxRegistered = true;
    document.documentElement.setAttribute("data-pbox-cinejoy-extension", "1");
    document.documentElement.setAttribute("data-pbox-cinejoy-extension-version", chrome.runtime.getManifest().version);
    window.dispatchEvent(new CustomEvent("pbox-cinejoy-extension-ready"));

    if (!pboxSyncListenersRegistered && window.top === window) {
      pboxSyncListenersRegistered = true;

      window.addEventListener("pbox-cinejoy-sync-library", () => {
        chrome.runtime.sendMessage({ source: SOURCE, type: "pbox-sync-library" })
          .then((result) => {
            window.dispatchEvent(new CustomEvent("pbox-cinejoy-library-sync-result", { detail: result }));
          })
          .catch((error) => {
            window.dispatchEvent(new CustomEvent("pbox-cinejoy-library-sync-result", {
              detail: { ok: false, error: String(error) },
            }));
          });
      });

      window.addEventListener("pbox-library-changed", () => {
        chrome.runtime.sendMessage({ source: SOURCE, type: "pbox-library-changed" }).catch(() => {});
      });
    }

    chrome.runtime.sendMessage({
      source: SOURCE,
      type: "pbox-register",
      origin: location.origin,
      pageUrl: location.href,
    }).catch(() => {});
  }

  async function isCinejoyTab() {
    try {
      const result = await chrome.runtime.sendMessage({ source: SOURCE, type: "tab-role" });
      return Boolean(result?.cinejoy);
    } catch {
      return false;
    }
  }

  function sendVideo(video, event) {
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const percent = duration && duration > 0 ? currentTime / duration : null;
    chrome.runtime.sendMessage({
      source: SOURCE,
      type: "playback",
      event,
      frameUrl: location.href,
      src: video.currentSrc || video.src || null,
      currentTime,
      duration,
      percent,
      completed: video.ended || (percent != null && percent >= 0.9),
      frameTitle: document.title || null,
    }).catch(() => {});
  }

  function attachVideo(video) {
    if (seenVideos.has(video)) return;
    seenVideos.add(video);
    sendVideo(video, "found");

    for (const event of ["loadedmetadata", "play", "pause", "ended", "seeking", "seeked"]) {
      video.addEventListener(event, () => sendVideo(video, event), true);
    }

    video.addEventListener("timeupdate", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const bucket = duration > 0 ? Math.floor((currentTime / duration) * 20) : Math.floor(currentTime / 30);
      if (lastSentBucket.get(video) === bucket) return;
      lastSentBucket.set(video, bucket);
      sendVideo(video, "progress");
    }, true);
  }

  function scan() {
    registerPbox();
    sendContext("scan");
    document.querySelectorAll("video").forEach(attachVideo);
  }

  const observer = new MutationObserver(scan);

  async function start() {
    registerPbox();
    if (!(await isCinejoyTab())) return;

    scan();
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    if (/(^|\.)cinejoy\.to$/i.test(location.hostname)) {
      window.addEventListener("popstate", () => sendContext("navigation"));
      window.addEventListener("hashchange", () => sendContext("navigation"));
      setInterval(() => sendContext("tick"), 1000);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
  else void start();
})();
