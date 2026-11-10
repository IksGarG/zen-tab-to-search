// ==UserScript==
// @name           Arc-style Tab to Search
// @description    Type the start of a search engine's name, keyword or domain ("you" → YouTube) and press Tab to search with it, like Arc.
// @include        main
// @onlyonce
// ==/UserScript==

(() => {
  "use strict";

  // Optional about:config prefs:
  //   arcTabToSearch.minChars (int, default 2)  – characters needed before a hint shows
  const PREF_MIN_CHARS = "arcTabToSearch.minChars";
  const minChars = () => {
    try { return Services.prefs.getIntPref(PREF_MIN_CHARS, 2); } catch { return 2; }
  };

  const CSS = `
    #arc-tts-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-inline: 6px 4px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0.75;
    }
    #arc-tts-hint[hidden] { display: none !important; }
    #arc-tts-hint img { width: 14px; height: 14px; }
    #arc-tts-hint kbd {
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 5px;
      background: color-mix(in srgb, currentColor 16%, transparent);
    }
    #urlbar-search-mode-indicator { gap: 6px; }
    #arc-tts-indicator-icon { width: 14px; height: 14px; flex-shrink: 0; }
    #arc-tts-indicator-icon[hidden] { display: none !important; }
    /* Chip background takes the engine's icon color; the title keeps the theme color. */
    [arc-tts-colored] #urlbar-search-mode-indicator,
    #urlbar[arc-tts-colored][searchmode] .searchmode-switcher {
      /* Darkened so the (usually same-colored) icon stays visible on top. */
      background-color: color-mix(in srgb, var(--arc-tts-engine-color) 45%, black) !important;
    }
    /* Very light engine colors (e.g. yellow) get dark text so the title stays readable. */
    [arc-tts-light-bg] :is(#urlbar-search-mode-indicator-title, .searchmode-switcher-title) {
      color: #1c1b22 !important;
    }
  `;

  // Newer Firefox/Zen builds no longer expose Services.search; import the module instead.
  function getSearchService() {
    if (Services.search) return Services.search;
    for (const url of [
      "moz-src:///toolkit/components/search/SearchService.sys.mjs",
      "resource://gre/modules/SearchService.sys.mjs",
    ]) {
      try {
        const mod = ChromeUtils.importESModule(url);
        if (mod.SearchService) return mod.SearchService;
      } catch {}
    }
    throw new Error("search service not found");
  }

  function init() {
    const urlbar = window.gURLBar;
    if (!urlbar?.inputField || !window.gBrowser) {
      setTimeout(init, 300);
      return;
    }
    if (urlbar.__arcTabToSearch) return;
    urlbar.__arcTabToSearch = true;

    // ---- styles -----------------------------------------------------------
    const style = document.createElement("style");
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    // ---- hint element ("Search YouTube  [Tab]") ---------------------------
    const hint = document.createElement("div");
    hint.id = "arc-tts-hint";
    hint.hidden = true;
    const icon = document.createElement("img");
    const label = document.createElement("span");
    const kbd = document.createElement("kbd");
    kbd.textContent = "Tab";
    hint.append(icon, label, kbd);
    const inputBox =
      urlbar.inputField.closest(".urlbar-input-box") || urlbar.inputField;
    inputBox.after(hint);

    // ---- engine index -----------------------------------------------------
    let engines = [];
    async function loadEngines() {
      try {
        const search = getSearchService();
        await search.init();
        const list = await search.getVisibleEngines();
        engines = await Promise.all(
          list.map(async (engine) => {
            let iconURL = null;
            try {
              iconURL = engine.getIconURL
                ? await engine.getIconURL(16)
                : engine.iconURI?.spec;
            } catch {}
            let domain = "";
            try {
              domain = (engine.searchUrlDomain || "").replace(/^www\./, "");
            } catch {}
            const keys = new Set();
            const name = engine.name.toLowerCase();
            keys.add(name);
            keys.add(name.replace(/\s+/g, ""));
            if (domain) keys.add(domain.toLowerCase());
            for (const alias of engine.aliases || []) {
              keys.add(alias.toLowerCase().replace(/^@/, ""));
            }
            return { name: engine.name, iconURL, keys: [...keys].filter(Boolean) };
          })
        );
      } catch (e) {
        console.error("[arc-tab-to-search] failed to load engines", e);
      }
    }
    loadEngines();
    const engineObserver = () => loadEngines().then(() => decorateIndicator());
    Services.obs.addObserver(engineObserver, "browser-search-engine-modified");

    // ---- matching ---------------------------------------------------------
    let current = null;

    // What the user actually typed (ignores the autofilled, selected tail).
    function typedText() {
      const f = urlbar.inputField;
      const v = f.value;
      if (f.selectionEnd === v.length && f.selectionStart < v.length) {
        return v.slice(0, f.selectionStart);
      }
      return v;
    }

    function findEngine(text) {
      let best = null;
      let bestScore = Infinity;
      for (const e of engines) {
        for (const key of e.keys) {
          if (!key.startsWith(text)) continue;
          const score = key === text ? 0 : key.length; // exact keyword wins, then shortest
          if (score < bestScore) {
            best = e;
            bestScore = score;
          }
        }
      }
      return best;
    }

    function hide() {
      current = null;
      hint.hidden = true;
    }

    function update() {
      if (urlbar.searchMode) return hide();
      const text = typedText().trim().toLowerCase();
      if (text.length < minChars() || /\s/.test(text)) return hide();
      const match = findEngine(text);
      if (!match) return hide();
      current = match;
      label.textContent = `Search ${match.name}`;
      if (match.iconURL) {
        icon.src = match.iconURL;
        icon.hidden = false;
      } else {
        icon.hidden = true;
      }
      hint.hidden = false;
    }

    function clearInput() {
      if (typeof urlbar.setValue === "function") urlbar.setValue("");
      else urlbar.value = "";
      urlbar.userTypedValue = "";
    }

    // Mirrors Firefox's maybeConfirmSearchModeFromResult: enter the mode, clear the
    // typed keyword, then run the query once the (async) search mode is applied.
    async function enterSearchMode(match) {
      hide();
      const searchMode = { engineName: match.name, entry: "keywordoffer", isPreview: false };
      try {
        const applied = new Promise((resolve) => {
          urlbar.addEventListener("searchmodechanged", resolve, { once: true });
          setTimeout(resolve, 500);
        });
        urlbar.searchMode = searchMode;
        clearInput();
        await applied;
        clearInput();
        urlbar.startQuery?.({ allowAutofill: false });
      } catch (e) {
        console.error("[arc-tab-to-search] could not enter search mode", e);
      }
    }

    // ---- search-mode chip: engine icon + icon-tinted title -----------------
    const colorCache = new Map();

    // Dominant saturated color of an icon, or null for monochrome icons.
    function iconColor(url) {
      if (!url) return Promise.resolve(null);
      if (colorCache.has(url)) return colorCache.get(url);
      const p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const size = 32;
            const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const buckets = new Map(); // hue bucket -> {w, r, g, b}
            for (let i = 0; i < data.length; i += 4) {
              const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
              if (a < 128) continue;
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              const sat = max === 0 ? 0 : (max - min) / max;
              if (sat < 0.3 || max < 50) continue; // skip greys, white, black
              let h;
              if (max === r) h = ((g - b) / (max - min)) % 6;
              else if (max === g) h = (b - r) / (max - min) + 2;
              else h = (r - g) / (max - min) + 4;
              const key = Math.round(((h * 60 + 360) % 360) / 20);
              const w = sat;
              const bk = buckets.get(key) || { w: 0, r: 0, g: 0, b: 0 };
              bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
              buckets.set(key, bk);
            }
            let best = null;
            for (const bk of buckets.values()) if (!best || bk.w > best.w) best = bk;
            if (!best || best.w < 4) return resolve(null);
            resolve(`rgb(${Math.round(best.r / best.w)}, ${Math.round(best.g / best.w)}, ${Math.round(best.b / best.w)})`);
          } catch (e) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
      colorCache.set(url, p);
      return p;
    }

    const indicator = document.getElementById("urlbar-search-mode-indicator");
    const indicatorIcon = document.createElement("img");
    indicatorIcon.id = "arc-tts-indicator-icon";
    indicatorIcon.hidden = true;
    indicator?.prepend(indicatorIcon);

    function setChipColor(color) {
      if (!color) {
        wrapper.style.removeProperty("--arc-tts-engine-color");
        wrapper.removeAttribute("arc-tts-colored");
        wrapper.removeAttribute("arc-tts-light-bg");
        return;
      }
      wrapper.style.setProperty("--arc-tts-engine-color", color);
      wrapper.setAttribute("arc-tts-colored", "true");
      const [r, g, b] = color.match(/\d+/g).map(Number);
      // Background is the color mixed 45% with black (see CSS).
      const luminance = (0.45 * (0.299 * r + 0.587 * g + 0.114 * b)) / 255;
      wrapper.toggleAttribute("arc-tts-light-bg", luminance > 0.7);
    }

    async function decorateIndicator() {
      const engineName = urlbar.searchMode?.engineName;
      const match = engineName && engines.find((e) => e.name === engineName);
      if (!match) {
        indicatorIcon.hidden = true;
        setChipColor(null);
        return;
      }
      if (match.iconURL) {
        indicatorIcon.src = match.iconURL;
        indicatorIcon.hidden = false;
      } else {
        indicatorIcon.hidden = true;
      }
      const color = await iconColor(match.iconURL);
      if (urlbar.searchMode?.engineName !== engineName) return; // changed meanwhile
      setChipColor(color);
    }

    // ---- events -----------------------------------------------------------
    const onInput = () => update();
    const onKeyDown = (event) => {
      if (event.key === "Escape") return hide();
      if (
        event.key !== "Tab" ||
        event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
        !current || hint.hidden
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      enterSearchMode(current);
    };
    const onBlur = () => hide();

    urlbar.inputField.addEventListener("input", onInput);
    urlbar.inputField.addEventListener("blur", onBlur);
    // Capture on the urlbar wrapper so we run before Firefox's own Tab handling.
    // gURLBar is the <moz-urlbar> element itself in newer builds; older ones expose .textbox.
    const wrapper =
      urlbar.textbox ||
      (Element.isInstance?.(urlbar) || urlbar instanceof Element ? urlbar : null) ||
      document.getElementById("urlbar") ||
      urlbar.inputField.parentNode;
    wrapper.addEventListener("keydown", onKeyDown, true);

    // Covers every way into search mode (Tab, @keyword, the engine switcher, tab switches).
    const onSearchModeChanged = () => decorateIndicator();
    wrapper.addEventListener("searchmodechanged", onSearchModeChanged);
    window.addEventListener("Zen:UrlbarSearchModeChanged", onSearchModeChanged);
    gBrowser.tabContainer.addEventListener("TabSelect", onSearchModeChanged);

    window.addEventListener(
      "unload",
      () => Services.obs.removeObserver(engineObserver, "browser-search-engine-modified"),
      { once: true }
    );
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();
