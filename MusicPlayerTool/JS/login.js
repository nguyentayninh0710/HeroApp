// ======================
// Login page controller
// Works with MusicPlayer user.py (JWT)
// Endpoints used:
//   POST /api/auth/login   -> { access_token, access_expires_at, refresh_token, refresh_expires_at }
//   GET  /api/me           -> requires Bearer
//   POST /api/auth/logout  -> requires Bearer
// ======================

(() => {
  "use strict";

  // -----------------------------
  // Password visibility
  // -----------------------------
  const togglePwD = document.getElementById("togglePwd");
  const toggleRpwd = document.getElementById("toggleRpwd"); // not on login page, but guard
  const pwd = document.getElementById("password");
  const Rpwd = document.getElementById("repeatPassword");

  if (togglePwD && pwd) {
    const setPwdVisible = (visible) => {
      const type = visible ? "text" : "password";
      pwd.setAttribute("type", type);
      togglePwD.innerHTML = `<i class="bi ${visible ? "bi-eye-slash" : "bi-eye"}"></i>`;
      togglePwD.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      togglePwD.setAttribute("aria-pressed", String(visible));
    };
    togglePwD.addEventListener("click", () => {
      const isHidden = pwd.getAttribute("type") === "password";
      setPwdVisible(isHidden);
    });
    setPwdVisible(false);
  }

  if (toggleRpwd && Rpwd) {
    const setPwdVisible = (visible) => {
      const type = visible ? "text" : "password";
      Rpwd.setAttribute("type", type);
      toggleRpwd.innerHTML = `<i class="bi ${visible ? "bi-eye-slash" : "bi-eye"}"></i>`;
      toggleRpwd.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      toggleRpwd.setAttribute("aria-pressed", String(visible));
    };
    toggleRpwd.addEventListener("click", () => {
      const isHidden = Rpwd.getAttribute("type") === "password";
      setPwdVisible(isHidden);
    });
    setPwdVisible(false);
  }

  // -----------------------------
  // API config
  // -----------------------------
  const bodyEl = document.body;
  const OVERRIDE = bodyEl?.getAttribute("data-api-base")?.trim();
  // Backend MusicPlayer mặc định chạy 8000 theo user.py
  const API_BASE = OVERRIDE || `${location.protocol}//${location.hostname}:8000`;

  const ROUTES = {
    login: `${API_BASE}/api/auth/login`,
    me: `${API_BASE}/api/me`,
    logout: `${API_BASE}/api/auth/logout`,
  };

  // -----------------------------
  // Elements
  // -----------------------------
  const form = document.getElementById("loginForm");
  const usernameEl = document.getElementById("username");
  const passwordEl = document.getElementById("password");
  const rememberEl = document.getElementById("remember");
  const loginBtn = document.getElementById("loginBtn");
  const btnText = loginBtn?.querySelector(".btn-text");
  const spinner = loginBtn?.querySelector(".spinner-border");

  let alertBox = document.getElementById("loginAlert");
  if (!alertBox) {
    alertBox = document.createElement("div");
    alertBox.id = "loginAlert";
    alertBox.className = "alert alert-danger d-none mt-3";
    form?.appendChild(alertBox);
  }
  const showError = (msg) => {
    alertBox.textContent = msg || "Login failed.";
    alertBox.classList.remove("d-none");
  };
  const hideError = () => {
    alertBox.classList.add("d-none");
    alertBox.textContent = "";
  };

  // -----------------------------
  // Token storage helpers
  // -----------------------------
  const LS = {
    access: "auth.access_token",
    accessExp: "auth.access_expires_at",
    refresh: "auth.refresh_token",
    refreshExp: "auth.refresh_expires_at",
    me: "auth.me",
  };

  const saveTokens = (data, persistRefresh) => {
    localStorage.setItem(LS.access, data.access_token);
    localStorage.setItem(LS.accessExp, String(data.access_expires_at));
    if (persistRefresh) {
      localStorage.setItem(LS.refresh, data.refresh_token);
      localStorage.setItem(LS.refreshExp, String(data.refresh_expires_at));
    } else {
      localStorage.removeItem(LS.refresh);
      localStorage.removeItem(LS.refreshExp);
    }
  };

  const saveMe = (me) => {
    try {
      localStorage.setItem(LS.me, JSON.stringify(me));
    } catch {}
  };

  const setLoading = (loading) => {
    if (!loginBtn) return;
    loginBtn.disabled = loading;
    if (spinner) spinner.classList.toggle("d-none", !loading);
    if (btnText) btnText.style.opacity = loading ? "0.7" : "1";
  };

  // -----------------------------
  // Client-side validation
  // -----------------------------
  const validate = () => {
    hideError();

    const username = (usernameEl?.value || "").trim();
    const password = (passwordEl?.value || "").trim();

    // Match (username: [A-Za-z0-9_] 3..30, password >= 8)
    const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

    let ok = true;

    if (!username || !USERNAME_RE.test(username)) {
      usernameEl?.classList.add("is-invalid");
      ok = false;
    } else {
      usernameEl?.classList.remove("is-invalid");
    }

    if (!password || password.length < 8) {
      passwordEl?.classList.add("is-invalid");
      ok = false;
    } else {
      passwordEl?.classList.remove("is-invalid");
    }

    return ok ? { username, password } : null;
  };

  // -----------------------------
  // Submit
  // -----------------------------
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = validate();
      if (!v) return;

      const { username, password } = v;
      setLoading(true);

      try {
        const payload = { identifier: username, password };

        const res = await fetch(ROUTES.login, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          let detail = "Invalid credentials";
          try {
            const err = await res.json();
            if (err?.detail) detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
          } catch {}
          showError(detail);
          return;
        }

        const data = await res.json();
        // remember me -> quyết định có lưu refresh token hay không
        const persistRefresh = !!(rememberEl && rememberEl.checked);
        saveTokens(data, persistRefresh);

        // gọi /api/me để lấy profile
        try {
          const meRes = await fetch(ROUTES.me, {
            headers: { Authorization: `Bearer ${data.access_token}` },
          });
          if (meRes.ok) {
            const me = await meRes.json();
            saveMe(me);
          }
        } catch {}

        hideError();

        // Redirect sau khi login thành công
        const nextUrl = document.body?.getAttribute("data-next")?.trim() || "home.html";
        window.location.assign(nextUrl);

      } catch (err) {
        console.error(err);
        showError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    });
  }

  // Enter to submit
  [usernameEl, passwordEl].forEach((el) => {
    el?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") form?.requestSubmit();
    });
  });
})();
