const MODEL=process.env.OPENROUTER_MODEL||"google/gemma-3-27b-it:free";
async function call(messages,maxTokens=500){
 if(!process.env.OPENROUTER_API_KEY)throw new Error("OPENROUTER_API_KEY is not configured");
 const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);try{
  const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENROUTER_API_KEY}`,"Content-Type":"application/json","HTTP-Referer":"https://npc-irl.app","X-Title":"پرونده‌های تاریک"},body:JSON.stringify({model:MODEL,messages,temperature:.8,max_tokens:maxTokens}),signal:c.signal});
  if(!r.ok)throw new Error("OpenRouter "+r.status);const d=await r.json();return d.choices?.[0]?.message?.content||"";
 }catch(e){if(e.name==="AbortError")throw new Error("پاسخ بازجویی دیر کرد");throw e}finally{clearTimeout(t)}
}
export async function detectiveReply({suspect,question,evidence,history}){
 const prompt=`تو یک شخصیت مظنون در یک بازی کارآگاهی فارسی هستی.
نام: ${suspect.name}
نقش: ${suspect.role}
توضیح: ${suspect.bio}
مدارک شناخته‌شده: ${JSON.stringify(evidence)}
سابقه بازجویی: ${JSON.stringify(history)}
به سؤال بازیکن پاسخ فارسی بده. شخصیتت را حفظ کن، اما پاسخ را کوتاه و طبیعی نگه دار.
دروغ گفتن مجاز است، ولی سرنخ‌های قطعی و پاسخ‌های قبلی را بی‌دلیل عوض نکن. هرگز راهنمای مستقیم حل پرونده نده.
سؤال: ${question}`;
 try{return (await call([{role:"user",content:prompt}],300)).trim()||"فعلاً حرفی برای گفتن ندارم."}
 catch{return "نگاهش را می‌دزدد و می‌گوید: «الان چیزی یادم نمی‌آید.»"}
}
