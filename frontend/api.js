// Endereço do backend publicado no Render.
const PRODUCTION_API_URL = "https://data-page-pesquisa-api.onrender.com";

// No seu computador usa o servidor local; publicado, usa o de produção.
const isLocal = location.protocol === "file:" ||
  ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = isLocal ? "http://localhost:3000" : PRODUCTION_API_URL;

// O servidor gratuito do Render "dorme" sem uso. Acorda ele assim que a página abre.
fetch(`${API_BASE}/`, { cache: "no-store" }).catch(() => {});

const TOKEN_KEY = "datapage_token";
const USER_KEY = "datapage_user";

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* navegador sem armazenamento */ }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* idem */ }
}

function saveSession(token, user) {
  storageSet(TOKEN_KEY, token);
  storageSet(USER_KEY, JSON.stringify(user));
}
function getToken() { return storageGet(TOKEN_KEY); }
function getUser() {
  try { return JSON.parse(storageGet(USER_KEY)); } catch { return null; }
}
function clearSession() {
  storageRemove(TOKEN_KEY);
  storageRemove(USER_KEY);
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) headers.Authorization = `Bearer ${getToken()}`;

  // Desiste depois de 70 s (o Render gratuito pode levar ~1 min para acordar).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal
    });
  } catch (error) {
    throw new Error(error.name === "AbortError"
      ? "O servidor demorou para responder. Tente novamente em instantes."
      : "Sem conexão com o servidor. Verifique sua internet e tente de novo.");
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && auth) {
    clearSession();
    location.href = "index.html";
  }
  if (!response.ok) throw new Error(data.error || "Algo deu errado. Tente novamente.");
  return data;
}

// Endereço público da página de resposta (mesma pasta deste site).
function surveyLink(slug, origin) {
  const url = new URL("responder.html", location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("p", slug);
  if (origin) url.searchParams.set("origem", origin);
  return url.toString();
}

function showStatus(el, message, error = false) {
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", error);
}
function hideStatus(el) { el.classList.add("hidden"); }
