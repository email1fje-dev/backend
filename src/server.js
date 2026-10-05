import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { initDb,q } from "./db.js";
import { detectiveReply } from "./ai.js";
import crypto from "node:crypto";
const app=Fastify({logger:true,bodyLimit:8*1024*1024});
await app.register(cors,{origin:true});
const uid=()=>crypto.randomUUID();
async function ensureUser(id,name="کارآگاه"){
 const x=await q("SELECT * FROM users WHERE id=$1",[id]); if(x.rowCount)return x.rows[0];
 await q("INSERT INTO users(id,display_name) VALUES($1,$2)",[id,String(name).slice(0,40)]);
 return (await q("SELECT * FROM users WHERE id=$1",[id])).rows[0];
}
app.get("/health",async()=>({ok:true,service:"detective-backend",time:new Date().toISOString()}));
app.post("/api/users",async req=>({user:await ensureUser((req.body||{}).id||uid(),(req.body||{}).display_name||"کارآگاه")}));
app.get("/api/users/:id",async(req,rep)=>{const r=await q("SELECT * FROM users WHERE id=$1",[req.params.id]);if(!r.rowCount)return rep.code(404).send({error:"User not found"});return {user:r.rows[0]}});
app.get("/api/cases",async(req)=>{const uidp=req.query?.user_id;const r=await q(`
 SELECT c.*,coalesce(cp.status,'locked') as progress_status,coalesce(cp.score,0) as score
 FROM cases c LEFT JOIN case_progress cp ON cp.case_id=c.id AND cp.user_id=$1
 WHERE c.status='active' ORDER BY c.created_at DESC`,[uidp||"00000000-0000-0000-0000-000000000000"]);return {cases:r.rows}});
app.get("/api/cases/:id",async req=>{
 const id=req.params.id;
 const c=await q("SELECT * FROM cases WHERE id=$1",[id]); if(!c.rowCount)return {error:"Case not found"};
 const s=await q("SELECT * FROM suspects WHERE case_id=$1 ORDER BY name",[id]);
 const e=await q("SELECT * FROM evidence WHERE case_id=$1 AND secret=false ORDER BY title",[id]);
 const p=await q("SELECT * FROM case_progress WHERE case_id=$1",[id]);
 return {case:c.rows[0],suspects:s.rows,evidence:e.rows,progress:p.rows[0]||null};
});
app.post("/api/cases/:id/start",async req=>{const u=await ensureUser(req.body?.user_id);await q("INSERT INTO case_progress(user_id,case_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[u.id,req.params.id]);return {ok:true}});
app.get("/api/cases/:caseId/suspects/:suspectId/interviews",async req=>{const r=await q("SELECT question,answer,created_at FROM interviews WHERE user_id=$1 AND case_id=$2 AND suspect_id=$3 ORDER BY created_at",[req.query.user_id,req.params.caseId,req.params.suspectId]);return {interviews:r.rows}});
app.post("/api/cases/:caseId/suspects/:suspectId/interview",async req=>{
 const user=await ensureUser(req.body?.user_id);const question=String(req.body?.question||"").trim();if(!question)return {error:"سؤال خالی است"};
 const s=await q("SELECT * FROM suspects WHERE id=$1 AND case_id=$2",[req.params.suspectId,req.params.caseId]);if(!s.rowCount)return {error:"مظنون پیدا نشد"};
 const ev=await q("SELECT title,description FROM evidence WHERE case_id=$1 AND secret=false",[req.params.caseId]);
 const history=await q("SELECT question,answer FROM interviews WHERE user_id=$1 AND suspect_id=$2 ORDER BY created_at DESC LIMIT 8",[user.id,s.rows[0].id]);
 const answer=await detectiveReply({suspect:s.rows[0],question,evidence:ev.rows,history:history.rows});
 await q("INSERT INTO interviews(id,user_id,case_id,suspect_id,question,answer) VALUES($1,$2,$3,$4,$5,$6)",[uid(),user.id,req.params.caseId,s.rows[0].id,question,answer]);
 return {answer};
});
app.post("/api/cases/:id/notes",async req=>{const u=await ensureUser(req.body?.user_id);const body=String(req.body?.body||"").trim();if(!body)return {error:"یادداشت خالی است"};await q("INSERT INTO detective_notes(id,user_id,case_id,body) VALUES($1,$2,$3,$4)",[uid(),u.id,req.params.id,body]);return {ok:true}});
app.get("/api/cases/:id/links",async req=>{const r=await q("SELECT cl.id,cl.from_evidence,cl.to_evidence,cl.note,e1.title as from_title,e2.title as to_title FROM clue_links cl JOIN evidence e1 ON e1.id=cl.from_evidence JOIN evidence e2 ON e2.id=cl.to_evidence WHERE cl.user_id=$1 AND cl.case_id=$2 ORDER BY cl.created_at",[req.query.user_id,req.params.id]);return {links:r.rows}});
app.post("/api/cases/:id/links",async req=>{const u=await ensureUser(req.body?.user_id);const a=String(req.body?.from_evidence||""),b=String(req.body?.to_evidence||""),note=String(req.body?.note||"").slice(0,300);if(!a||!b||a===b)return {error:"دو سرنخ متفاوت انتخاب کن"};const valid=await q("SELECT id FROM evidence WHERE case_id=$1 AND id=ANY($2::uuid[])",[req.params.id,[a,b]]);if(valid.rowCount!==2)return {error:"سرنخ نامعتبر است"};await q("INSERT INTO clue_links(id,user_id,case_id,from_evidence,to_evidence,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[uid(),u.id,req.params.id,a,b,note]);return {ok:true}});
app.get("/api/cases/:id/notes",async req=>{const r=await q("SELECT id,body,created_at FROM detective_notes WHERE user_id=$1 AND case_id=$2 ORDER BY created_at DESC",[req.query.user_id,req.params.id]);return {notes:r.rows}});
app.post("/api/cases/:id/accuse",async req=>{
 const u=await ensureUser(req.body?.user_id);const suspect=String(req.body?.suspect_id||"");
 const right=(await q("SELECT id FROM suspects WHERE case_id=$1 ORDER BY name",[req.params.id])).rows[2]?.id;
 const correct=suspect===right;const score=correct?100:35;
 await q("INSERT INTO case_progress(user_id,case_id,status,score,accusation,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(user_id,case_id) DO UPDATE SET status=$3,score=$4,accusation=$5,updated_at=NOW()",[u.id,req.params.id,correct?"solved":"failed",score,suspect]);
 if(correct){await q("UPDATE users SET xp=xp+250,coins=coins+100,level=floor(sqrt((xp+250)/100))+1 WHERE id=$1",[u.id]);await q("INSERT INTO achievements(id,user_id,code) VALUES($1,$2,'CASE_01_SOLVED') ON CONFLICT DO NOTHING",[uid(),u.id])}
 return {correct,score,message:correct?"پرونده حل شد. استدلالت درست بود.":"اتهام ثبت شد، اما چند تناقض هنوز بی‌جواب مانده."};
});
app.get("/api/users/:id/achievements",async req=>{const r=await q("SELECT code,unlocked_at FROM achievements WHERE user_id=$1 ORDER BY unlocked_at DESC",[req.params.id]);return {achievements:r.rows}});
app.setErrorHandler((e,req,rep)=>{req.log.error(e);rep.code(e.statusCode||500).send({error:e.message||"خطای سرور"})});
await initDb();await app.listen({port:Number(process.env.PORT||3000),host:"0.0.0.0"});
