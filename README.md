# Arc-style Tab to Search for Zen

Start typing a search engine's name, keyword or domain in the URL bar (`you`, `yt`, `wiki`...).
A hint saying **Search YouTube [Tab]** appears on the right. Press **Tab** and the bar switches to
that engine, ready for your query, the same way Arc did it.

Engines come from **Settings → Search → Search Shortcuts**. To add YouTube, right-click
youtube.com's search box and choose "Add a Keyword for this Search", or add it there by hand.

## Why it isn't a regular Zen Mod

Mods in the Zen store are CSS only. This needs JavaScript, so it is a userChrome script and
needs a script loader. Pick one:

### Option A: Sine (a mod manager for Zen that supports JS mods)
1. Install Sine: https://github.com/CosmoCreeper/Sine
2. In Sine's settings, turn on **"Enable installing JS from unofficial sources"**
   (`sine.allow-unsafe-js` in about:config). Sine only runs JS from its own store
   otherwise, so without this the mod installs but does nothing.
3. In Settings → Sine Mods, install from the repo `IksGarG/zen-arc-tab-to-search`.
   Sine reads `theme.json` to find the script.
4. Restart Zen.

### Option B: fx-autoconfig
1. Follow https://github.com/MrOtherGuy/fx-autoconfig: copy `program/` files into
   `/Applications/Zen.app/Contents/Resources/` and `profile/chrome/utils/` into your profile's `chrome/`.
2. Put `arc-tab-to-search.uc.js` in `<profile>/chrome/JS/`.
3. Open `about:support`, click **Clear startup cache**, and restart.

Your profile folder: `about:support` → *Profile Folder* → **Open in Finder**.

## Settings (about:config)
- `arcTabToSearch.minChars` (number, default `2`): how many characters before the hint shows.
