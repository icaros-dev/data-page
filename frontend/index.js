// Quem já entrou vai direto para o painel.
if (getToken()) location.replace("painel.html");

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authForm = document.getElementById("authForm");
const nameField = document.getElementById("nameField");
const authButton = document.getElementById("authButton");
const authStatus = document.getElementById("authStatus");
const passwordInput = document.getElementById("password");

let mode = "login";

function setMode(next) {
  mode = next;
  const isRegister = mode === "register";
  tabLogin.classList.toggle("active", !isRegister);
  tabRegister.classList.toggle("active", isRegister);
  tabLogin.setAttribute("aria-selected", String(!isRegister));
  tabRegister.setAttribute("aria-selected", String(isRegister));
  nameField.classList.toggle("hidden", !isRegister);
  passwordInput.autocomplete = isRegister ? "new-password" : "current-password";
  authButton.textContent = isRegister ? "Criar conta e gerar meu link" : "Entrar";
  hideStatus(authStatus);
}

tabLogin.addEventListener("click", () => setMode("login"));
tabRegister.addEventListener("click", () => setMode("register"));

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  const body = {
    instagram: document.getElementById("instagram").value,
    password: passwordInput.value
  };
  if (mode === "register") body.name = document.getElementById("name").value;

  authButton.disabled = true;
  showStatus(authStatus, "Conectando...");
  const slowTimer = setTimeout(() => {
    showStatus(authStatus, "O servidor está acordando, isso pode levar até 1 minuto na primeira vez. Aguarde...");
  }, 5000);

  try {
    const data = await api(mode === "register" ? "/api/auth/register" : "/api/auth/login",
      { method: "POST", body });
    saveSession(data.token, data.user);
    location.href = "painel.html";
  } catch (error) {
    showStatus(authStatus, error.message, true);
  } finally {
    clearTimeout(slowTimer);
    authButton.disabled = false;
  }
});
