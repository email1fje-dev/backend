import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized:false } : false
});
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY, display_name TEXT, level INT NOT NULL DEFAULT 1,
      xp INT NOT NULL DEFAULT 0, coins INT NOT NULL DEFAULT 0, streak INT NOT NULL DEFAULT 0,
      last_completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cases (
      id UUID PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, description TEXT NOT NULL,
      location TEXT, cover_url TEXT, difficulty TEXT NOT NULL DEFAULT 'متوسط',
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS suspects (
      id UUID PRIMARY KEY, case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      name TEXT NOT NULL, role TEXT, bio TEXT, portrait_url TEXT, accent TEXT DEFAULT '#8B5CF6'
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id UUID PRIMARY KEY, case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT, image_url TEXT, type TEXT DEFAULT 'مدرک',
      secret BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS case_progress (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE, case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'investigating', score INT NOT NULL DEFAULT 0,
      accusation UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,case_id)
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      case_id UUID REFERENCES cases(id) ON DELETE CASCADE, suspect_id UUID REFERENCES suspects(id) ON DELETE CASCADE,
      question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS detective_notes (
      id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      case_id UUID REFERENCES cases(id) ON DELETE CASCADE, body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL, unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, code)
    );
    CREATE TABLE IF NOT EXISTS quests (
      id UUID PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
      difficulty TEXT NOT NULL, reward_xp INT NOT NULL, reward_coins INT NOT NULL DEFAULT 0,
      proof_type TEXT NOT NULL, ai_seed TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_quests (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE, quest_id UUID REFERENCES quests(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active', assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
      PRIMARY KEY(user_id,quest_id)
    );
    CREATE TABLE IF NOT EXISTS proofs (
      id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE, quest_id UUID REFERENCES quests(id) ON DELETE CASCADE,
      proof_type TEXT NOT NULL, mime_type TEXT, text_content TEXT, ai_verdict TEXT NOT NULL, ai_score INT NOT NULL DEFAULT 0,
      ai_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_case_progress_user ON case_progress(user_id,status);
    CREATE INDEX IF NOT EXISTS idx_interviews_case ON interviews(case_id,suspect_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
    CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
  `);
  const c=await pool.query("SELECT id FROM cases LIMIT 1");
  if(!c.rowCount){
    const caseId=crypto.randomUUID(), s1=crypto.randomUUID(), s2=crypto.randomUUID(), s3=crypto.randomUUID();
    const e1=crypto.randomUUID(), e2=crypto.randomUUID(), e3=crypto.randomUUID(), e4=crypto.randomUUID();
    await pool.query("INSERT INTO cases(id,title,subtitle,description,location,cover_url,difficulty) VALUES($1,$2,$3,$4,$5,$6,$7)",[
      caseId,"پرونده ۰۱: اتاق ۲۱۷","چراغ خاموش شد. حقیقت نه.","ساعت ۲۳:۱۷ برق راهروی طبقه دوم برای چند دقیقه قطع شد. وقتی چراغ‌ها برگشتند، یک جعبه قدیمی از اتاق ۲۱۷ ناپدید شده بود. سه نفر آخرین کسانی هستند که در ساختمان دیده شده‌اند. هیچ‌کس هم حاضر نیست داستانش را کامل تعریف کند.","ساختمان آفتاب، طبقه دوم","https://picsum.photos/seed/detective-case-217/1200/720","متوسط"
    ]);
    await pool.query("INSERT INTO suspects(id,case_id,name,role,bio,portrait_url) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$8,$9,$10,$11),($12,$2,$13,$14,$15,$16)",[
      s1,caseId,"آرمان","نگهبان شب","می‌گوید تمام مدت پشت میز نگهبانی بوده؛ اما زمان قطعی برق را عجیب دقیق به خاطر دارد.","https://picsum.photos/seed/suspect-arman/600/600",
      s2,"سارا","همسایه طبقه دوم","صدای باز شدن در اتاق ۲۱۷ را شنیده، ولی می‌گوید خودش از راهرو رد نشده است.","https://picsum.photos/seed/suspect-sara/600/600",
      s3,"کیان","تعمیرکار ساختمان","برای بررسی جعبه برق آمده بود. ادعا می‌کند قبل از خاموشی ساختمان را ترک کرده است.","https://picsum.photos/seed/suspect-kian/600/600"
    ]);
    await pool.query("INSERT INTO evidence(id,case_id,title,description,image_url,type,secret) VALUES($1,$2,$3,$4,$5,$6,false),($7,$2,$8,$9,$10,$11,false),($12,$2,$13,$14,$15,$16,false),($17,$2,$18,$19,$20,$21,true)",[
      e1,caseId,"ساعت ۲۳:۱۷","ثبت دوربین راهرو دقیقاً هنگام قطع برق متوقف شده است.","https://picsum.photos/seed/evidence-clock-2317/900/600","گزارش",
      e2,"کلید برنجی","یک کلید قدیمی کنار در اتاق پیدا شده؛ روی آن فقط عدد ۲۱۷ حک شده.","https://picsum.photos/seed/evidence-key-217/900/600","شیء",
      e3,"یادداشت پاره","تکه‌ای از یک یادداشت در سطل زباله پیدا شده و فقط چند کلمه از آن خواناست.","https://picsum.photos/seed/evidence-note-217/900/600","سند",
      e4,"رد کفش","روی کف راهرو اثری تازه دیده شده؛ اندازه آن با کفش یکی از افراد مطابقت دارد.","https://picsum.photos/seed/evidence-footprint/900/600","سرنخ"
    ]);
  }
}
export function q(text,params=[]){return pool.query(text,params)}
