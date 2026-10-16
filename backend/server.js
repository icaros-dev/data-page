import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createStore, storeKind } from "./store.js";

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_SECRET = process.env.AUTH_SECRET || "";
if (!AUTH_SECRET) {
  console.warn("AVISO: AUTH_SECRET não definido. Usando uma chave temporária (os logins caem a cada reinício).");
}
const SECRET = AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_DAYS = 30;

// Por onde o link da pesquisa chegou até a pessoa.
const ORIGINS = ["whatsapp", "facebook", "instagram", "telegram", "x", "tiktok", "outro"];

const MAX_QUESTIONS = 5;
const MAX_OPTIONS = 15;

const store = await createStore();

// Em hospedagens como o Render, o IP real do usuário vem do proxy.
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json({ limit: "50kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }
});

const voteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.VOTE_LIMIT_PER_HOUR) || 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas respostas enviadas desta conexão. Tente mais tarde." }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Data Page - Pesquisa Eleitoral Interna API", storage: storeKind });
});

// ---------- Utilidades ----------

const newId = () => crypto.randomUUID();

// Código curto do link: sem letras que confundem (0/O, 1/l/I).
function newSlug() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeInstagram(value) {
  const handle = String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function createToken(userId) {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const userId = readToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  const user = userId && await store.findUserById(userId);
  if (!user) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
  req.user = user;
  next();
}

const publicUser = u => ({ id: u.id, instagram: u.instagram, name: u.name });

// O que a pessoa que responde pode ver (sem dados do dono nem votos).
const publicSurvey = (s, owner) => ({
  slug: s.slug,
  title: s.title,
  description: s.description,
  city: s.city,
  open: s.open,
  questions: s.questions,
  askNeighborhood: s.askNeighborhood,
  owner: owner ? owner.instagram : null
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------- Contas ----------

app.post("/api/auth/register", authLimiter, wrap(async (req, res) => {
  const instagram = normalizeInstagram(req.body.instagram);
  const name = cleanText(req.body.name, 80);
  const password = String(req.body.password || "");

  if (!instagram) return res.status(400).json({ error: "Informe um @ do Instagram válido." });
  if (!name) return res.status(400).json({ error: "Informe seu nome." });
  if (password.length < 6) return res.status(400).json({ error: "A senha precisa ter pelo menos 6 caracteres." });
  if (await store.findUserByInstagram(instagram)) {
    return res.status(409).json({ error: "Este Instagram já tem conta. Use a opção Entrar." });
  }

  const user = await store.createUser({
    id: newId(), instagram, name, passwordHash: hashPassword(password), createdAt: new Date().toISOString()
  });
  res.status(201).json({ token: createToken(user.id), user: publicUser(user) });
}));

app.post("/api/auth/login", authLimiter, wrap(async (req, res) => {
  const instagram = normalizeInstagram(req.body.instagram);
  const user = instagram && await store.findUserByInstagram(instagram);
  if (!user || !checkPassword(String(req.body.password || ""), user.passwordHash)) {
    return res.status(401).json({ error: "Instagram ou senha incorretos." });
  }
  res.json({ token: createToken(user.id), user: publicUser(user) });
}));

app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- Pesquisas (dono) ----------

function parseQuestions(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: "Adicione pelo menos uma pergunta." };
  if (raw.length > MAX_QUESTIONS) return { error: `No máximo ${MAX_QUESTIONS} perguntas por pesquisa.` };

  const questions = [];
  for (const [i, q] of raw.entries()) {
    const text = cleanText(q?.text, 200);
    if (!text) return { error: `Escreva o texto da pergunta ${i + 1}.` };

    const labels = (Array.isArray(q.options) ? q.options : [])
      .map(o => cleanText(typeof o === "string" ? o : o?.label, 80))
      .filter(Boolean);
    const extras = [];
    if (q.includeUndecided) extras.push("Indeciso / Não sei");
    if (q.includeBlank) extras.push("Branco / Nulo");
    const all = [...new Set([...labels, ...extras])];

    if (labels.length < 1 || all.length < 2) return { error: `A pergunta ${i + 1} precisa de pelo menos 2 opções.` };
    if (all.length > MAX_OPTIONS) return { error: `A pergunta ${i + 1} tem opções demais (máximo ${MAX_OPTIONS}).` };

    questions.push({
      id: `q${i + 1}`,
      text,
      options: all.map((label, j) => ({ id: `o${j + 1}`, label }))
    });
  }
  return { questions };
}

app.get("/api/surveys", requireAuth, wrap(async (req, res) => {
  const surveys = await store.listSurveysByUser(req.user.id);
  const withCounts = await Promise.all(surveys.map(async s => ({
    ...publicSurvey(s), id: s.id, createdAt: s.createdAt, total: await store.countVotes(s.id)
  })));
  res.json({ surveys: withCounts });
}));

app.post("/api/surveys", requireAuth, wrap(async (req, res) => {
  const title = cleanText(req.body.title, 120);
  if (!title) return res.status(400).json({ error: "Dê um título para a pesquisa." });

  const parsed = parseQuestions(req.body.questions);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const survey = await store.createSurvey({
    id: newId(),
    userId: req.user.id,
    slug: newSlug(),
    title,
    description: cleanText(req.body.description, 400),
    city: cleanText(req.body.city, 80),
    askNeighborhood: Boolean(req.body.askNeighborhood),
    questions: parsed.questions,
    open: true,
    createdAt: new Date().toISOString()
  });
  res.status(201).json({ survey: { ...publicSurvey(survey), id: survey.id, total: 0 } });
}));

async function ownSurvey(req, res) {
  const survey = await store.getSurveyBySlug(req.params.slug);
  if (!survey || survey.userId !== req.user.id) {
    res.status(404).json({ error: "Pesquisa não encontrada." });
    return null;
  }
  return survey;
}

app.patch("/api/surveys/:slug", requireAuth, wrap(async (req, res) => {
  const survey = await ownSurvey(req, res);
  if (!survey) return;
  if (typeof req.body.open === "boolean") await store.setSurveyOpen(survey.id, req.body.open);
  res.json({ ok: true, open: typeof req.body.open === "boolean" ? req.body.open : survey.open });
}));

app.delete("/api/surveys/:slug", requireAuth, wrap(async (req, res) => {
  const survey = await ownSurvey(req, res);
  if (!survey) return;
  await store.deleteSurvey(survey.id);
  res.json({ ok: true });
}));

app.get("/api/surveys/:slug/results", requireAuth, wrap(async (req, res) => {
  const survey = await ownSurvey(req, res);
  if (!survey) return;
  const votes = await store.listVotes(survey.id);

  const questions = survey.questions.map(q => {
    const counts = Object.fromEntries(q.options.map(o => [o.id, 0]));
    for (const v of votes) if (v.answers?.[q.id] in counts) counts[v.answers[q.id]]++;
    const answered = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      id: q.id,
      text: q.text,
      answered,
      options: q.options
        .map(o => ({ ...o, votes: counts[o.id], percent: answered ? counts[o.id] / answered * 100 : 0 }))
    };
  });

  const byOrigin = Object.fromEntries(ORIGINS.map(o => [o, 0]));
  for (const v of votes) byOrigin[v.origin in byOrigin ? v.origin : "outro"]++;

  const byNeighborhood = {};
  for (const v of votes) {
    if (!v.neighborhood) continue;
    const key = v.neighborhood.toLowerCase();
    byNeighborhood[key] = byNeighborhood[key] || { name: v.neighborhood, total: 0 };
    byNeighborhood[key].total++;
  }

  res.json({
    survey: { ...publicSurvey(survey), id: survey.id, createdAt: survey.createdAt },
    total: votes.length,
    identified: votes.filter(v => v.name).length,
    questions,
    byOrigin,
    byNeighborhood: Object.values(byNeighborhood).sort((a, b) => b.total - a.total),
    responses: votes.map(v => ({
      name: v.name || null,
      origin: v.origin,
      neighborhood: v.neighborhood || null,
      answers: v.answers,
      createdAt: v.createdAt
    }))
  });
}));

// ---------- Responder (público) ----------

app.get("/api/public/surveys/:slug", wrap(async (req, res) => {
  const survey = await store.getSurveyBySlug(req.params.slug);
  if (!survey) return res.status(404).json({ error: "Pesquisa não encontrada. Confira o link." });
  const owner = await store.findUserById(survey.userId);
  res.json({ survey: publicSurvey(survey, owner) });
}));

app.post("/api/public/surveys/:slug/votes", voteLimiter, wrap(async (req, res) => {
  const survey = await store.getSurveyBySlug(req.params.slug);
  if (!survey) return res.status(404).json({ error: "Pesquisa não encontrada." });
  if (!survey.open) return res.status(403).json({ error: "Esta pesquisa já foi encerrada." });

  // Identificador aleatório guardado no aparelho de quem responde: evita voto repetido
  // no mesmo celular sem precisar guardar IP ou dados pessoais.
  const deviceId = cleanText(req.body.deviceId, 80);
  if (deviceId.length < 16) return res.status(400).json({ error: "Não foi possível identificar o aparelho. Recarregue a página." });
  const voterKey = crypto.createHash("sha256").update(`${survey.id}:${deviceId}`).digest("hex");
  if (await store.hasVoted(survey.id, voterKey)) {
    return res.status(409).json({ error: "Você já respondeu esta pesquisa neste aparelho. Obrigado!" });
  }

  const answers = {};
  for (const q of survey.questions) {
    const chosen = req.body.answers?.[q.id];
    if (!q.options.some(o => o.id === chosen)) {
      return res.status(400).json({ error: `Responda a pergunta: "${q.text}"` });
    }
    answers[q.id] = chosen;
  }

  const wantsName = Boolean(req.body.identify);
  const name = wantsName ? cleanText(req.body.name, 80) : "";
  if (wantsName && !name) return res.status(400).json({ error: "Escreva seu nome ou escolha responder anonimamente." });
  if (wantsName && !req.body.consent) {
    return res.status(400).json({ error: "Para enviar com seu nome, marque a autorização de uso dos dados." });
  }

  const origin = ORIGINS.includes(req.body.origin) ? req.body.origin : "outro";

  try {
    await store.addVote({
      id: newId(),
      surveyId: survey.id,
      voterKey,
      answers,
      name: name || null,
      origin,
      neighborhood: survey.askNeighborhood ? cleanText(req.body.neighborhood, 60) || null : null,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Você já respondeu esta pesquisa neste aparelho. Obrigado!" });
    }
    throw error;
  }
  res.status(201).json({ ok: true });
}));

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
});

app.listen(PORT, () => {
  console.log(`Data Page API rodando na porta ${PORT} (dados em: ${storeKind})`);
});
