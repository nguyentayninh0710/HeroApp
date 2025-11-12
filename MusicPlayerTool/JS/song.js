// song.js — Fetch song by ID from FastAPI + related list via /api/songs
// Supports url_file as a full <iframe ...> snippet or as a URL (Spotify/YouTube/audio).
// DOM required (from song.html):
// Player:   #playerTitle, #playerArtist, #playerCover, #playerFrameWrap, #btnPrev, #btnNext
// Filters:  #searchInput, #pageSize
// Related:  #relatedGrid, #prevBtn, #nextBtn, #pageIndicator, #emptyState
// Lyrics:   #lyricsSection, #lyricChinese, #lyricKorean, #lyricTrans, #toggleLyrics
(() => {
  "use strict";

  // ---------- Elements ----------
  const playerTitle     = document.getElementById("playerTitle");
  const playerArtist    = document.getElementById("playerArtist");
  const playerCover     = document.getElementById("playerCover");
  const playerFrameWrap = document.getElementById("playerFrameWrap");
  const btnPrev         = document.getElementById("btnPrev");
  const btnNext         = document.getElementById("btnNext");

  const grid            = document.getElementById("relatedGrid");
  const prevBtn         = document.getElementById("prevBtn");
  const nextBtn         = document.getElementById("nextBtn");
  const pageIndicator   = document.getElementById("pageIndicator");
  const emptyState      = document.getElementById("emptyState");

  const searchInput     = document.getElementById("searchInput");
  const pageSizeSel     = document.getElementById("pageSize");

  const lyricsSection   = document.getElementById("lyricsSection");
  const lyricChinese    = document.getElementById("lyricChinese");
  const lyricKorean     = document.getElementById("lyricKorean");
  const lyricTrans      = document.getElementById("lyricTrans");
  const toggleLyricsBtn = document.getElementById("toggleLyrics");

  // ---------- API base ----------
  const API_BASE = document.body?.getAttribute("data-api-base")?.trim()
    || `${location.protocol}//${location.hostname}:8000`;
  const ROUTES = {
    song:   (id) => `${API_BASE}/api/songs/${encodeURIComponent(id)}`,
    list:        `${API_BASE}/api/songs`,
  };

  // ---------- State ----------
  const state = {
    current: null,     // mapped song
    q: "",
    page: 1,
    pageSize: parseInt(pageSizeSel?.value || "9", 10),
    sort: "id_desc",
    list: [],
    pages: 1,
    total: 0,
    indexInPage: 0
  };

  const LS_KEYS = { lastId: "song.last_id" };

  // ---------- Utils ----------
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const esc = (str) =>
    (str || "").replace(/[&<>"']/g, (s) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[s]));

  const takeIdFromUri = (uri) => {
    if (!uri) return "";
    const parts = String(uri).split(":");
    return parts.length >= 3 ? parts[2] : "";
  };

  const takeSpotifyIdFromUrl = (url) => {
    try {
      const u = new URL(url);
      const segs = u.pathname.split("/").filter(Boolean);
      // /track/<ID>
      const tidx = segs.indexOf("track");
      if (tidx >= 0 && segs[tidx + 1]) return segs[tidx + 1];
      // /embed/track/<ID>
      const eidx = segs.indexOf("embed");
      if (eidx >= 0 && segs[eidx + 1] === "track" && segs[eidx + 2]) return segs[eidx + 2];
    } catch {}
    return "";
  };

  const isIframeSnippet = (val) => typeof val === "string" && /<\s*iframe[\s>]/i.test(val);
  const looksLikeUrl = (val) => {
    try { return !!new URL(val); } catch { return false; }
  };
  const isAudioUrl = (url) => /\.(mp3|ogg|wav)(\?|#|$)/i.test(url || "");
  const isYouTubeUrl = (url) => /(?:youtube\.com|youtu\.be)/i.test(url || "");

  const youTubeEmbedFromUrl = (url) => {
    try {
      const u = new URL(url);
      if (/youtu\.be$/i.test(u.hostname)) {
        const id = u.pathname.replace("/", "");
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }
      if (/youtube\.com$/i.test(u.hostname)) {
        const v = u.searchParams.get("v");
        if (v) return `https://www.youtube.com/embed/${v}`;
        const segs = u.pathname.split("/").filter(Boolean);
        if (segs[0] === "embed"  && segs[1]) return `https://www.youtube.com/embed/${segs[1]}`;
        if (segs[0] === "shorts" && segs[1]) return `https://www.youtube.com/embed/${segs[1]}`;
      }
    } catch {}
    return "";
  };

  function mapSong(row) {
    // API fields:
    // song_id, title, duration, url_file, cover_image_url, thumbnail_url,
    // genre, language, lyrics, spotify_track_id, spotify_track_uri,
    // spotify_track_url, spotify_preview_url
    const id    = row.song_id;
    const title = row.title || "Untitled";
    const cover = row.cover_image_url || "https://picsum.photos/seed/cover-fallback/900/900";
    const thumb = row.thumbnail_url   || "https://picsum.photos/seed/thumb-fallback/120/120";
    const artist = ""; // not provided by current API

    // Derive Spotify embed src (if possible)
    let spId = row.spotify_track_id || "";
    if (!spId && row.spotify_track_url) spId = takeSpotifyIdFromUrl(row.spotify_track_url);
    if (!spId && row.spotify_track_uri) spId = takeIdFromUri(row.spotify_track_uri);
    const embedFromSpotify = spId ? `https://open.spotify.com/embed/track/${spId}` : "";

    const urlFile = row.url_file || "";
    const lyricsSingle = row.lyrics || "";

    return {
      id, title, artist, cover, thumb,
      duration: row.duration || "",
      raw: row,
      player: {
        iframeSnippet: isIframeSnippet(urlFile) ? urlFile.trim() : "",
        spotifyEmbed: embedFromSpotify,
        spotifyPreview: row.spotify_preview_url || "",
        urlFile: looksLikeUrl(urlFile) ? urlFile : "",
      },
      // NOTE: auto-translate later
      lyrics: { chinese: "", korean: "", trans: lyricsSingle }
    };
  }

  // ---------- API callers ----------
  async function fetchJSON(url) {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} – ${txt}`);
    }
    return res.json();
  }

  async function fetchSongById(id) {
    const row = await fetchJSON(ROUTES.song(id));
    return mapSong(row);
  }

  async function fetchRelated({ q, page, pageSize, sort }) {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    usp.set("page", String(page));
    usp.set("page_size", String(pageSize));
    if (sort) usp.set("sort", sort);

    const rows = await fetchJSON(`${ROUTES.list}?${usp.toString()}`);
    return rows.map(mapSong);
  }

  // ---------- Player rendering helpers ----------
  function renderIframe(html) {
    playerFrameWrap.innerHTML = html;
  }

  function renderSpotifyEmbed(src) {
    playerFrameWrap.innerHTML = `
      <iframe style="border-radius:12px"
        src="${src}"
        width="100%" height="352" frameborder="0" allowfullscreen=""
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"></iframe>`;
  }

  function renderAudio(url) {
    playerFrameWrap.innerHTML = `
      <audio controls style="width:100%">
        <source src="${url}">
        Your browser does not support the audio element.
      </audio>`;
  }

  function renderYouTubeEmbed(src) {
    playerFrameWrap.innerHTML = `
      <iframe
        src="${src}"
        width="100%" height="352" frameborder="0" allowfullscreen
        loading="lazy"></iframe>`;
  }

  // ---------- Player renderers ----------
  function renderPlayer(song) {
    state.current = song;

    if (playerTitle)  playerTitle.textContent  = song.title || "Now Playing";
    if (playerArtist) playerArtist.textContent = song.artist || "";
    if (playerCover)  playerCover.src          = song.cover;

    if (playerFrameWrap) {
      const p = song.player || {};
      if (p.iframeSnippet) {
        renderIframe(p.iframeSnippet);
      } else if (p.spotifyEmbed) {
        renderSpotifyEmbed(p.spotifyEmbed);
      } else if (p.urlFile) {
        const u = p.urlFile;
        if (/open\.spotify\.com/i.test(u)) {
          const sid = takeSpotifyIdFromUrl(u);
          if (sid) renderSpotifyEmbed(`https://open.spotify.com/embed/track/${sid}`);
          else playerFrameWrap.innerHTML = `<div class="text-muted small">Invalid Spotify URL.</div>`;
        } else if (isYouTubeUrl(u)) {
          const y = youTubeEmbedFromUrl(u);
          if (y) renderYouTubeEmbed(y);
          else playerFrameWrap.innerHTML = `<div class="text-muted small">Invalid YouTube URL.</div>`;
        } else if (isAudioUrl(u)) {
          renderAudio(u);
        } else {
          playerFrameWrap.innerHTML = `
            <div class="p-3 bg-body-tertiary rounded-3">
              <a class="link-primary" href="${u}" target="_blank" rel="noopener">Open media</a>
            </div>`;
        }
      } else if (p.spotifyPreview) {
        renderAudio(p.spotifyPreview);
      } else {
        playerFrameWrap.innerHTML = `<div class="text-muted small">No preview/Embed available.</div>`;
      }
    }

    try { localStorage.setItem(LS_KEYS.lastId, String(song.id || "")); } catch {}

    renderLyricsFor(song);
  }

  function renderLyricsFor(song) {
    if (!lyricsSection) return;
    const L = song?.lyrics || {};
    const hasAny = !!(L.chinese || L.korean || L.trans);

    if (!hasAny) {
      lyricsSection.classList.add("d-none");
      if (lyricChinese) lyricChinese.textContent = "";
      if (lyricKorean)  lyricKorean.textContent = "";
      if (lyricTrans)   lyricTrans.textContent  = "";
      return;
    }

    if (lyricChinese) lyricChinese.textContent = L.chinese || "";
    if (lyricKorean)  lyricKorean.textContent  = L.korean  || "";
    if (lyricTrans)   lyricTrans.textContent   = L.trans   || "";

    lyricsSection.classList.remove("d-none");
  }

  // ======== Translator integration (Google w/ key -> LibreTranslate fallback) ========
  // HTML optional:
  //   <body data-gtranslate-key="AIza..." data-libre-url="https://libretranslate.de">
  const _translatorLib = (typeof window !== "undefined" && window.Translator) ? new window.Translator() : null;
  const _GGL_KEY_RAW = (document.body?.getAttribute("data-gtranslate-key") || "").trim();
  const _LIBRE_URL = (document.body?.getAttribute("data-libre-url") || "https://libretranslate.de").replace(/\/+$/,"");

  // Heuristic Google key (simple): start with AIza + length check
  const _looksValidGoogleKey = /^AIza[0-9A-Za-z_\-]{20,}$/.test(_GGL_KEY_RAW);
  const _useGoogle = !!_translatorLib && _looksValidGoogleKey;

  function _translateViaGoogle(text, to) {
    return new Promise((resolve) => {
      if (!_useGoogle || !text) return resolve("");
      const cfg = { from: "auto", to, callback: (out) => resolve(out || "") };
      cfg.api_key = _GGL_KEY_RAW;
      try {
        _translatorLib.translateLanguage(String(text || ""), cfg);
      } catch (e) {
        console.warn("[song.js] Google translate failed, fallback will be used:", e);
        resolve("");
      }
    });
  }

  async function _translateViaLibre(text, to) {
    try {
      const res = await fetch(`${_LIBRE_URL}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: String(text || ""),
          source: "auto",
          target: to,
          format: "text",
        }),
      });
      if (!res.ok) {
        console.warn("[song.js] LibreTranslate HTTP", res.status, await res.text());
        return "";
      }
      const data = await res.json();
      return (data?.translatedText || "");
    } catch (e) {
      console.warn("[song.js] LibreTranslate error:", e);
      return "";
    }
  }

  function _translateOnce(text, to) {
    if (_useGoogle) return _translateViaGoogle(text, to);
    return _translateViaLibre(text, to);
  }

  async function _translateToTargets(text) {
    if (!text) return { en: "", zh: "", ko: "" };
    const [en, zh, ko] = await Promise.all([
      _translateOnce(text, "en"),
      _translateOnce(text, "zh"),
      _translateOnce(text, "ko"),
    ]);
    return { en, zh, ko };
  }

  function _setLyricsLoading(flag) {
    const set = (el, txt) => { if (el) el.textContent = txt; };
    if (flag) {
      set(lyricTrans,   "Translating to English…");
      set(lyricChinese, "正在翻译为中文…");
      set(lyricKorean,  "한국어로 번역 중…");
      lyricsSection?.classList.remove("d-none");
    }
  }

  // Hook: auto-translate after base render
  const __renderLyricsFor = renderLyricsFor;
  renderLyricsFor = async function (song) {
    __renderLyricsFor(song);

    const baseText = song?.raw?.lyrics || song?.lyrics?.trans || "";
    if (!baseText) return;

    _setLyricsLoading(true);

    try {
      const { en, zh, ko } = await _translateToTargets(baseText);
      if (lyricTrans)   lyricTrans.textContent   = en   || song?.lyrics?.trans   || "";
      if (lyricChinese) lyricChinese.textContent = zh   || song?.lyrics?.chinese || "";
      if (lyricKorean)  lyricKorean.textContent  = ko   || song?.lyrics?.korean  || "";
      lyricsSection?.classList.remove("d-none");
    } catch (e) {
      console.error("[song.js] translateToTargets failed:", e);
    }
  };

  // ---------- Related list (server-side paging) ----------
  async function loadRelatedPage() {
    try {
      const list = await fetchRelated({
        q: state.q,
        page: state.page,
        pageSize: state.pageSize,
        sort: state.sort
      });
      state.list = list;
      state.pages = list.length > 0 ? 9999 : 1; // unknown total from API -> keep paging enabled
      state.total = 0;
      renderRelated();
    } catch (err) {
      console.error("[song.js] Related fetch failed:", err);
      state.list = [];
      renderRelated();
    }
  }

  function renderRelated() {
    if (!grid) return;

    if (pageIndicator) pageIndicator.textContent = `Page ${state.page}`;
    if (prevBtn) prevBtn.disabled = state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.list.length < state.pageSize;

    if (!state.list.length) {
      if (emptyState) emptyState.classList.remove("d-none");
      grid.innerHTML = "";
      return;
    }
    if (emptyState) emptyState.classList.add("d-none");

    grid.innerHTML = state.list.map((s, idx) => {
      const isCurrent = String(state.current?.id || "") === String(s.id || "");
      const cover = s.cover || "https://picsum.photos/seed/cover-fallback/600/400";
      const thumb = s.thumb || "https://picsum.photos/seed/thumb-fallback/120/120";
      return `
        <div class="col-12 col-sm-6 col-lg-4">
          <article class="song-card">
            <img class="song-cover" src="${cover}" alt="${esc(s.title || "Song")}" loading="lazy">
            <div class="song-body">
              <img class="song-thumb" src="${thumb}" alt="${esc(s.title || "Song")}" loading="lazy">
              <div class="song-meta">
                <h3 class="song-title" title="${esc(s.title || "")}">${esc(s.title || "")}</h3>
                <p class="song-artist" title="${esc(s.artist || "")}">${esc(s.artist || "")}</p>
              </div>
            </div>
            <div class="song-actions">
              <button class="btn btn-outline-primary btn-sm" data-action="play" data-index="${idx}">
                ${isCurrent ? '<i class="bi bi-music-note-beamed"></i> Playing' : '<i class="bi bi-play-circle"></i> Play'}
              </button>
              <a class="btn btn-outline-primary btn-sm" href="?id=${encodeURIComponent(s.id || "")}">
                <i class="bi bi-box-arrow-up-right"></i> Open
              </a>
            </div>
          </article>
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-action='play']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-index") || "0");
        state.indexInPage = clamp(index, 0, Math.max(0, state.list.length - 1));
        const target = state.list[state.indexInPage];
        if (target) renderPlayer(target);
        renderRelated();
      });
    });
  }

  // ---------- Player navigation ----------
  async function nextInRelated(step = 1) {
    if (!state.list.length) return;
    let idx = state.indexInPage + step;

    if (idx >= 0 && idx < state.list.length) {
      state.indexInPage = idx;
      renderPlayer(state.list[state.indexInPage]);
      renderRelated();
      return;
    }

    if (idx < 0) {
      if (state.page <= 1) return;
      state.page -= 1;
      await loadRelatedPage();
      state.indexInPage = Math.max(0, state.list.length - 1);
      if (state.list[state.indexInPage]) {
        renderPlayer(state.list[state.indexInPage]);
        renderRelated();
      }
    } else if (idx >= state.list.length) {
      state.page += 1;
      await loadRelatedPage();
      state.indexInPage = 0;
      if (state.list[state.indexInPage]) {
        renderPlayer(state.list[state.indexInPage]);
        renderRelated();
      }
    }
  }

  // ---------- Events ----------
  btnPrev?.addEventListener("click", () => { nextInRelated(-1); });
  btnNext?.addEventListener("click", () => { nextInRelated(+1); });

  searchInput?.addEventListener("input", async () => {
    state.q = searchInput.value || "";
    state.page = 1;
    await loadRelatedPage();
  });

  pageSizeSel?.addEventListener("change", async () => {
    state.pageSize = parseInt(pageSizeSel.value, 10) || 9;
    state.page = 1;
    await loadRelatedPage();
  });

  prevBtn?.addEventListener("click", async () => {
    if (state.page > 1) {
      state.page -= 1;
      await loadRelatedPage();
    }
  });

  nextBtn?.addEventListener("click", async () => {
    if (state.list.length >= state.pageSize) {
      state.page += 1;
      await loadRelatedPage();
    }
  });

  toggleLyricsBtn?.addEventListener("click", () => {
    if (!lyricsSection) return;
    lyricsSection.classList.toggle("expanded");
    const isExp = lyricsSection.classList.contains("expanded");
    toggleLyricsBtn.innerHTML = isExp
      ? '<i class="bi bi-arrows-angle-contract"></i> Collapse'
      : '<i class="bi bi-arrows-fullscreen"></i> Expand';
  });

  // ---------- Init ----------
  (async function init() {
    await loadRelatedPage();

    const usp = new URLSearchParams(location.search);
    const idParam = usp.get("id");

    try {
      if (idParam) {
        const s = await fetchSongById(idParam);
        renderPlayer(s);
        const found = state.list.findIndex((x) => String(x.id) === String(s.id));
        if (found >= 0) state.indexInPage = found;
      } else {
        let played = false;
        try {
          const lastId = localStorage.getItem(LS_KEYS.lastId);
          if (lastId) {
            const s2 = await fetchSongById(lastId);
            renderPlayer(s2);
            const found = state.list.findIndex((x) => String(x.id) === String(s2.id));
            if (found >= 0) state.indexInPage = found;
            played = true;
          }
        } catch {}
        if (!played) {
          if (state.list[0]) {
            state.indexInPage = 0;
            renderPlayer(state.list[0]);
          } else {
            if (playerTitle)  playerTitle.textContent  = "No songs available";
            if (playerArtist) playerArtist.textContent = "";
            if (playerCover)  playerCover.src = "https://picsum.photos/seed/cover-fallback/900/900";
            if (playerFrameWrap) playerFrameWrap.innerHTML = "";
          }
        }
      }
    } catch (err) {
      console.error("[song.js] Failed to load initial song:", err);
      if (playerTitle)  playerTitle.textContent  = "Load error";
      if (playerArtist) playerArtist.textContent = "";
      if (playerCover)  playerCover.src = "https://picsum.photos/seed/cover-fallback/900/900";
      if (playerFrameWrap) playerFrameWrap.innerHTML = `<div class="text-danger small">Failed to load song.</div>`;
    }

    renderRelated();
  })();
})();
