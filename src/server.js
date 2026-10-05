import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import crypto from "node:crypto";
import { initDb, q } from "./db.js";
import { generateQuests, verifyProof } from "./ai.js";

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 6 * 1024 * 1024, files: 1 }
});

const uid = () => crypto.randomUUID();

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

async function ensureUser(id, displayName="Player") {
  const existing = await q("SELECT * FROM users WHERE id=$1", [id]);
  if (existing.rowCount) return existing.rows[0];
  await q("INSERT INTO users(id, display_name) VALUES($1,$2)", [id, displayName.slice(0,40)]);
  return (await q("SELECT * FROM users WHERE id=$1", [id])).rows[0];
}

async function ensureQuestsForUser(user) {
  const active = await q(
    "SELECT COUNT(*)::int AS count FROM user_quests WHERE user_id=$1 AND status='active'",
    [user.id]
  );
  if (active.rows[0].count >= 3) return;
  const context = await q(`
    SELECT q.category, q.title, q.description
    FROM user_quests uq JOIN quests q ON q.id=uq.quest_id
    WHERE uq.user_id=$1 ORDER BY uq.assigned_at DESC LIMIT 12
  `, [user.id]);
  const completed = await q("SELECT COUNT(*)::int AS count FROM user_quests WHERE user_id=$1 AND status='completed'", [user.id]);
  const generated = await generateQuests({
    level:user.level, completed:completed.rows[0].count,
    recentCategories:context.rows.map(x=>x.category),
    recentQuestTexts:context.rows.map(x=>x.title+" - "+x.description)
  });
  for (const x of generated) {
    const id=uid();
    await q(`INSERT INTO quests(id,title,description,category,difficulty,reward_xp,reward_coins,proof_type,ai_seed)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,x.title,x.description,x.category,x.difficulty,x.reward_xp,x.reward_coins,x.proof_type,"generated"]);
    await q("INSERT INTO user_quests(user_id,quest_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[user.id,id]);
  }
}

app.get("/health", async () => ({ ok:true, service:"npc-irl-backend", time:new Date().toISOString() }));

app.post("/api/users", async (req, reply) => {
  const body=req.body || {};
  const id=body.id || uid();
  const user=await ensureUser(id, body.display_name || "Player");
  await ensureQuestsForUser(user);
  return { user };
});

app.get("/api/users/:id", async (req, reply) => {
  const r=await q("SELECT * FROM users WHERE id=$1",[req.params.id]);
  if (!r.rowCount) return reply.code(404).send({error:"User not found"});
  return {user:r.rows[0]};
});

app.get("/api/users/:id/quests", async (req, reply) => {
  const user=await ensureUser(req.params.id);
  try { await ensureQuestsForUser(user); }
  catch (e) { req.log.error(e); }
  const r=await q(`
    SELECT q.id,q.title,q.description,q.category,q.difficulty,q.reward_xp,q.reward_coins,q.proof_type,
           uq.status,uq.assigned_at,uq.completed_at
    FROM user_quests uq JOIN quests q ON q.id=uq.quest_id
    WHERE uq.user_id=$1 AND uq.status='active'
    ORDER BY uq.assigned_at DESC LIMIT 20
  `,[user.id]);
  return {quests:r.rows};
});

app.post("/api/users/:userId/quests/:questId/proof", async (req, reply) => {
  const {userId,questId}=req.params;
  const user=await ensureUser(userId);
  const qr=await q(`
    SELECT q.*, uq.status FROM quests q JOIN user_quests uq ON uq.quest_id=q.id
    WHERE q.id=$1 AND uq.user_id=$2
  `,[questId,userId]);
  if (!qr.rowCount) return reply.code(404).send({error:"Quest not found"});
  const quest=qr.rows[0];
  if (quest.status !== "active") return reply.code(409).send({error:"Quest is not active"});

  let proofType=quest.proof_type, textContent="", imageBase64="", mimeType="";
  if (req.isMultipart()) {
    const parts=req.parts();
    for await (const part of parts) {
      if (part.type==="file") {
        const buffer=await part.toBuffer();
        imageBase64=buffer.toString("base64");
        mimeType=part.mimetype;
      } else if (part.fieldname==="text") textContent=String(part.value || "");
      else if (part.fieldname==="proof_type") proofType=String(part.value || proofType);
    }
  } else {
    const body=req.body || {};
    textContent=String(body.text || "");
    proofType=String(body.proof_type || proofType);
  }

  if (proofType !== quest.proof_type) return reply.code(400).send({error:`This quest requires ${quest.proof_type} proof`});
  const result=await verifyProof({quest,proofType,textContent,mimeType,imageBase64});
  await q(`INSERT INTO proofs(id,user_id,quest_id,proof_type,mime_type,text_content,ai_verdict,ai_score,ai_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uid(),userId,questId,proofType,mimeType||null,textContent||null,result.verdict,result.score,result.reason]);

  if (result.verdict !== "accepted") return {accepted:false, proof:result};

  const xpGain=quest.reward_xp, coinGain=quest.reward_coins;
  const newXp=user.xp+xpGain, newLevel=levelFromXp(newXp);
  const now=new Date();
  let streak=user.streak;
  if (!user.last_completed_at) streak=1;
  else {
    const last=new Date(user.last_completed_at);
    const days=Math.floor((now-last)/86400000);
    streak = days===0 ? Math.max(1,streak) : days===1 ? streak+1 : 1;
  }
  await q(`UPDATE users SET xp=$1,level=$2,coins=coins+$3,streak=$4,last_completed_at=$5 WHERE id=$6`,
    [newXp,newLevel,coinGain,streak,now,userId]);
  await q("UPDATE user_quests SET status='completed',completed_at=$1 WHERE user_id=$2 AND quest_id=$3",[now,userId,questId]);
  await q("INSERT INTO achievements(id,user_id,code) VALUES($1,$2,'FIRST_QUEST') ON CONFLICT DO NOTHING",[uid(),userId]);

  const updated=(await q("SELECT * FROM users WHERE id=$1",[userId])).rows[0];
  return {accepted:true,proof:result,reward:{xp:xpGain,coins:coinGain},user:updated};
});

app.get("/api/users/:id/achievements", async (req) => {
  const r=await q("SELECT code,unlocked_at FROM achievements WHERE user_id=$1 ORDER BY unlocked_at DESC",[req.params.id]);
  return {achievements:r.rows};
});

app.setErrorHandler((error, req, reply) => {
  req.log.error(error);
  reply.code(error.statusCode || 500).send({error:error.message || "Internal server error"});
});

await initDb();
const port=Number(process.env.PORT || 3000);
await app.listen({port,host:"0.0.0.0"});
