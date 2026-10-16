const ORIGINS = [
  ["whatsapp", "WhatsApp"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["telegram", "Telegram"],
  ["tiktok", "TikTok"],
  ["outro", "Outro"]
];
const KNOWN_ORIGINS = [...ORIGINS.map(([key]) => key), "x"];

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const slug = params.get("p") || "";
const originParam = (params.get("origem") || "").toLowerCase();
const loadStatus = $("loadStatus");
const voteForm = $("voteForm");
const voteStatus = $("voteStatus");

const VOTED_KEY = `datapage_voted_${slug}`;

// Identificador aleatório deste aparelho (não contém dados pessoais).
function deviceId() {
  let id = storageGet("datapage_device");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    storageSet("datapage_device", id);
  }
  return id;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(c => c != null));
  return node;
}

function showThanks(title) {
  voteForm.classList.add("hidden");
  loadStatus.classList.add("hidden");
  $("thanks").classList.remove("hidden");
  const link = surveyLink(slug, "whatsapp");
  $("thanksWhatsapp").href = `https://wa.me/?text=${encodeURIComponent(`📊 ${title || "Pesquisa"}\nParticipe você também:\n${link}`)}`;
  $("thanksCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(surveyLink(slug));
      $("thanksCopy").textContent = "Copiado ✓";
    } catch {
      window.prompt("Copie o link:", surveyLink(slug));
    }
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function load() {
  if (!slug) {
    showStatus(loadStatus, "Link incompleto. Peça o link correto a quem enviou a pesquisa.", true);
    return;
  }
  const slowTimer = setTimeout(() => {
    showStatus(loadStatus, "Carregando... o servidor está acordando, isso pode levar até 1 minuto.");
  }, 5000);

  try {
    const { survey } = await api(`/api/public/surveys/${encodeURIComponent(slug)}`);
    document.title = `${survey.title} · Data Page`;
    if (storageGet(VOTED_KEY)) return showThanks(survey.title);
    if (!survey.open) {
      showStatus(loadStatus, "Esta pesquisa já foi encerrada. Obrigado pelo interesse!", true);
      return;
    }
    render(survey);
  } catch (error) {
    showStatus(loadStatus, error.message, true);
  } finally {
    clearTimeout(slowTimer);
  }
}

function render(survey) {
  $("surveyOwner").textContent = survey.owner ? `PESQUISA DE @${survey.owner.toUpperCase()}` : "PESQUISA";
  $("surveyTitle").textContent = survey.title;
  $("surveyCity").textContent = survey.city || "";
  $("surveyDescription").textContent = survey.description || "";

  $("questionList").replaceChildren(...survey.questions.map((q, i) => el("section", { class: "card" },
    el("p", { class: "q-title" }, `${i + 1}. ${q.text}`),
    el("div", { class: "choice-grid" }, q.options.map(o => el("label", { class: "choice" },
      el("input", { type: "radio", name: q.id, value: o.id }),
      el("span", {}, el("strong", {}, o.label))
    )))
  )));

  $("neighborhoodSection").classList.toggle("hidden", !survey.askNeighborhood);

  // Se o link já veio com a rede (ex.: botão do WhatsApp no painel), não precisa perguntar.
  if (!KNOWN_ORIGINS.includes(originParam)) {
    $("originSection").classList.remove("hidden");
    $("originChoices").replaceChildren(...ORIGINS.map(([key, label]) => el("label", { class: "choice" },
      el("input", { type: "radio", name: "origin", value: key }),
      el("span", {}, el("strong", {}, label))
    )));
  }

  loadStatus.classList.add("hidden");
  voteForm.classList.remove("hidden");
  voteForm.dataset.title = survey.title;
  voteForm.dataset.questions = JSON.stringify(survey.questions.map(q => q.id));
}

voteForm.addEventListener("change", event => {
  if (event.target.name === "identify") {
    $("identityFields").classList.toggle("hidden", event.target.value !== "yes");
  }
});

voteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const questionIds = JSON.parse(voteForm.dataset.questions || "[]");
  const answers = {};
  for (const [i, id] of questionIds.entries()) {
    const chosen = voteForm.querySelector(`input[name="${id}"]:checked`);
    if (!chosen) return showStatus(voteStatus, `Escolha uma opção na pergunta ${i + 1}.`, true);
    answers[id] = chosen.value;
  }

  const identify = voteForm.querySelector('input[name="identify"]:checked').value === "yes";
  const name = $("voterName").value.trim();
  if (identify && !name) return showStatus(voteStatus, "Escreva seu nome ou escolha responder como anônimo.", true);
  if (identify && !$("consent").checked) {
    return showStatus(voteStatus, "Para enviar com seu nome, marque a autorização.", true);
  }

  const origin = KNOWN_ORIGINS.includes(originParam) ? originParam
    : voteForm.querySelector('input[name="origin"]:checked')?.value || "outro";

  const button = $("submitButton");
  button.disabled = true;
  button.textContent = "Enviando...";
  showStatus(voteStatus, "Enviando sua resposta...");
  try {
    await api(`/api/public/surveys/${encodeURIComponent(slug)}/votes`, {
      method: "POST",
      body: {
        deviceId: deviceId(),
        answers,
        identify,
        name: identify ? name : "",
        consent: identify && $("consent").checked,
        origin,
        neighborhood: $("neighborhood").value
      }
    });
    storageSet(VOTED_KEY, "1");
    showThanks(voteForm.dataset.title);
  } catch (error) {
    showStatus(voteStatus, error.message, true);
    if (/já respondeu/.test(error.message)) storageSet(VOTED_KEY, "1");
  } finally {
    button.disabled = false;
    button.textContent = "Enviar minha resposta";
  }
});

load();
