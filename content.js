(() => {
  const SOURCE = "pbox-cinejoy-scrobbler";
  const MIN_MEDIA_DURATION_SECONDS = 300;
  const seenVideos = new WeakSet();
  const lastSentBucket = new WeakMap();
  let lastContextSignature = "";
  let pboxRegistered = false;
  let pboxSyncListenersRegistered = false;
  let tabRole = null;
  let extensionAlive = true;
  let tickTimer = null;

  function stopTracking() {
    if (!extensionAlive) return;
    extensionAlive = false;
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    observer.disconnect();
  }

  async function sendRuntimeMessage(message) {
    if (!extensionAlive) return null;
    try {
      if (!chrome?.runtime?.id) {
        stopTracking();
        return null;
      }
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (/extension context invalidated/i.test(String(error))) stopTracking();
      return null;
    }
  }

  function extensionVersion() {
    if (!extensionAlive) return null;
    try {
      if (!chrome?.runtime?.id) {
        stopTracking();
        return null;
      }
      return chrome.runtime.getManifest().version;
    } catch {
      stopTracking();
      return null;
    }
  }

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

  function parseCinemaOsUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (!/(^|\.)cinemaos\.(?:live|tech|me|in)$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/(movie|tv)(?:\/watch)?\/(\d+)(?:\/|$)/i);
      if (!match) return null;
      return {
        mediaType: match[1].toLowerCase() === "movie" ? "movie" : "series",
        tmdbId: Number(match[2]),
        season: null,
        episode: null,
      };
    } catch {}
    return null;
  }

  function textOf(selector) {
    const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
    return value || null;
  }

  function metaContent(selector) {
    const value = document.querySelector(selector)?.getAttribute("content")?.replace(/\s+/g, " ").trim();
    return value || null;
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const value = textOf(selector);
      if (value) return value;
    }
    return null;
  }

  function cleanTitle(rawTitle, site) {
    if (!rawTitle) return null;
    let title = rawTitle.replace(/\s+/g, " ").trim();
    if (!title) return null;

    if (site === "netflix") {
      title = title
        .replace(/^Netflix\s*[:|\-]\s*/i, "")
        .replace(/\s*[-|–—]\s*Netflix(?:\s+Official\s+Site)?.*$/i, "");
    } else if (site === "prime-video") {
      title = title
        .replace(/^(?:Amazon\s+)?Prime\s+Video\s*[:|\-]\s*/i, "")
        .replace(/\s*[-|–—]\s*(?:Amazon\s+)?Prime\s+Video.*$/i, "");
    } else if (site === "disney-plus") {
      title = title.replace(/\s*[-|–—]\s*Disney\+.*$/i, "");
    } else if (site === "crunchyroll") {
      title = title.replace(/\s*[-|–—]\s*Crunchyroll.*$/i, "");
    } else if (site === "hulu") {
      title = title.replace(/\s*[-|–—]\s*Hulu.*$/i, "");
    } else if (site === "max") {
      title = title.replace(/\s*[-|–—]\s*(?:HBO\s+)?Max.*$/i, "");
    }

    const siteName = metaContent('meta[property="og:site_name"]');
    if (siteName) {
      const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      title = title.replace(new RegExp(`\\s*[-|–—]\\s*${escaped}\\s*$`, "i"), "");
    }

    title = title
      .replace(/^Watch\s+/i, "")
      .replace(/^Stream\s+/i, "")
      .replace(/\s+S(?:eason\s*)?\d+\s*[: .\-]?\s*E(?:pisode\s*)?\d+.*$/i, "")
      .replace(/\s+Season\s+\d+\s*[,·: -]+\s*Episode\s+\d+.*$/i, "")
      .replace(/\s+\d+\s*x\s*\d+.*$/i, "")
      .trim();

    if (!title || /^(home|watch|video|player|prime video|netflix)$/i.test(title)) return null;
    return title;
  }

  function extractSeasonEpisode(text) {
    if (!text) return { season: null, episode: null };
    const patterns = [
      /\bS(?:eason\s*)?(\d+)\s*[: .\-]?\s*E(?:pisode\s*)?(\d+)\b/i,
      /\bSeason\s*(\d+)\s*[,·: -]+\s*Episode\s*(\d+)\b/i,
      /\b(\d+)\s*x\s*(\d+)\b/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { season: Number(match[1]), episode: Number(match[2]) };
    }

    const seasonMatch = text.match(/\bSeason\s*(\d+)\b/i) || text.match(/\bS(\d+)\b/i);
    const episodeMatch = text.match(/\bEpisode\s*(\d+)\b/i) || text.match(/\bEp\.?\s*(\d+)\b/i) || text.match(/\bE(\d+)\b/i);
    return {
      season: seasonMatch ? Number(seasonMatch[1]) : null,
      episode: episodeMatch ? Number(episodeMatch[1]) : null,
    };
  }

  function providerMetadata(site) {
    const parts = [];
    let preferredTitle = null;

    if (site === "netflix") {
      preferredTitle = firstText([
        '[data-uia="video-title"] h4',
        '[data-uia="video-title"] [class*="title"]',
        '[data-uia="video-title"]',
      ]);
      const value = textOf('[data-uia="video-title"]');
      if (value) parts.push(value);
    } else if (site === "prime-video") {
      preferredTitle = firstText([
        '[data-automation-id="title"]',
        '[data-testid="detail-page-title"]',
        '[data-testid="title"]',
        '.atvwebplayersdk-title-text',
        'h1',
      ]);
      for (const selector of [
        '[data-automation-id="ep-title"]',
        '[data-automation-id="title"]',
        '.atvwebplayersdk-title-text',
        '.atvwebplayersdk-subtitle-text',
      ]) {
        const value = textOf(selector);
        if (value) parts.push(value);
      }
    } else if (site === "disney-plus") {
      preferredTitle = firstText(['h1', '[data-testid="details-title"]', '[class*="title"]']);
    } else if (site === "crunchyroll") {
      preferredTitle = firstText(['h1', '[data-t="series-title"]', '[class*="title"]']);
    } else {
      preferredTitle = metaContent('meta[property="og:title"]') || firstText(['h1']);
    }

    const ogTitle = metaContent('meta[property="og:title"]');
    if (ogTitle) parts.push(ogTitle);
    if (document.title) parts.push(document.title);
    if (tabRole?.tabTitle && tabRole.tabTitle !== document.title) parts.push(tabRole.tabTitle);
    const heading = firstText(['h1', 'h2']);
    if (heading) parts.push(heading);

    const numbers = extractSeasonEpisode(parts.join(" · "));
    return {
      title: cleanTitle(preferredTitle || ogTitle || tabRole?.tabTitle || document.title, site),
      season: numbers.season,
      episode: numbers.episode,
      mediaType: numbers.season != null || numbers.episode != null ? "series" : null,
    };
  }

  function currentMediaContext() {
    const topUrl = tabRole?.tabUrl || location.href;
    const cinejoy = parseCinejoyUrl(topUrl) || parseCinejoyUrl(location.href);
    if (cinejoy) {
      const metadata = providerMetadata("cinejoy");
      const numbers = extractSeasonEpisode(`${metadata.title ?? ""} ${document.title ?? ""}`);
      return {
        ...cinejoy,
        season: cinejoy.season ?? numbers.season,
        episode: cinejoy.episode ?? numbers.episode,
        site: "cinejoy",
        pageUrl: topUrl,
        title: cleanTitle(firstText(["h1"]) || metadata.title || tabRole?.tabTitle || document.title, "cinejoy"),
      };
    }

    const cinemaos = parseCinemaOsUrl(topUrl) || parseCinemaOsUrl(location.href);
    if (cinemaos) {
      const metadata = providerMetadata("cinemaos");
      const numbers = extractSeasonEpisode(`${metadata.title ?? ""} ${document.title ?? ""}`);
      return {
        ...cinemaos,
        season: cinemaos.mediaType === "series" ? numbers.season : null,
        episode: cinemaos.mediaType === "series" ? numbers.episode : null,
        site: "cinemaos",
        pageUrl: topUrl,
        title: cleanTitle(metadata.title || tabRole?.tabTitle || document.title, "cinemaos"),
      };
    }

    const site = tabRole?.site || location.hostname.replace(/^www\./i, "").toLowerCase();
    const metadata = providerMetadata(site);
    return {
      tmdbId: null,
      mediaType: metadata.mediaType,
      season: metadata.season,
      episode: metadata.episode,
      site,
      pageUrl: topUrl,
      title: metadata.title,
    };
  }

  function sendContext(reason) {
    if (!extensionAlive) return;
    if (window.top !== window) return;
    const context = currentMediaContext();
    if (!context?.title && !context?.tmdbId) return;
    const signature = JSON.stringify([
      context.pageUrl,
      context.site,
      context.tmdbId,
      context.mediaType,
      context.season,
      context.episode,
      context.title,
    ]);
    if (reason === "tick" && signature === lastContextSignature) return;
    lastContextSignature = signature;
    void sendRuntimeMessage({ source: SOURCE, type: "provider-context", reason, ...context });
  }

  function registerPbox() {
    if (!extensionAlive) return false;
    const marker = document.querySelector('meta[name="application-name"]');
    if (marker?.getAttribute("content") !== "PBox") return false;
    if (!pboxRegistered) {
      const version = extensionVersion();
      if (!version) return false;
      pboxRegistered = true;
      document.documentElement.setAttribute("data-pbox-cinejoy-extension", "1");
      document.documentElement.setAttribute("data-pbox-cinejoy-extension-version", version);
      document.documentElement.setAttribute("data-pbox-watch-sync-extension", "1");
      document.documentElement.setAttribute("data-pbox-watch-sync-extension-version", version);
      window.dispatchEvent(new CustomEvent("pbox-cinejoy-extension-ready"));
      window.dispatchEvent(new CustomEvent("pbox-watch-sync-extension-ready"));
    }

    if (!pboxSyncListenersRegistered && window.top === window) {
      pboxSyncListenersRegistered = true;

      window.addEventListener("pbox-cinejoy-sync-library", () => {
        sendRuntimeMessage({ source: SOURCE, type: "pbox-sync-library" })
          .then((result) => {
            if (!result) return;
            window.dispatchEvent(new CustomEvent("pbox-cinejoy-library-sync-result", { detail: result }));
          })
          .catch((error) => {
            window.dispatchEvent(new CustomEvent("pbox-cinejoy-library-sync-result", {
              detail: { ok: false, error: String(error) },
            }));
          });
      });

      window.addEventListener("pbox-library-changed", () => {
        void sendRuntimeMessage({ source: SOURCE, type: "pbox-library-changed" });
      });
    }

    void sendRuntimeMessage({
      source: SOURCE,
      type: "pbox-register",
      origin: location.origin,
      pageUrl: location.href,
    });
    return true;
  }

  async function getTabRole() {
    return await sendRuntimeMessage({ source: SOURCE, type: "tab-role" });
  }

  function sendVideo(video, event) {
    if (!extensionAlive) return;
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (duration != null && duration > 0 && duration < MIN_MEDIA_DURATION_SECONDS) return;
    const percent = duration && duration > 0 ? currentTime / duration : null;
    void sendRuntimeMessage({
      source: SOURCE,
      type: "playback",
      event,
      context: currentMediaContext(),
      frameUrl: location.href,
      src: video.currentSrc || video.src || null,
      currentTime,
      duration,
      percent,
      completed: video.ended || (percent != null && percent >= 0.9),
      frameTitle: document.title || null,
    });
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
      if (duration > 0 && duration < MIN_MEDIA_DURATION_SECONDS) return;
      const bucket = duration > 0 ? Math.floor((currentTime / duration) * 20) : Math.floor(currentTime / 30);
      if (lastSentBucket.get(video) === bucket) return;
      lastSentBucket.set(video, bucket);
      sendVideo(video, "progress");
    }, true);
  }

  function scan() {
    if (!extensionAlive) return;
    sendContext("scan");
    document.querySelectorAll("video").forEach(attachVideo);
  }

  const observer = new MutationObserver(scan);

  async function start() {
    if (registerPbox()) return;
    tabRole = await getTabRole();
    if (!tabRole?.trackable) return;

    scan();
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    if (window.top === window) {
      window.addEventListener("popstate", () => sendContext("navigation"));
      window.addEventListener("hashchange", () => sendContext("navigation"));
      tickTimer = setInterval(() => sendContext("tick"), 1500);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
  else void start();
})();
