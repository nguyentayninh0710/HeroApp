// song.js — Top single player + Related songs + Lyrics panel
// Copy into /JS/song.js and include in song.html after window.__EMBEDS__.
// Requirements in DOM (from the provided song.html):
// - Player: #playerTitle, #playerArtist, #playerCover, #playerFrameWrap, #btnPrev, #btnNext
// - Controls: #searchInput, #pageSize
// - Related list: #relatedGrid, #prevBtn, #nextBtn, #pageIndicator, #emptyState
// - Lyrics: #lyricsSection, #lyricRoman, #lyricKorean, #lyricTrans, #toggleLyrics

(() => {
  "use strict";

  // ---------- Elements ----------
  // Player
  const playerTitle     = document.getElementById("playerTitle");
  const playerArtist    = document.getElementById("playerArtist");
  const playerCover     = document.getElementById("playerCover");
  const playerFrameWrap = document.getElementById("playerFrameWrap");
  const btnPrev         = document.getElementById("btnPrev");
  const btnNext         = document.getElementById("btnNext");

  // Related section
  const grid          = document.getElementById("relatedGrid");
  const prevBtn       = document.getElementById("prevBtn");
  const nextBtn       = document.getElementById("nextBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const emptyState    = document.getElementById("emptyState");

  // Filters
  const searchInput = document.getElementById("searchInput");
  const pageSizeSel = document.getElementById("pageSize");

  // Lyrics
  const lyricsSection  = document.getElementById("lyricsSection");
  const lyricRoman     = document.getElementById("lyricRoman");
  const lyricKorean    = document.getElementById("lyricKorean");
  const lyricTrans     = document.getElementById("lyricTrans");
  const toggleLyricsBtn= document.getElementById("toggleLyrics");

  // ---------- Data ----------
  const RAW = Array.isArray(window.__EMBEDS__) ? window.__EMBEDS__ : [];
  if (!Array.isArray(window.__EMBEDS__)) {
    console.warn("[song.js] window.__EMBEDS__ is missing or not an array. Related list will be empty.");
  }

  // ---------- State ----------
  const state = {
    index: 0,                                   // currently playing (index in RAW)
    q: "",                                      // search query for related
    page: 1,                                    // current page of related
    pageSize: parseInt(pageSizeSel?.value || "9", 10),
    filtered: RAW.slice()                       // related list source (filtered from RAW)
  };

  const LS_KEYS = { lastId: "song.last_id" };

  // ---------- Utils ----------
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const esc = (str) =>
    (str || "").replace(/[&<>"']/g, (s) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[s]));

  function paginate(arr) {
    const total = arr.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const page = clamp(state.page, 1, pages);
    const start = (page - 1) * state.pageSize;
    const end = start + state.pageSize;
    return { page, pages, total, slice: arr.slice(start, end) };
  }

  // ---------- Player ----------
  function loadByIndex(i) {
    if (!RAW.length) return;
    state.index = clamp(i, 0, RAW.length - 1);
    const s = RAW[state.index];

    // Basic info
    if (playerTitle)  playerTitle.textContent  = s.title  || "Now Playing";
    if (playerArtist) playerArtist.textContent = s.artist || "";
    if (playerCover)  playerCover.src          = s.cover  || "https://picsum.photos/seed/cover-fallback/900/900";

    // Spotify iframe
    if (playerFrameWrap) {
      playerFrameWrap.innerHTML = `
        <iframe style="border-radius:12px"
          src="${s.embedSrc || ""}"
          width="100%" height="352" frameborder="0" allowfullscreen=""
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"></iframe>`;
    }

    // Persist last played id
    try { localStorage.setItem(LS_KEYS.lastId, s.id || ""); } catch {}

    // Render lyrics and refresh related (to highlight "Playing")
    renderLyricsFor(s);
    renderRelated();
  }

  function loadById(id) {
    const i = RAW.findIndex((x) => String(x.id) === String(id));
    if (i >= 0) loadByIndex(i);
  }

  function next(step = 1) {
    if (!RAW.length) return;
    const n = RAW.length;
    const nextIdx = (state.index + step + n) % n;
    loadByIndex(nextIdx);
  }

  // ---------- Lyrics ----------
  function renderLyricsFor(song) {
    const L = (song && song.lyrics) ? song.lyrics : null;
    const hasAny = !!(L && (L.roman || L.korean || L.trans));

    if (!lyricsSection) return; // not present

    if (!hasAny) {
      lyricsSection.classList.add("d-none");
      if (lyricRoman)  lyricRoman.textContent  = "";
      if (lyricKorean) lyricKorean.textContent = "";
      if (lyricTrans)  lyricTrans.textContent  = "";
      return;
    }

    if (lyricRoman)  lyricRoman.textContent  = L.roman  || "";
    if (lyricKorean) lyricKorean.textContent = L.korean || "";
    if (lyricTrans)  lyricTrans.textContent  = L.trans  || "";

    lyricsSection.classList.remove("d-none");
  }

  // ---------- Related list ----------
  function applyFilter() {
    const q = (state.q || "").trim().toLowerCase();
    state.filtered = RAW.filter((s) => {
      if (!q) return true;
      return (s.title || "").toLowerCase().includes(q) ||
             (s.artist || "").toLowerCase().includes(q);
    });
    state.page = 1;
    renderRelated();
  }

  function renderRelated() {
    if (!grid) return;
    const { page, pages, total, slice } = paginate(state.filtered);

    if (pageIndicator) pageIndicator.textContent = `Page ${page} / ${pages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= pages;

    if (total === 0) {
      if (emptyState) emptyState.classList.remove("d-none");
      grid.innerHTML = "";
      return;
    } else {
      if (emptyState) emptyState.classList.add("d-none");
    }

    grid.innerHTML = slice.map((s) => {
      const isCurrent = RAW[state.index]?.id === s.id;
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
              <button class="btn btn-outline-primary btn-sm" data-action="play" data-id="${esc(s.id || "")}">
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

    // Bind play buttons
    grid.querySelectorAll("[data-action='play']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (id) loadById(id);
      });
    });
  }

  // ---------- Events ----------
  btnPrev?.addEventListener("click", () => next(-1));
  btnNext?.addEventListener("click", () => next(+1));

  searchInput?.addEventListener("input", () => {
    state.q = searchInput.value || "";
    applyFilter();
  });

  pageSizeSel?.addEventListener("change", () => {
    state.pageSize = parseInt(pageSizeSel.value, 10) || 9;
    state.page = 1;
    renderRelated();
  });

  prevBtn?.addEventListener("click", () => {
    state.page = clamp(state.page - 1, 1, 9999);
    renderRelated();
  });

  nextBtn?.addEventListener("click", () => {
    state.page = state.page + 1;
    renderRelated();
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
  (function init() {
    if (!RAW.length) {
      // No data -> clear UI gracefully
      if (playerTitle)  playerTitle.textContent  = "No songs available";
      if (playerArtist) playerArtist.textContent = "";
      if (playerCover)  playerCover.src = "https://picsum.photos/seed/cover-fallback/900/900";
      if (playerFrameWrap) playerFrameWrap.innerHTML = "";
      renderRelated();
      return;
    }

    const usp = new URLSearchParams(location.search);
    const byId    = usp.get("id");
    const byIndex = usp.get("index");

    if (byId) {
      const i = RAW.findIndex((x) => String(x.id) === String(byId));
      if (i >= 0) loadByIndex(i);
      else loadByIndex(0);
    } else if (byIndex != null) {
      const idx = Number(byIndex);
      if (!Number.isNaN(idx)) loadByIndex(clamp(idx, 0, RAW.length - 1));
      else loadByIndex(0);
    } else {
      // Resume last by id if available
      let done = false;
      try {
        const lastId = localStorage.getItem(LS_KEYS.lastId);
        if (lastId) {
          const i = RAW.findIndex((x) => String(x.id) === String(lastId));
          if (i >= 0) {
            loadByIndex(i);
            done = true;
          }
        }
      } catch {}
      if (!done) loadByIndex(0);
    }

    applyFilter(); // also calls renderRelated()
  })();
})();
