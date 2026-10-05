import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      display_name TEXT,
      level INT NOT NULL DEFAULT 1,
      xp INT NOT NULL DEFAULT 0,
      coins INT NOT NULL DEFAULT 0,
      streak INT NOT NULL DEFAULT 0,
      last_completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quests (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      reward_xp INT NOT NULL,
      reward_coins INT NOT NULL DEFAULT 0,
      proof_type TEXT NOT NULL,
      ai_seed TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_quests (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      quest_id UUID REFERENCES quests(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, quest_id)
    );

    CREATE TABLE IF NOT EXISTS proofs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      quest_id UUID REFERENCES quests(id) ON DELETE CASCADE,
      proof_type TEXT NOT NULL,
      mime_type TEXT,
      text_content TEXT,
      ai_verdict TEXT NOT NULL,
      ai_score INT NOT NULL DEFAULT 0,
      ai_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_user_quests_user_status ON user_quests(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_quests_active ON quests(active);
  `);
}

export function q(text, params=[]) { return pool.query(text, params); }