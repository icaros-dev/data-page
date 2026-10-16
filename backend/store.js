// Guarda contas, pesquisas e votos.
// Com DATABASE_URL usa Postgres; sem ele, usa o arquivo data/db.json
// (bom para testar no computador; no Render gratuito o arquivo se perde a cada reinício).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_URL = process.env.DATABASE_URL || "";

export const storeKind = DATABASE_URL ? "postgres" : "arquivo";

export async function createStore() {
  return DATABASE_URL ? createPgStore() : createFileStore();
}

// ---------- Arquivo JSON ----------

function createFileStore() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
  const file = path.join(dir, "db.json");
  fs.mkdirSync(dir, { recursive: true });

  let db = { users: [], surveys: [], votes: [] };
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, "utf8"));

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  };

  return {
    async findUserByInstagram(instagram) {
      return db.users.find(u => u.instagram === instagram) || null;
    },
    async findUserById(id) {
      return db.users.find(u => u.id === id) || null;
    },
    async createUser(user) {
      db.users.push(user);
      save();
      return user;
    },
    async createSurvey(survey) {
      db.surveys.push(survey);
      save();
      return survey;
    },
    async listSurveysByUser(userId) {
      return db.surveys
        .filter(s => s.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getSurveyBySlug(slug) {
      return db.surveys.find(s => s.slug === slug) || null;
    },
    async setSurveyOpen(id, open) {
      const s = db.surveys.find(x => x.id === id);
      if (s) { s.open = open; save(); }
    },
    async deleteSurvey(id) {
      db.surveys = db.surveys.filter(s => s.id !== id);
      db.votes = db.votes.filter(v => v.surveyId !== id);
      save();
    },
    async hasVoted(surveyId, voterKey) {
      return db.votes.some(v => v.surveyId === surveyId && v.voterKey === voterKey);
    },
    async addVote(vote) {
      db.votes.push(vote);
      save();
    },
    async listVotes(surveyId) {
      return db.votes.filter(v => v.surveyId === surveyId);
    },
    async countVotes(surveyId) {
      return db.votes.filter(v => v.surveyId === surveyId).length;
    }
  };
}

// ---------- Postgres ----------

async function createPgStore() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      instagram TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      data JSONB NOT NULL,
      open BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      voter_key TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (survey_id, voter_key)
    );
  `);

  const toUser = r => r && ({
    id: r.id, instagram: r.instagram, name: r.name,
    passwordHash: r.password_hash, createdAt: r.created_at
  });
  const toSurvey = r => r && ({
    ...r.data, id: r.id, userId: r.user_id, slug: r.slug, open: r.open, createdAt: r.created_at
  });
  const toVote = r => ({ ...r.data, id: r.id, surveyId: r.survey_id, createdAt: r.created_at });

  return {
    async findUserByInstagram(instagram) {
      const { rows } = await pool.query("SELECT * FROM users WHERE instagram = $1", [instagram]);
      return toUser(rows[0]) || null;
    },
    async findUserById(id) {
      const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
      return toUser(rows[0]) || null;
    },
    async createUser(u) {
      await pool.query(
        "INSERT INTO users (id, instagram, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)",
        [u.id, u.instagram, u.name, u.passwordHash, u.createdAt]
      );
      return u;
    },
    async createSurvey(s) {
      const { id, userId, slug, open, createdAt, ...data } = s;
      await pool.query(
        "INSERT INTO surveys (id, user_id, slug, data, open, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, userId, slug, data, open, createdAt]
      );
      return s;
    },
    async listSurveysByUser(userId) {
      const { rows } = await pool.query(
        "SELECT * FROM surveys WHERE user_id = $1 ORDER BY created_at DESC", [userId]
      );
      return rows.map(toSurvey);
    },
    async getSurveyBySlug(slug) {
      const { rows } = await pool.query("SELECT * FROM surveys WHERE slug = $1", [slug]);
      return toSurvey(rows[0]) || null;
    },
    async setSurveyOpen(id, open) {
      await pool.query("UPDATE surveys SET open = $2 WHERE id = $1", [id, open]);
    },
    async deleteSurvey(id) {
      await pool.query("DELETE FROM surveys WHERE id = $1", [id]);
    },
    async hasVoted(surveyId, voterKey) {
      const { rows } = await pool.query(
        "SELECT 1 FROM votes WHERE survey_id = $1 AND voter_key = $2", [surveyId, voterKey]
      );
      return rows.length > 0;
    },
    async addVote(v) {
      const { id, surveyId, voterKey, createdAt, ...data } = v;
      await pool.query(
        "INSERT INTO votes (id, survey_id, voter_key, data, created_at) VALUES ($1,$2,$3,$4,$5)",
        [id, surveyId, voterKey, data, createdAt]
      );
    },
    async listVotes(surveyId) {
      const { rows } = await pool.query(
        "SELECT * FROM votes WHERE survey_id = $1 ORDER BY created_at", [surveyId]
      );
      return rows.map(toVote);
    },
    async countVotes(surveyId) {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM votes WHERE survey_id = $1", [surveyId]);
      return rows[0].n;
    }
  };
}
