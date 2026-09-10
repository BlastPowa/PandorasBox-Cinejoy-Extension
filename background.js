const SOURCE = "pbox-cinejoy-scrobbler";
const PENDING_KEY = "pboxCinejoyPending";
const ORIGIN_KEY = "pboxCinejoyOrigin";
const FLUSH_ALARM = "pboxCinejoyFlush";
const LIBRARY_SYNC_ALARM = "pboxCinejoyLibrarySync";
const LIBRARY_SYNCED_KEY = "pboxCinejoyLibrarySynced";
const CINEJOY_LIST_NAME = "Pandora's Box";
const MAX_PENDING = 100;
const MAX_EVENTS = 500;
const pboxTabs = new Map();
const cinejoyContexts = new Map();
const lastForwarded = new Map();
let flushPromise = null;
let librarySyncPromise = null;

function parseCinejoyUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)cinejoy\.to$/i.test(url.hostname)) return null;
    let match = url.pathname.match(/^\/watch\/tv\/(\d+)\/(\d+)\/(\d+)(?:\/|$)/i);
    if (match) return { mediaType: "series", tmdbId: Number(match[1]), season: Number(match[2]), episode: Number(match[3]), pageUrl: rawUrl };
    match = url.pathname.match(/^\/watch\/movie\/(\d+)(?:\/|$)/i);
    if (match) return { mediaType: "movie", tmdbId: Number(match[1]), season: null, episode: null, pageUrl: rawUrl };
    match = url.pathname.match(/^\/movie\/(\d+)(?:-|\/|$)/i);
    if (match) return { mediaType: "movie", tmdbId: Number(match[1]), season: null, episode: null, pageUrl: rawUrl };
    match = url.pathname.match(/^\/series\/(\d+)(?:-|\/|$)/i);
    if (match) return { mediaType: "series", tmdbId: Number(match[1]), season: null, episode: null, pageUrl: rawUrl };
  } catch {}
  return null;
}

function eventKey(event) {
  return `${event.tmdbId}:${event.mediaType}:${event.season ?? 0}:${event.episode ?? 0}`;
}

function shouldForward(event) {
  if (["ended", "pause", "seeked"].includes(event.event) || event.completed) return true;
  if (event.event !== "progress" && event.event !== "play") return false;
  const key = eventKey(event);
  const now = Date.now();
  const last = lastForwarded.get(key) ?? 0;
  if (now - last < 30000) return false;
  lastForwarded.set(key, now);
  return true;
}

async function rememberDiagnostic(event) {
  const { cinejoyPlaybackEvents = [] } = await chrome.storage.local.get({ cinejoyPlaybackEvents: [] });
  await chrome.storage.local.set({ cinejoyPlaybackEvents: [...cinejoyPlaybackEvents, event].slice(-MAX_EVENTS) });
}

async function savePending(event) {
  const { [PENDING_KEY]: pending = [] } = await chrome.storage.local.get({ [PENDING_KEY]: [] });
  const key = eventKey(event);
  const existing = pending.find((item) => eventKey(item) === key);
  if (existing?.completed && !event.completed) return;
  const next = pending.filter((item) => eventKey(item) !== key);
  next.push(event);
  await chrome.storage.local.set({ [PENDING_KEY]: next.slice(-MAX_PENDING) });
}

async function candidatePboxTabs() {
  const knownTabs = [...pboxTabs.entries()].map(([tabId, origin]) => ({ tabId, origin }));
  if (knownTabs.length) return knownTabs;

  const stored = await chrome.storage.local.get({ [ORIGIN_KEY]: "http://localhost:3000" });
  const origin = stored[ORIGIN_KEY];
  if (!origin) return [];
  try {
    const matches = await chrome.tabs.query({ url: `${origin.replace(/\/$/, "")}/*` });
    for (const tab of matches) {
      if (tab.id != null) pboxTabs.set(tab.id, origin);
    }
    return matches.filter((tab) => tab.id != null).map((tab) => ({ tabId: tab.id, origin }));
  } catch {
    return [];
  }
}

async function sendToPbox(event) {
  const candidates = await candidatePboxTabs();
  for (const { tabId, origin } of candidates) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "MAIN",
        args: [event],
        func: async (payload) => {
          try {
            const response = await fetch("/api/cinejoy/scrobble", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            let body = null;
            try { body = await response.json(); } catch {}
            return { ok: response.ok, status: response.status, body };
          } catch (error) {
            return { ok: false, status: 0, error: String(error) };
          }
        },
      });
      const result = results?.[0]?.result;
      if (result?.ok) {
        console.log("[PBox Cinejoy Sync] synced", eventKey(event), result.body);
        return true;
      }
      if (result?.status === 401) console.warn("[PBox Cinejoy Sync] PBox is open but signed out; queued for later.");
      else console.warn("[PBox Cinejoy Sync] delivery failed", origin, result);
    } catch (error) {
      pboxTabs.delete(tabId);
      console.warn("[PBox Cinejoy Sync] tab delivery failed", error);
    }
  }
  return false;
}

async function deliverOrQueue(event) {
  if (await sendToPbox(event)) return true;
  await savePending(event);
  return false;
}

async function flushPending() {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const { [PENDING_KEY]: pending = [] } = await chrome.storage.local.get({ [PENDING_KEY]: [] });
    const remaining = [];
    for (const event of pending) {
      if (!(await sendToPbox(event))) remaining.push(event);
    }
    await chrome.storage.local.set({ [PENDING_KEY]: remaining });
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}

async function fetchPboxLibrary() {
  const candidates = await candidatePboxTabs();
  for (const { tabId } of candidates) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "MAIN",
        func: async () => {
          try {
            const response = await fetch("/api/cinejoy/library", { credentials: "include" });
            const body = await response.json().catch(() => null);
            return { ok: response.ok, status: response.status, body };
          } catch (error) {
            return { ok: false, status: 0, error: String(error) };
          }
        },
      });
      const result = results?.[0]?.result;
      if (result?.ok && Array.isArray(result.body?.items)) return result.body.items;
      if (result?.status === 401) return null;
    } catch {
      pboxTabs.delete(tabId);
    }
  }
  return null;
}

function libraryItemKey(item) {
  return `${item.mediaType}:${item.tmdbId}`;
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(value);
    };
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(true);
    }).catch(() => finish(false));
  });
}

async function addCurrentCinejoyTitleToList(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    args: [CINEJOY_LIST_NAME],
    func: async (listName) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const buttonLabel = (button) => (button.getAttribute("aria-label") || button.textContent || "").trim();
      const buttons = () => Array.from(document.querySelectorAll("button"));
      const findButton = (pattern) => buttons().find((button) => pattern.test(buttonLabel(button)));
      const waitFor = async (find, timeoutMs = 12000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const value = find();
          if (value) return value;
          await sleep(150);
        }
        return null;
      };

      const listControl = await waitFor(() => findButton(/^(add to list|manage lists)$/i));
      if (!listControl) return { ok: false, reason: "Cinejoy list button was not found" };

      if (/^manage lists$/i.test(buttonLabel(listControl))) {
        return { ok: true, action: "already-present" };
      }

      listControl.click();
      await sleep(200);

      const existingList = await waitFor(
        () => buttons().find((button) => buttonLabel(button).toLowerCase() === listName.toLowerCase()),
        1500,
      );
      if (existingList) {
        existingList.click();
        await sleep(350);
        return { ok: true, action: "added" };
      }

      const createList = await waitFor(() => findButton(/^create new list$/i), 2500);
      if (!createList) return { ok: false, reason: "Cinejoy list picker did not open" };
      createList.click();

      const input = await waitFor(() => document.querySelector("input"), 2500);
      if (!input) return { ok: false, reason: "Cinejoy list name field was not found" };
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, listName);
      else input.value = listName;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: listName }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const createAndAdd = await waitFor(
        () => buttons().find((button) => /^create\s*&\s*add$/i.test(buttonLabel(button)) && !button.disabled),
        2500,
      );
      if (!createAndAdd) return { ok: false, reason: "Cinejoy did not enable Create & Add" };
      createAndAdd.click();
      await sleep(400);
      return { ok: true, action: "created-list-and-added" };
    },
  });
  return results?.[0]?.result ?? { ok: false, reason: "No result from Cinejoy tab" };
}

async function syncLibraryToCinejoy({ force = false } = {}) {
  if (librarySyncPromise) return librarySyncPromise;
  librarySyncPromise = (async () => {
    const items = await fetchPboxLibrary();
    if (!items) return { ok: false, error: "Open PBox in this browser and make sure you are signed in." };

    const { [LIBRARY_SYNCED_KEY]: synced = {} } = await chrome.storage.local.get({ [LIBRARY_SYNCED_KEY]: {} });
    const candidates = items.filter((item) => item?.tmdbId && item?.mediaType && (force || !synced[libraryItemKey(item)]));
    if (!candidates.length) {
      return { ok: true, added: 0, alreadyPresent: items.length, failed: 0, total: items.length };
    }

    let tabId = null;
    let added = 0;
    let alreadyPresent = items.length - candidates.length;
    let failed = 0;
    const nextSynced = { ...synced };

    try {
      const first = candidates[0];
      const firstUrl = `https://cinejoy.to/${first.mediaType === "movie" ? "movie" : "series"}/${first.tmdbId}`;
      const tab = await chrome.tabs.create({ url: firstUrl, active: false });
      tabId = tab.id ?? null;
      if (tabId == null) return { ok: false, error: "Could not open a Cinejoy sync tab." };

      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        const url = `https://cinejoy.to/${item.mediaType === "movie" ? "movie" : "series"}/${item.tmdbId}`;
        if (index > 0) await chrome.tabs.update(tabId, { url });
        const loaded = await waitForTabComplete(tabId);
        if (!loaded) {
          failed += 1;
          continue;
        }

        try {
          const result = await addCurrentCinejoyTitleToList(tabId);
          if (result?.ok) {
            const key = libraryItemKey(item);
            nextSynced[key] = new Date().toISOString();
            if (result.action === "already-present") alreadyPresent += 1;
            else added += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }
    } finally {
      await chrome.storage.local.set({ [LIBRARY_SYNCED_KEY]: nextSynced });
      if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
    }

    return { ok: failed === 0, added, alreadyPresent, failed, total: items.length };
  })().finally(() => { librarySyncPromise = null; });
  return librarySyncPromise;
}

async function handlePlayback(message, sender) {
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url ?? null;
  const directContext = parseCinejoyUrl(tabUrl);
  if (tabId == null || !directContext) return;

  const tabContext = cinejoyContexts.get(tabId) ?? directContext;
  const event = {
    ...message,
    ...directContext,
    ...tabContext,
    source: "cinejoy",
    frameUrl: message.frameUrl ?? null,
    currentTime: message.currentTime ?? 0,
    duration: message.duration ?? null,
    percent: message.percent ?? null,
    completed: Boolean(message.completed),
    title: tabContext.title ?? sender.tab?.title ?? message.frameTitle ?? null,
    recordedAt: new Date().toISOString(),
  };

  if (!event.tmdbId || !event.mediaType) return;
  await rememberDiagnostic(event);
  if (shouldForward(event)) await deliverOrQueue(event);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== SOURCE) return;

  const run = async () => {
    const tabId = sender.tab?.id;
    if (message.type === "tab-role") {
      return { ok: true, cinejoy: Boolean(parseCinejoyUrl(sender.tab?.url ?? null)) };
    }

    if (message.type === "pbox-register" && tabId != null) {
      pboxTabs.set(tabId, message.origin);
      await chrome.storage.local.set({ [ORIGIN_KEY]: message.origin });
      await flushPending();
      void syncLibraryToCinejoy();
      return { ok: true };
    }

    if (message.type === "pbox-sync-library") {
      return syncLibraryToCinejoy({ force: true });
    }

    if (message.type === "pbox-library-changed") {
      void syncLibraryToCinejoy();
      return { ok: true, scheduled: true };
    }

    if (message.type === "cinejoy-context" && tabId != null) {
      cinejoyContexts.set(tabId, {
        mediaType: message.mediaType,
        tmdbId: message.tmdbId,
        season: message.season ?? null,
        episode: message.episode ?? null,
        pageUrl: message.pageUrl ?? sender.tab?.url ?? null,
        title: message.title ?? sender.tab?.title ?? null,
      });
      return { ok: true };
    }

    if (message.type === "playback") await handlePlayback(message, sender);
    return { ok: true };
  };

  void run().then((result) => sendResponse(result ?? { ok: true })).catch((error) => {
    console.error("[PBox Cinejoy Sync]", error);
    sendResponse({ ok: false, error: String(error) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pboxTabs.delete(tabId);
  cinejoyContexts.delete(tabId);
});

function ensureFlushAlarm() {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LIBRARY_SYNC_ALARM, { periodInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureFlushAlarm();
  void flushPending();
});

chrome.runtime.onStartup.addListener(() => {
  ensureFlushAlarm();
  void flushPending();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void flushPending();
  if (alarm.name === LIBRARY_SYNC_ALARM) void syncLibraryToCinejoy();
});

ensureFlushAlarm();
