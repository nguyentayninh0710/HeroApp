// signup.js — Connect Bootstrap signup form to FastAPI Users API
// Requires user.py endpoints:
//   POST /api/users          -> create account
//   POST /api/auth/login     -> { access_token, access_expires_at, refresh_token, refresh_expires_at }
//   GET  /api/me             -> user profile (Bearer)

(() => {
  "use strict";

  // -----------------------------
  // Config
  // -----------------------------
  const bodyEl = document.body;
  const API_BASE =
    bodyEl?.getAttribute("data-api-base")?.trim() ||
    `${location.protocol}//${location.hostname}:8000`;
  const NEXT_URL = bodyEl?.getAttribute("data-next")?.trim() || "home.html";

  const ROUTES = {
    createUser: `${API_BASE}/api/users`,
    login: `${API_BASE}/api/auth/login`,
    me: `${API_BASE}/api/me`,
  };

  // LocalStorage keys (reuseable with login.js if you have one)
  const LS = {
    access: "auth.access_token",
    accessExp: "auth.access_expires_at",
    refresh: "auth.refresh_token",
    refreshExp: "auth.refresh_expires_at",
    me: "auth.me",
  };

  // -----------------------------
  // Elements
  // -----------------------------
  const form = document.getElementById("signupForm");
  const btn = document.getElementById("signupBtn");
  const btnText = btn?.querySelector(".btn-text");
  const spinner = btn?.querySelector(".spinner-border");

  const usernameEl = document.getElementById("username");
  const emailEl = document.getElementById("email");
  const phoneEl = document.getElementById("phone");
  const passwordEl = document.getElementById("password");
  const repeatEl = document.getElementById("repeatPassword");
  const togglePwd = document.getElementById("togglePwd");
  const toggleRpwd = document.getElementById("toggleRpwd");

  const $ = (s) => document.querySelector(s);

  // -----------------------------
  // UI helpers
  // -----------------------------
  const setLoading = (loading) => {
    if (!btn) return;
    btn.disabled = !!loading;
    if (spinner) spinner.classList.toggle("d-none", !loading);
    if (btnText) btnText.classList.toggle("d-none", !!loading);
  };

  const showToast = (message, type = "danger") => {
    // Minimal inline alert (replace with Bootstrap Toast if you prefer)
    let box = $("#inlineAlert");
    if (!box) {
      box = document.createElement("div");
      box.id = "inlineAlert";
      box.className = "alert mt-3";
      form.appendChild(box);
    }
    box.className = `alert alert-${type} mt-3`;
    box.textContent = message;
  };

  const clearToast = () => {
    const box = $("#inlineAlert");
    if (box) box.remove();
  };

  // -----------------------------
  // Password visibility toggles
  // -----------------------------
  const makeToggler = (btnEl, inputEl) => {
    if (!btnEl || !inputEl) return;
    btnEl.addEventListener("click", () => {
      const isHidden = inputEl.getAttribute("type") === "password";
      inputEl.setAttribute("type", isHidden ? "text" : "password");
      btnEl.innerHTML = `<i class="bi ${isHidden ? "bi-eye-slash" : "bi-eye"}"></i>`;
      btnEl.setAttribute(
        "aria-label",
        isHidden ? "Hide password" : "Show password"
      );
    });
  };
  makeToggler(togglePwd, passwordEl);
  makeToggler(toggleRpwd, repeatEl);

  // -----------------------------
  // Validation helpers
  // -----------------------------
  const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
  const EMAIL_RE =
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const PHONE_RE = /^[0-9]{8,15}$/; // optional

  const validate = () => {
    clearToast();
    let ok = true;

    const u = usernameEl.value.trim();
    if (!USERNAME_RE.test(u)) {
      usernameEl.classList.add("is-invalid");
      ok = false;
    } else {
      usernameEl.classList.remove("is-invalid");
    }

    const e = emailEl.value.trim();
    if (e && !EMAIL_RE.test(e)) {
      emailEl.classList.add("is-invalid");
      ok = false;
    } else {
      emailEl.classList.remove("is-invalid");
    }

    const p = phoneEl?.value.trim();
    if (p && !PHONE_RE.test(p)) {
      phoneEl.classList.add("is-invalid");
      ok = false;
    } else if (phoneEl) {
      phoneEl.classList.remove("is-invalid");
    }

    const pw = passwordEl.value;
    const rp = repeatEl.value;
    if (!pw || pw.length < 8) {
      passwordEl.classList.add("is-invalid");
      ok = false;
    } else {
      passwordEl.classList.remove("is-invalid");
    }
    if (rp !== pw || rp.length < 8) {
      repeatEl.classList.add("is-invalid");
      ok = false;
    } else {
      repeatEl.classList.remove("is-invalid");
    }

    if (!ok) showToast("Please check your inputs.", "warning");
    return ok;
  };

  // -----------------------------
  // Fetch helpers
  // -----------------------------
  const postJSON = async (url, data, headers = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
    const isJSON = res.headers
      .get("content-type")
      ?.includes("application/json");
    const payload = isJSON ? await res.json() : {};
    if (!res.ok) {
      const msg =
        payload?.detail ||
        payload?.message ||
        `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return payload;
  };

  const getJSON = async (url, headers = {}) => {
    const res = await fetch(url, { headers });
    const payload = await res.json();
    if (!res.ok) {
      const msg =
        payload?.detail ||
        payload?.message ||
        `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return payload;
  };

  // -----------------------------
  // Auto-login after signup
  // -----------------------------
  const doAutoLogin = async (identifier, password) => {
    const tokens = await postJSON(ROUTES.login, {
      identifier,
      password,
    });
    localStorage.setItem(LS.access, tokens.access_token);
    localStorage.setItem(LS.accessExp, String(tokens.access_expires_at));
    localStorage.setItem(LS.refresh, tokens.refresh_token);
    localStorage.setItem(LS.refreshExp, String(tokens.refresh_expires_at));

    // load /api/me
    const me = await getJSON(ROUTES.me, {
      Authorization: `Bearer ${tokens.access_token}`,
    });
    localStorage.setItem(LS.me, JSON.stringify(me));
  };

  // -----------------------------
  // Submit handler
  // -----------------------------
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    if (!validate()) return;

    setLoading(true);

    try {
      // Build payload for POST /api/users
      const payload = {
        username: usernameEl.value.trim(),
        email: emailEl.value.trim() || null, // optional
        phone: phoneEl?.value.trim() || null, // optional
        password: passwordEl.value, // server will hash to PasswordHash
      };

      // Create user
      const created = await postJSON(ROUTES.createUser, payload);

      // Auto-login using email if present, otherwise username
      const identifier = payload.email || payload.username;
      await doAutoLogin(identifier, payload.password);

      showToast(`Welcome, ${created.username}! Redirecting…`, "success");
      setTimeout(() => window.location.assign(NEXT_URL), 600);
    } catch (err) {
      showToast(err?.message || "Signup failed.", "danger");
    } finally {
      setLoading(false);
    }
  });
})();
