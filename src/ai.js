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
  /stranger.*meet/i,/meet.*stranger/i,/self.?harm/i,/suicide/i,
  /private.?information/i,/password/i,/phone.?number/i,/address/i
];

function safeQuest(x) {
  const text = JSON.stringify(x);
  return !bannedPatterns.some(r => r.test(text));
}

const categories = new Set(["Photo","Observation","Creative","Gaming","Brain","Weird","Challenge"]);
const difficulties = new Set(["Easy","Medium","Hard"]);
const proofTypes = new Set(["photo","text","screenshot"]);

function validQuest(x) {
  if (!x || typeof x !== "object") return false;
  if (!String(x.title || "").trim() || !String(x.description || "").trim()) return false;
  if (!categories.has(String(x.category))) return false;
  if (!difficulties.has(String(x.difficulty))) return false;
  if (!proofTypes.has(String(x.proof_type))) return false;
  const description = String(x.description);
  if (description.length < 18 || description.length > 500) return false;
  const hasAction = /\\b(take|find|spot|count|write|draw|make|arrange|show|capture|play|solve|name|list|notice|record)\\b/i.test(description);
  const hasProof = /\\b(photo|picture|screenshot|write|text|show|send|capture)\\b/i.test(description);
  return hasAction && hasProof && safeQuest(x);
}

const fallbackQuests = [
  {title:"DOOR HUNTER",description:"Take a photo of the entrance door of your home. Make sure the door is clearly visible in the photo.",category:"Photo",difficulty:"Easy",reward_xp:40,reward_coins:15,proof_type:"photo"},
  {title:"COLOR SPOTTER",description:"Find something completely blue in your home and take a photo of it.",category:"Photo",difficulty:"Easy",reward_xp:30,reward_coins:10,proof_type:"photo"},
  {title:"DESK DETECTIVE",description:"Find three different objects near you, write their names in the proof box, and submit the text.",category:"Observation",difficulty:"Easy",reward_xp:35,reward_coins:12,proof_type:"text"},
  {title:"SHAPE HUNT",description:"Find a circle-shaped object in your home and take a photo showing the whole object.",category:"Photo",difficulty:"Easy",reward_xp:35,reward_coins:12,proof_type:"photo"},
  {title:"ODD ONE OUT",description:"Find four objects near you where one looks different from the other three. Take a photo of all four.",category:"Weird",difficulty:"Medium",reward_xp:55,reward_coins:20,proof_type:"photo"},
  {title:"TINY DETAIL",description:"Find a small interesting detail on an everyday object and take a close, clear photo of that detail.",category:"Observation",difficulty:"Medium",reward_xp:50,reward_coins:18,proof_type:"photo"},
  {title:"MEMORY SNAP",description:"Look around your room for 20 seconds, then write the names of five things you noticed.",category:"Brain",difficulty:"Medium",reward_xp:55,reward_coins:20,proof_type:"text"},
  {title:"OBJECT TOWER",description:"Arrange three safe household objects into a small tower and take a photo of the finished arrangement.",category:"Creative",difficulty:"Medium",reward_xp:60,reward_coins:22,proof_type:"photo"},
  {title:"PIXEL PROOF",description:"Complete one match, round, or short challenge in a game and submit a screenshot of the result.",category:"Gaming",difficulty:"Medium",reward_xp:50,reward_coins:18,proof_type:"screenshot"},
  {title:"ONE-LINE ART",description:"Draw a tiny picture without lifting your pen from the paper, then take a photo of your drawing.",category:"Creative",difficulty:"Hard",reward_xp:75,reward_coins:28,proof_type:"photo"}
];

function normalizeQuest(x) {
  return {
    title: String(x.title).trim().slice(0,100),
    description: String(x.description).trim().slice(0,500),
    category: String(x.category),
    difficulty: String(x.difficulty),
    reward_xp: Math.max(10, Math.min(1000, Number(x.reward_xp)||50)),
    reward_coins: Math.max(0, Math.min(500, Number(x.reward_coins)||10)),
    proof_type: String(x.proof_type)
  };
}

function pickFallback(recentQuestTexts=[]) {
  const recent = recentQuestTexts.join(" ").toLowerCase();
  const fresh = fallbackQuests.filter(q => !recent.includes(q.title.toLowerCase()));
  const pool = fresh.length >= 3 ? fresh : fallbackQuests;
  return pool.sort(() => Math.random() - 0.5).slice(0,3);
}

export async function generateQuests(context={}) {
  const prompt = `
You are the quest generator for IRL, a polished real-life RPG.
Generate exactly 3 NEW, concrete, fun quests in ENGLISH. The player never writes quests.

CRITICAL QUALITY RULES:
- Each quest must tell the player EXACTLY what to do.
- Each quest must ask for one clear proof type: photo, text, or screenshot.
- Prefer quests that can be completed immediately at home or in a normal safe public setting.
- A photo quest should be something like: "Take a photo of the entrance door of your home."
- Do NOT use vague instructions such as "observe your surroundings", "be creative", "explore your environment", or "find something interesting" unless you specify exactly what to find and what to submit.
- Keep the task short: normally 1-2 actions.
- No purchases and no special equipment.
- Never ask for a person's face, personal information, address, passwords, private messages, or identifying documents.
- Never require strangers, trespassing, traffic/highways, rooftops, railways, dangerous places, risky physical challenges, weapons, substances, gambling, fighting, or anything that could cause injury.
- Use varied categories and avoid repeating recent quests.
- Make titles punchy and game-like, 2-4 words.
- For photo proof, explicitly say "Take a photo..." and say what must be visible.
- For text proof, explicitly say what the player must write.
- For screenshot proof, explicitly say what screen/result to capture.
- Rewards: Easy 25-45 XP / 8-15 coins; Medium 45-70 XP / 15-25 coins; Hard 70-100 XP / 25-35 coins.

GOOD examples:
1. {"title":"DOOR HUNTER","description":"Take a photo of the entrance door of your home. Make sure the door is clearly visible in the photo.","category":"Photo","difficulty":"Easy","reward_xp":40,"reward_coins":15,"proof_type":"photo"}
2. {"title":"COLOR SPOTTER","description":"Find something completely blue in your home and take a photo of it.","category":"Photo","difficulty":"Easy","reward_xp":30,"reward_coins":10,"proof_type":"photo"}
3. {"title":"MEMORY SNAP","description":"Look around your room for 20 seconds, then write the names of five things you noticed.","category":"Brain","difficulty":"Medium","reward_xp":55,"reward_coins":20,"proof_type":"text"}

Return ONLY valid JSON array. No markdown.

Player context:
level=${context.level || 1}
completed=${context.completed || 0}
recent_categories=${JSON.stringify(context.recentCategories || [])}
recent_quests=${JSON.stringify(context.recentQuestTexts || [])}
`;
  try {
    const parsed = extractJson(await callOpenRouter([{role:"user",content:prompt}], 1400));
    const list = Array.isArray(parsed) ? parsed : parsed.quests;
    if (!Array.isArray(list)) throw new Error("Invalid quest list");
    const cleaned = list.filter(validQuest).map(normalizeQuest);
    const unique = [];
    const seen = new Set();
    for (const q of cleaned) {
      const key = q.title.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(q); }
    }
    if (unique.length >= 3) return unique.slice(0,3);
  } catch (e) {
    console.error("Quest generation failed:", e.message);
  }
  return pickFallback(context.recentQuestTexts || []).map(normalizeQuest);
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