// ======================
// home.js – Auth/session for Home page
// Works with MusicPlayer user.py (JWT)
// ======================

(() => {
  "use strict";

  // -----------------------------
  // API config
  // -----------------------------
  const bodyEl = document.body;
  const OVERRIDE = bodyEl?.getAttribute("data-api-base")?.trim();
  const API_BASE = OVERRIDE || `${location.protocol}//${location.hostname}:8000`;

  const ROUTES = {
    me: `${API_BASE}/api/me`,
    refresh: `${API_BASE}/api/auth/refresh`,
    logout: `${API_BASE}/api/auth/logout`,
  };

  // -----------------------------
  // Storage keys
  // -----------------------------
  const LS = {
    access: "auth.access_token",
    accessExp: "auth.access_expires_at",
    refresh: "auth.refresh_token",
    refreshExp: "auth.refresh_expires_at",
    me: "auth.me",
  };

  // -----------------------------
  // Token utils
  // -----------------------------
  const nowEpoch = () => Math.floor(Date.now() / 1000);

  const getAT = () => localStorage.getItem(LS.access) || "";
  const getATExp = () => parseInt(localStorage.getItem(LS.accessExp) || "0", 10);
  const getRT = () => localStorage.getItem(LS.refresh) || "";
  const getRTExp = () => parseInt(localStorage.getItem(LS.refreshExp) || "0", 10);

  const saveTokens = (data) => {
    localStorage.setItem(LS.access, data.access_token);
    localStorage.setItem(LS.accessExp, String(data.access_expires_at));
    if (data.refresh_token && data.refresh_expires_at) {
      localStorage.setItem(LS.refresh, data.refresh_token);
      localStorage.setItem(LS.refreshExp, String(data.refresh_expires_at));
    }
  };

  const clearTokens = () => {
    localStorage.removeItem(LS.access);
    localStorage.removeItem(LS.accessExp);
    localStorage.removeItem(LS.refresh);
    localStorage.removeItem(LS.refreshExp);
    localStorage.removeItem(LS.me);
  };

  const hasValidAT = () => {
    const at = getAT();
    const exp = getATExp();
    return !!at && exp > nowEpoch() + 15; // 15s leeway
  };

  const hasValidRT = () => {
    const rt = getRT();
    const exp = getRTExp();
    return !!rt && exp > nowEpoch() + 15;
  };

  // -----------------------------
  // Redirect helper (login.html path)
  // -----------------------------
  const LOGIN_URL = bodyEl?.getAttribute("data-login")?.trim() || "login.html";

  const redirectLogin = () => {
    if (sessionStorage.getItem("auth.redirecting") === "1") return;
    sessionStorage.setItem("auth.redirecting", "1");

    const url = new URL(LOGIN_URL, window.location.href);
    url.searchParams.set("from", "home");
    window.location.replace(url.toString());
  };

  // -----------------------------
  // Ensure AT (refresh if needed)
  // -----------------------------
  const ensureAccessToken = async () => {
    if (hasValidAT()) return getAT();

    if (!hasValidRT()) {
      console.warn("[home] no valid refresh token, redirecting to login");
      redirectLogin();
      return "";
    }

    try {
      const resp = await fetch(ROUTES.refresh, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: getRT() }),
      });
      if (!resp.ok) {
        console.warn("[home] refresh failed", resp.status);
        redirectLogin();
        return "";
      }
      const data = await resp.json();
      saveTokens(data);
      return data.access_token;
    } catch (err) {
      console.error("[home] refresh error", err);
      redirectLogin();
      return "";
    }
  };

  // -----------------------------
  // API helpers
  // -----------------------------
  const fetchMe = async (accessToken) => {
    const res = await fetch(ROUTES.me, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("[home] /api/me failed", res.status);
      redirectLogin();
      return null;
    }
    const me = await res.json();
    try {
      localStorage.setItem(LS.me, JSON.stringify(me));
    } catch {}
    return me;
  };

  const onLogout = async () => {
    const at = getAT();
    try {
      if (at) {
        await fetch(ROUTES.logout, {
          method: "POST",
          headers: { Authorization: `Bearer ${at}` },
        });
      }
    } catch {
      // ignore network errors
    }
    clearTokens();
    redirectLogin();
  };

  // -----------------------------
  // UI helpers
  // -----------------------------
  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // Chèn user bar kiểu fixed (tránh phụ thuộc layout header)
  const injectUserBar = (username) => {
    if (document.getElementById("userBar")) return;

    const wrap = document.createElement("div");
    wrap.id = "userBar";
    wrap.setAttribute(
      "style",
      [
        "position:fixed",
        "top:12px",
        "right:12px",
        "z-index:1050",
        "display:flex",
        "gap:8px",
      ].join(";")
    );

    wrap.innerHTML = `
      <button type="button" class="btn btn-outline-light btn-sm" id="userBtn" title="Signed in">
        <span class="me-2">👋</span><strong>${escapeHtml(username || "User")}</strong>
      </button>
      <button type="button" class="btn btn-primary btn-sm" id="logoutBtn" title="Log out">
        Logout
      </button>
    `;

    document.body.appendChild(wrap);

    const logoutBtn = document.getElementById("logoutBtn");
    logoutBtn?.addEventListener("click", onLogout);
  };

  // -----------------------------
  // Init
  // -----------------------------
  const init = async () => {
    // Nếu vô tình load script này trên login.html thì bỏ qua
    if (location.pathname.endsWith("/login.html") || location.pathname.endsWith("login.html")) {
      return;
    }

    // Prefill từ cache để hiện UI ngay (nếu có)
    try {
      const cached = localStorage.getItem(LS.me);
      if (cached && !document.getElementById("userBar")) {
        const meCached = JSON.parse(cached);
        injectUserBar(meCached?.username || meCached?.email || "User");
      }
    } catch {}

    // Đảm bảo token
    const at = await ensureAccessToken();
    if (!at) {
      console.warn("[home] No access token after ensureAccessToken() -> redirecting to login");
      return;
    }

    // Xác nhận / cập nhật thông tin user
    try {
      const me = await fetchMe(at);
      if (!me) {
        console.warn("[home] /api/me returned null (likely 401). Redirected to login.");
        return;
      }
      injectUserBar(me.username || me.email || "User");
      sessionStorage.removeItem("auth.redirecting");
    } catch (e) {
      console.error("[home] fetchMe error:", e);
      redirectLogin();
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();



// ======================
// home.js – Auth/session for Home page + Songs grid (client-side paging)
// Works with MusicPlayer user.py (JWT) & song.py (public GET, JWT for writes)
// ======================

(() => {
  "use strict";

  // -----------------------------
  // API config
  // -----------------------------
  const bodyEl = document.body;
  const OVERRIDE = bodyEl?.getAttribute("data-api-base")?.trim();
  const API_BASE = OVERRIDE || `${location.protocol}//${location.hostname}:8000`;

  // (Tùy chọn) base riêng cho songs API (nếu song.py chạy cổng khác, ví dụ 8002)
  const SONGS_BASE = bodyEl?.getAttribute("data-songs-base")?.trim() || API_BASE;

  const ROUTES = {
    me: `${API_BASE}/api/me`,
    refresh: `${API_BASE}/api/auth/refresh`,
    logout: `${API_BASE}/api/auth/logout`,
    songs: `${SONGS_BASE}/api/songs`,
  };

  // -----------------------------
  // Storage keys
  // -----------------------------
  const LS = {
    access: "auth.access_token",
    accessExp: "auth.access_expires_at",
    refresh: "auth.refresh_token",
    refreshExp: "auth.refresh_expires_at",
    me: "auth.me",
  };

  // -----------------------------
  // Token utils
  // -----------------------------
  const nowEpoch = () => Math.floor(Date.now() / 1000);

  const getAT = () => localStorage.getItem(LS.access) || "";
  const getATExp = () => parseInt(localStorage.getItem(LS.accessExp) || "0", 10);
  const getRT = () => localStorage.getItem(LS.refresh) || "";
  const getRTExp = () => parseInt(localStorage.getItem(LS.refreshExp) || "0", 10);

  const saveTokens = (data) => {
    localStorage.setItem(LS.access, data.access_token);
    localStorage.setItem(LS.accessExp, String(data.access_expires_at));
    if (data.refresh_token && data.refresh_expires_at) {
      localStorage.setItem(LS.refresh, data.refresh_token);
      localStorage.setItem(LS.refreshExp, String(data.refresh_expires_at));
    }
  };

  const clearTokens = () => {
    localStorage.removeItem(LS.access);
    localStorage.removeItem(LS.accessExp);
    localStorage.removeItem(LS.refresh);
    localStorage.removeItem(LS.refreshExp);
    localStorage.removeItem(LS.me);
  };

  const hasValidAT = () => {
    const at = getAT();
    const exp = getATExp();
    return !!at && exp > nowEpoch() + 15; // 15s leeway
  };

  const hasValidRT = () => {
    const rt = getRT();
    const exp = getRTExp();
    return !!rt && exp > nowEpoch() + 15;
  };

  // -----------------------------
  // Redirect helper (login.html path)
  // -----------------------------
  const LOGIN_URL = bodyEl?.getAttribute("data-login")?.trim() || "login.html";

  const redirectLogin = () => {
    if (sessionStorage.getItem("auth.redirecting") === "1") return;
    sessionStorage.setItem("auth.redirecting", "1");

    const url = new URL(LOGIN_URL, window.location.href);
    url.searchParams.set("from", "home");
    window.location.replace(url.toString());
  };

  // -----------------------------
  // Ensure AT (refresh if needed)
  // -----------------------------
  const ensureAccessToken = async () => {
    if (hasValidAT()) return getAT();

    if (!hasValidRT()) {
      console.warn("[home] no valid refresh token, redirecting to login");
      redirectLogin();
      return "";
    }

    try {
      const resp = await fetch(ROUTES.refresh, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: getRT() }),
      });
      if (!resp.ok) {
        console.warn("[home] refresh failed", resp.status);
        redirectLogin();
        return "";
      }
      const data = await resp.json();
      saveTokens(data);
      return data.access_token;
    } catch (err) {
      console.error("[home] refresh error", err);
      redirectLogin();
      return "";
    }
  };

  // -----------------------------
  // API helpers (user)
  // -----------------------------
  const fetchMe = async (accessToken) => {
    const res = await fetch(ROUTES.me, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("[home] /api/me failed", res.status);
      redirectLogin();
      return null;
    }
    const me = await res.json();
    try {
      localStorage.setItem(LS.me, JSON.stringify(me));
    } catch {}
    return me;
  };

  const onLogout = async () => {
    const at = getAT();
    try {
      if (at) {
        await fetch(ROUTES.logout, {
          method: "POST",
          headers: { Authorization: `Bearer ${at}` },
        });
      }
    } catch {
      // ignore network errors
    }
    clearTokens();
    redirectLogin();
  };

  // -----------------------------
  // UI helpers (user bar)
  // -----------------------------
  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const injectUserBar = (username) => {
    if (document.getElementById("userBar")) return;

    const wrap = document.createElement("div");
    wrap.id = "userBar";
    wrap.setAttribute(
      "style",
      [
        "position:fixed",
        "top:12px",
        "right:12px",
        "z-index:1050",
        "display:flex",
        "gap:8px",
      ].join(";")
    );

    wrap.innerHTML = `
      <button type="button" class="btn btn-outline-light btn-sm" id="userBtn" title="Signed in">
        <span class="me-2">👋</span><strong>${escapeHtml(username || "User")}</strong>
      </button>
      <button type="button" class="btn btn-primary btn-sm" id="logoutBtn" title="Log out">
        Logout
      </button>
    `;

    document.body.appendChild(wrap);

    const logoutBtn = document.getElementById("logoutBtn");
    logoutBtn?.addEventListener("click", onLogout);
  };

  // =============================
  // SONGS: load all + client paging
  // =============================
  const $ = (s) => document.querySelector(s);
  const gridEl = $("#henrySongsGrid");
  const emptyEl = $("#hsEmpty");
  const prevBtn = $("#hsPrev");
  const nextBtn = $("#hsNext");
  const pageIndicator = $("#hsPageIndicator");
  const pageSizeSel = $("#pageSize");

  const state = {
    allSongs: [],     // full list from API
    page: 1,
    pageSize: parseInt(pageSizeSel?.value || "9", 10),
  };

  const fmtDuration = (s) => (s && /^\d{2}:\d{2}:\d{2}$/.test(s) ? s : (s || ""));

  const cardHtml = (song) => {
    const title = escapeHtml(song.title || `Song #${song.song_id}`);
    const dur = fmtDuration(song.duration);
    const img =
      song.cover_image_url ||
      song.thumbnail_url ||
      "https://picsum.photos/400/400?blur=2&random=11";

    const preview = song.spotify_preview_url || song.url_file || "";
    const hasPreview = !!preview;

    return `
      <div class="col-12 col-sm-6 col-md-4">
        <div class="card h-100 shadow-sm">
          <img class="card-img-top" src="${escapeHtml(img)}" alt="${title}" onerror="this.src='https://picsum.photos/400/400?blur=2&random=12'">
          <div class="card-body d-flex flex-column">
            <h6 class="card-title mb-1 text-truncate" title="${title}">${title}</h6>
            <div class="text-muted small mb-2">${dur ? `⏱ ${dur}` : ""}</div>
            <div class="mt-auto d-flex gap-2">
              ${hasPreview ? `<a class="btn btn-outline-primary btn-sm" href="${escapeHtml(preview)}" target="_blank" rel="noopener">Preview</a>` : `<button class="btn btn-outline-secondary btn-sm" disabled>No preview</button>`}
              ${song.spotify_track_url ? `<a class="btn btn-outline-dark btn-sm" href="${escapeHtml(song.spotify_track_url)}" target="_blank" rel="noopener">Spotify</a>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const renderGrid = () => {
    const total = state.allSongs.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;

    pageIndicator.textContent = `Page ${state.page} / ${totalPages}`;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;

    if (total === 0) {
      gridEl.innerHTML = "";
      emptyEl.classList.remove("d-none");
      return;
    }
    emptyEl.classList.add("d-none");

    const start = (state.page - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, total);
    const slice = state.allSongs.slice(start, end);

    gridEl.innerHTML = slice.map(cardHtml).join("");
  };

  // Lấy tất cả bài hát bằng cách lặp trang với page_size lớn
  const fetchAllSongs = async () => {
    const PAGE_SIZE = 200; // tải “toàn bộ”, sau đó client tự phân trang
    let page = 1;
    const all = [];

    while (true) {
      const url = new URL(ROUTES.songs);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(PAGE_SIZE));
      // Bạn có thể áp dụng filter ở đây, ví dụ chỉ lấy bài có preview:
      // url.searchParams.set("has_preview", "1");

      const res = await fetch(url.toString(), { method: "GET" });
      if (!res.ok) {
        throw new Error(`/api/songs failed: ${res.status}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      all.push(...rows);
      if (rows.length < PAGE_SIZE) break; // hết trang
      page += 1;
      // tránh spam server
      await new Promise((r) => setTimeout(r, 50));
    }
    return all;
  };

  // Fallback nếu API lỗi: dùng window.__HENRY_SONGS__
  const getFallbackSongs = () => {
    const raw = Array.isArray(window.__HENRY_SONGS__) ? window.__HENRY_SONGS__ : [];
    // Chuẩn hóa field để khớp SongItem
    return raw.map((r, idx) => ({
      song_id: r.SongID || idx + 1,
      title: r.Title || "",
      duration: r.Duration || null,
      url_file: r.URL_File || null,
      cover_image_url: r.CoverImageURL || null,
      thumbnail_url: r.ThumbnailURL || null,
      genre: r.Genre || null,
      language: r.Language || null,
      lyrics: r.Lyrics || null,
      spotify_track_id: r.SpotifyTrackID || null,
      spotify_track_uri: r.SpotifyTrackURI || null,
      spotify_track_url: r.SpotifyTrackURL || null,
      spotify_preview_url: r.Preview || r.SpotifyPreviewURL || null,
    }));
  };

  const initSongs = async () => {
    // Gắn event UI
    pageSizeSel?.addEventListener("change", () => {
      state.pageSize = parseInt(pageSizeSel.value, 10) || 9;
      state.page = 1;
      renderGrid();
    });
    prevBtn?.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderGrid();
      }
    });
    nextBtn?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.allSongs.length / state.pageSize));
      if (state.page < totalPages) {
        state.page += 1;
        renderGrid();
      }
    });

    // Tải toàn bộ bài hát
    try {
      const rows = await fetchAllSongs();
      // Nếu bạn chỉ muốn hiển thị Henry Lau (khi DB đã có nhiều artist),
      // có thể lọc theo tiêu chí riêng (ví dụ: từ khóa trong title, hoặc sau này dùng /singers).
      // Ở đây mình hiển thị toàn bộ rows vì bảng song hiện không có cột artist.
      state.allSongs = rows;
    } catch (e) {
      console.warn("[home] songs API error, fallback to window.__HENRY_SONGS__", e);
      state.allSongs = getFallbackSongs();
    }

    // Sắp xếp mặc định: id_desc (giống API).
    state.allSongs.sort((a, b) => (b.song_id || 0) - (a.song_id || 0));
    renderGrid();
  };

  // -----------------------------
  // Init
  // -----------------------------
  const init = async () => {
    // Nếu vô tình load script này trên login.html thì bỏ qua
    if (location.pathname.endsWith("/login.html") || location.pathname.endsWith("login.html")) {
      return;
    }

    // Prefill từ cache để hiện UI ngay (nếu có)
    try {
      const cached = localStorage.getItem(LS.me);
      if (cached && !document.getElementById("userBar")) {
        const meCached = JSON.parse(cached);
        injectUserBar(meCached?.username || meCached?.email || "User");
      }
    } catch {}

    // Đảm bảo token cho thanh user (GET /api/me)
    const at = await ensureAccessToken();
    if (!at) {
      console.warn("[home] No access token after ensureAccessToken() -> redirecting to login");
      return;
    }

    // Xác nhận / cập nhật thông tin user
    try {
      const me = await fetchMe(at);
      if (!me) {
        console.warn("[home] /api/me returned null (likely 401). Redirected to login.");
        return;
      }
      injectUserBar(me.username || me.email || "User");
      sessionStorage.removeItem("auth.redirecting");
    } catch (e) {
      console.error("[home] fetchMe error:", e);
      redirectLogin();
      return;
    }

    // Sau khi xong auth UI -> tải bài hát & render grid
    await initSongs();
  };

  document.addEventListener("DOMContentLoaded", init);
})();
