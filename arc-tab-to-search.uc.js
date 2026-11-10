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
  `;

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
        await Services.search.init();
        const list = await Services.search.getVisibleEngines();
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
    const engineObserver = () => loadEngines();
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

    function enterSearchMode(match) {
      hide();
      const searchMode = { engineName: match.name, entry: "typed" };
      try {
        urlbar.value = "";
        if (typeof urlbar.setSearchMode === "function") {
          urlbar.setSearchMode(searchMode, gBrowser.selectedBrowser);
        } else {
          urlbar.searchMode = searchMode;
        }
        urlbar.startQuery?.({ allowAutofill: false });
      } catch (e) {
        console.error("[arc-tab-to-search] could not enter search mode", e);
      }
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
    const wrapper = urlbar.textbox || urlbar.inputField.parentNode;
    wrapper.addEventListener("keydown", onKeyDown, true);

    window.addEventListener(
      "unload",
      () => Services.obs.removeObserver(engineObserver, "browser-search-engine-modified"),
      { once: true }
    );
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();
