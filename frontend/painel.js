if (!getToken()) location.replace("index.html");

const ORIGIN_LABELS = {
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
  telegram: "Telegram",
  x: "X (Twitter)",
  tiktok: "TikTok",
  outro: "Outro / não informado"
};
const MAX_QUESTIONS = 5;

// Modelo padrão: 2º turno da eleição presidencial de 2026.
const PRESIDENTIAL_TEMPLATE = {
  title: "Presidente 2026 · 2º turno",
  city: "Brasil",
  description: "Pesquisa rápida: leva menos de 1 minuto e você pode responder sem se identificar.",
  questions: [
    {
      text: "Se o 2º turno fosse hoje, em quem você votaria para presidente?",
      options: "Lula (PT)\nFlávio Bolsonaro (PL)",
      shuffle: true
    },
    {
      text: "O seu voto já está decidido?",
      options: "Sim, já está decidido\nAinda posso mudar",
      undecided: false,
      blank: false
    },
    {
      text: "Qual tema mais pesa no seu voto para presidente?",
      options: "Economia e emprego\nSaúde\nSegurança pública\nEducação\nCombate à corrupção\nProgramas sociais\nOutro",
      undecided: false,
      blank: false
    }
  ]
};

const $ = id => document.getElementById(id);
const listSection = $("listSection");
const formSection = $("formSection");
const resultsSection = $("resultsSection");
const surveyList = $("surveyList");
const listStatus = $("listStatus");
const questionsBox = $("questions");
const questionTemplate = $("questionTemplate");
const surveyForm = $("surveyForm");
const formStatus = $("formStatus");

let currentResults = null;

// Cria elementos sem usar innerHTML com texto digitado por outras pessoas.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

function showView(view) {
  listSection.classList.toggle("hidden", view !== "list");
  formSection.classList.toggle("hidden", view !== "form");
  resultsSection.classList.toggle("hidden", view !== "results");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Cabeçalho ----------

const user = getUser();
$("userHandle").textContent = user ? `@${user.instagram}` : "@";
$("logoutButton").addEventListener("click", () => {
  clearSession();
  location.href = "index.html";
});

// ---------- Lista ----------

async function loadSurveys() {
  showStatus(listStatus, "Carregando suas pesquisas...");
  try {
    const { surveys } = await api("/api/surveys", { auth: true });
    hideStatus(listStatus);
    renderSurveys(surveys);
  } catch (error) {
    showStatus(listStatus, error.message, true);
  }
}

function shareMessage(survey) {
  return `📊 ${survey.title}\nParticipe da nossa pesquisa! Você pode responder sem se identificar. Leva menos de 1 minuto:`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copie o link:", text);
    return;
  }
  const original = button.textContent;
  button.textContent = "Copiado ✓";
  setTimeout(() => { button.textContent = original; }, 1800);
}

function shareButtons(survey) {
  const msg = shareMessage(survey);
  const link = origin => surveyLink(survey.slug, origin);
  const open = url => () => window.open(url, "_blank", "noopener");

  const instagramButton = el("button", { class: "share-btn instagram", type: "button" }, "Instagram");
  instagramButton.addEventListener("click", () => {
    copyText(link("instagram"), instagramButton);
    alert("Link do Instagram copiado! Cole no Direct, nos grupos, na bio ou no adesivo de link dos Stories.");
  });

  const copyButton = el("button", { class: "share-btn copy", type: "button" }, "Copiar link");
  copyButton.addEventListener("click", () => copyText(link(), copyButton));

  const buttons = [
    el("button", {
      class: "share-btn whatsapp", type: "button",
      onclick: open(`https://wa.me/?text=${encodeURIComponent(`${msg}\n${link("whatsapp")}`)}`)
    }, "WhatsApp"),
    el("button", {
      class: "share-btn facebook", type: "button",
      onclick: open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link("facebook"))}`)
    }, "Facebook"),
    instagramButton,
    el("button", {
      class: "share-btn telegram", type: "button",
      onclick: open(`https://t.me/share/url?url=${encodeURIComponent(link("telegram"))}&text=${encodeURIComponent(msg)}`)
    }, "Telegram"),
    el("button", {
      class: "share-btn x", type: "button",
      onclick: open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(link("x"))}`)
    }, "X"),
    copyButton
  ];

  // No celular, abre a lista de apps do próprio aparelho (TikTok, Messenger etc.).
  if (navigator.share) {
    buttons.push(el("button", {
      class: "share-btn more", type: "button",
      onclick: () => navigator.share({ title: survey.title, text: msg, url: link() }).catch(() => {})
    }, "Mais…"));
  }
  return el("div", { class: "share-row" }, buttons);
}

function renderSurveys(surveys) {
  surveyList.replaceChildren();
  $("emptyState").classList.toggle("hidden", surveys.length > 0);

  for (const survey of surveys) {
    const statusTag = el("span", { class: `tag ${survey.open ? "open" : "closed"}` },
      survey.open ? "Aberta" : "Encerrada");

    const toggleButton = el("button", { class: "secondary-btn small", type: "button" },
      survey.open ? "Encerrar" : "Reabrir");
    toggleButton.addEventListener("click", async () => {
      toggleButton.disabled = true;
      try {
        await api(`/api/surveys/${survey.slug}`, { method: "PATCH", auth: true, body: { open: !survey.open } });
        loadSurveys();
      } catch (error) {
        alert(error.message);
        toggleButton.disabled = false;
      }
    });

    const deleteButton = el("button", { class: "link-btn danger", type: "button" }, "Excluir");
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Excluir “${survey.title}” e todas as ${survey.total} respostas? Isso não pode ser desfeito.`)) return;
      try {
        await api(`/api/surveys/${survey.slug}`, { method: "DELETE", auth: true });
        loadSurveys();
      } catch (error) {
        alert(error.message);
      }
    });

    const linkInput = el("input", { class: "link-input", type: "text", readonly: "", value: surveyLink(survey.slug) });
    linkInput.addEventListener("focus", () => linkInput.select());

    surveyList.append(el("article", { class: "card survey-card" },
      el("div", { class: "survey-top" },
        el("div", {},
          el("h3", {}, survey.title),
          el("p", { class: "muted" },
            [survey.city, `${survey.questions.length} pergunta(s)`, new Date(survey.createdAt).toLocaleDateString("pt-BR")]
              .filter(Boolean).join(" · "))
        ),
        el("div", { class: "survey-count" }, el("strong", {}, String(survey.total)), el("span", {}, "respostas"))
      ),
      el("div", { class: "survey-tags" }, statusTag),
      el("p", { class: "mini-label" }, "LINK DA PESQUISA"),
      linkInput,
      el("p", { class: "mini-label" }, "ENVIAR PARA OS GRUPOS"),
      shareButtons(survey),
      el("div", { class: "survey-actions" },
        el("button", { class: "primary-btn small", type: "button", onclick: () => openResults(survey.slug) }, "Ver resultados"),
        toggleButton,
        deleteButton
      )
    ));
  }
}

// ---------- Nova pesquisa ----------

function addQuestion({ text = "", options = "", undecided = true, blank = true, shuffle = false } = {}) {
  if (questionsBox.children.length >= MAX_QUESTIONS) return;
  const node = questionTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".q-text").value = text;
  node.querySelector(".q-options").value = options;
  node.querySelector(".q-undecided").checked = undecided;
  node.querySelector(".q-blank").checked = blank;
  node.querySelector(".q-shuffle").checked = shuffle;
  node.querySelector(".remove-question").addEventListener("click", () => {
    node.remove();
    renumberQuestions();
  });
  questionsBox.append(node);
  renumberQuestions();
}

function renumberQuestions() {
  const boxes = [...questionsBox.children];
  boxes.forEach((box, i) => {
    box.querySelector(".q-number").textContent = i + 1;
    box.querySelector(".remove-question").classList.toggle("hidden", boxes.length === 1);
  });
  $("addQuestionButton").classList.toggle("hidden", boxes.length >= MAX_QUESTIONS);
}

function openForm(template = PRESIDENTIAL_TEMPLATE) {
  surveyForm.reset();
  $("surveyTitle").value = template.title || "";
  $("surveyCity").value = template.city || "";
  $("surveyDescription").value = template.description || "";
  questionsBox.replaceChildren();
  for (const q of template.questions) addQuestion(q);
  hideStatus(formStatus);
  showView("form");
}

$("newSurveyButton").addEventListener("click", () => openForm());
$("emptyNewButton").addEventListener("click", () => openForm());
$("blankFormButton").addEventListener("click", () => openForm({ questions: [{}] }));
$("cancelFormButton").addEventListener("click", () => showView("list"));
$("addQuestionButton").addEventListener("click", () => addQuestion());

surveyForm.addEventListener("submit", async event => {
  event.preventDefault();
  const body = {
    title: $("surveyTitle").value,
    city: $("surveyCity").value,
    description: $("surveyDescription").value,
    askNeighborhood: $("askNeighborhood").checked,
    questions: [...questionsBox.children].map(box => ({
      text: box.querySelector(".q-text").value,
      options: box.querySelector(".q-options").value.split("\n"),
      includeUndecided: box.querySelector(".q-undecided").checked,
      includeBlank: box.querySelector(".q-blank").checked,
      shuffle: box.querySelector(".q-shuffle").checked
    }))
  };

  const button = $("saveSurveyButton");
  button.disabled = true;
  showStatus(formStatus, "Criando a pesquisa...");
  try {
    await api("/api/surveys", { method: "POST", auth: true, body });
    showView("list");
    await loadSurveys();
  } catch (error) {
    showStatus(formStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

// ---------- Resultados ----------

function bar(label, value, percent, highlight = false) {
  return el("div", { class: `bar-row${highlight ? " leader" : ""}` },
    el("div", { class: "bar-label" },
      el("span", {}, label),
      el("strong", {}, `${percent.toFixed(1).replace(".", ",")}% · ${value}`)
    ),
    el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${percent}%` }))
  );
}

async function openResults(slug) {
  showView("results");
  $("resultsTitle").textContent = "Carregando...";
  $("resultsMeta").textContent = "";
  try {
    currentResults = await api(`/api/surveys/${slug}/results`, { auth: true });
    renderResults(currentResults);
  } catch (error) {
    $("resultsTitle").textContent = error.message;
  }
}

function renderResults(data) {
  const { survey } = data;
  $("resultsTitle").textContent = survey.title;
  $("resultsMeta").textContent = [survey.city, survey.open ? "Aberta" : "Encerrada",
    `atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`]
    .filter(Boolean).join(" · ");
  $("kpiTotal").textContent = data.total;
  $("kpiIdentified").textContent = data.identified;
  $("kpiAnonymous").textContent = data.total - data.identified;

  $("questionResults").replaceChildren(...data.questions.map(q => {
    const max = Math.max(...q.options.map(o => o.votes));
    const sorted = [...q.options].sort((a, b) => b.votes - a.votes);
    const candidates = q.options.filter(o => !o.extra).sort((a, b) => b.votes - a.votes);
    const showValid = q.valid > 0 && candidates.length < q.options.length;
    return el("div", { class: "question-result" },
      el("h3", {}, q.text),
      el("p", { class: "muted" }, `${q.answered} resposta(s)`),
      el("div", { class: "bars" }, sorted.map(o => bar(o.label, o.votes, o.percent, max > 0 && o.votes === max))),
      showValid ? el("div", { class: "valid-box" },
        el("p", { class: "mini-label" }, `VOTOS VÁLIDOS · ${q.valid} (sem brancos, nulos e indecisos)`),
        el("div", { class: "bars" }, candidates.map(o =>
          bar(o.label, o.votes, o.validPercent, o.votes === candidates[0].votes)))
      ) : null
    );
  }));

  const originEntries = Object.entries(data.byOrigin).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  $("originResults").replaceChildren(...(originEntries.length
    ? originEntries.map(([key, n]) => bar(ORIGIN_LABELS[key] || key, n, n / data.total * 100))
    : [el("p", { class: "muted" }, "Sem respostas ainda.")]));

  $("neighborhoodBox").classList.toggle("hidden", !survey.askNeighborhood);
  $("neighborhoodResults").replaceChildren(...(data.byNeighborhood.length
    ? data.byNeighborhood.slice(0, 15).map(b => bar(b.name, b.total, b.total / data.total * 100))
    : [el("p", { class: "muted" }, "Nenhum bairro informado.")]));

  const answerLabel = (q, optionId) => q.options.find(o => o.id === optionId)?.label || "—";
  const identified = data.responses.filter(r => r.name);
  $("identifiedEmpty").classList.toggle("hidden", identified.length > 0);
  $("identifiedHead").replaceChildren(identified.length ? el("tr", {},
    el("th", {}, "Nome"),
    data.questions.map((q, i) => el("th", { title: q.text }, `P${i + 1}`)),
    el("th", {}, "Rede"),
    survey.askNeighborhood ? el("th", {}, "Bairro") : null,
    el("th", {}, "Data")
  ) : "");
  $("identifiedBody").replaceChildren(...identified.map(r => el("tr", {},
    el("td", {}, r.name),
    data.questions.map(q => el("td", {}, answerLabel(q, r.answers[q.id]))),
    el("td", {}, ORIGIN_LABELS[r.origin] || r.origin),
    survey.askNeighborhood ? el("td", {}, r.neighborhood || "—") : null,
    el("td", {}, new Date(r.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))
  )));
}

$("backButton").addEventListener("click", () => {
  showView("list");
  loadSurveys();
});
$("refreshButton").addEventListener("click", () => currentResults && openResults(currentResults.survey.slug));

$("csvButton").addEventListener("click", () => {
  if (!currentResults) return;
  const { survey, questions, responses } = currentResults;
  const cell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["Data", "Nome", "Rede", ...(survey.askNeighborhood ? ["Bairro"] : []), ...questions.map(q => q.text)];
  const rows = responses.map(r => [
    new Date(r.createdAt).toLocaleString("pt-BR"),
    r.name || "Anônimo",
    ORIGIN_LABELS[r.origin] || r.origin,
    ...(survey.askNeighborhood ? [r.neighborhood || ""] : []),
    ...questions.map(q => q.options.find(o => o.id === r.answers[q.id])?.label || "")
  ]);
  // Ponto e vírgula + BOM: abre certinho no Excel em português.
  const csv = "﻿" + [header, ...rows].map(row => row.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `pesquisa-${survey.slug}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

loadSurveys();
