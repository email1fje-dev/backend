const MODEL = process.env.OPENROUTER_MODEL || "google/gemma-3-27b-it:free";

async function callOpenRouter(messages, maxTokens=900) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://npc-irl.app",
      "X-Title": "NPC IRL"
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.9,
      max_tokens: maxTokens
    })
  });
  if (!r.ok) throw new Error(`OpenRouter error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || "";
}

function extractJson(text) {
  const cleaned = text.replace(/\`\`\`json/gi, "").replace(/\`\`\`/g, "").trim();
  const start = Math.min(...["[","{"].map(c => {
    const i = cleaned.indexOf(c); return i < 0 ? Infinity : i;
  }));
  if (!Number.isFinite(start)) throw new Error("AI returned no JSON");
  return JSON.parse(cleaned.slice(start));
}

const bannedPatterns = [
  /weapon/i,/gun/i,/knife/i,/firearm/i,/drug/i,/alcohol/i,/vape/i,/smok/i,
  /gambl/i,/bet/i,/casino/i,/fight/i,/violence/i,/danger/i,/rooftop/i,
  /railway track/i,/traffic/i,/highway/i,/trespass/i,/steal/i,/break.?in/i,
  /stranger.*meet/i,/meet.*stranger/i,/self.?harm/i,/suicide/i
];

function safeQuest(x) {
  const text = JSON.stringify(x);
  return !bannedPatterns.some(r => r.test(text));
}

export async function generateQuests(context={}) {
  const prompt = `
You are the quest generator for NPC IRL, a playful real-life RPG.
Generate 3 NEW quests in ENGLISH. The player never writes quests themselves.
Quests must be safe, legal, age-appropriate, doable without spending money,
and must not require dangerous stunts, strangers, private information, entering
restricted places, weapons, substances, gambling, risky driving, or anything
that could cause injury. Prefer observation, creativity, harmless photos,
drawing, arranging objects, noticing details, or simple gaming-related tasks.

Return ONLY valid JSON as an array. Each item:
{
  "title": "short title",
  "description": "clear instruction",
  "category": "Photo|Observation|Creative|Gaming|Brain|Weird|Challenge",
  "difficulty": "Easy|Medium|Hard",
  "reward_xp": number,
  "reward_coins": number,
  "proof_type": "photo|text|screenshot"
}

Player context:
level=${context.level || 1}
completed=${context.completed || 0}
recent_categories=${JSON.stringify(context.recentCategories || [])}
recent_quests=${JSON.stringify(context.recentQuestTexts || [])}
`;
  const parsed = extractJson(await callOpenRouter([{role:"user",content:prompt}], 1200));
  const list = Array.isArray(parsed) ? parsed : parsed.quests;
  if (!Array.isArray(list)) throw new Error("Invalid quest list");
  return list.filter(safeQuest).slice(0,3).map(x => ({
    title: String(x.title).slice(0,100),
    description: String(x.description).slice(0,500),
    category: String(x.category),
    difficulty: String(x.difficulty),
    reward_xp: Math.max(10, Math.min(1000, Number(x.reward_xp)||50)),
    reward_coins: Math.max(0, Math.min(500, Number(x.reward_coins)||10)),
    proof_type: ["photo","text","screenshot"].includes(x.proof_type) ? x.proof_type : "photo"
  }));
}

export async function verifyProof({quest, proofType, textContent, mimeType, imageBase64}) {
  let userContent = [{
    type:"text",
    text:`Verify this proof for the quest below.
Quest title: ${quest.title}
Quest instruction: ${quest.description}
Required proof type: ${proofType}
Return ONLY JSON:
{"verdict":"accepted"|"rejected","score":0-100,"reason":"short explanation"}
Accept only if the proof gives credible evidence that the harmless quest was completed.
Do not infer facts that are not visible/provided.`
  }];
  if (proofType === "photo" || proofType === "screenshot") {
    if (!imageBase64) throw new Error("Image proof is required");
    userContent.push({
      type:"image_url",
      image_url:{url:`data:${mimeType || "image/jpeg"};base64,${imageBase64}`}
    });
  } else {
    userContent.push({type:"text",text:`Submitted text proof:\n${textContent || ""}`});
  }
  const raw = await callOpenRouter([{role:"user",content:userContent}], 400);
  const result = extractJson(raw);
  return {
    verdict: result.verdict === "accepted" ? "accepted" : "rejected",
    score: Math.max(0, Math.min(100, Number(result.score)||0)),
    reason: String(result.reason || "The proof could not be verified.").slice(0,500)
  };
}