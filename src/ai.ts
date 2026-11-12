import { settings, type PageAI, type Term } from './store';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const SMART = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const FAST = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];

export class AIError extends Error {
  constructor(msg: string, public kind: 'nokey' | 'key' | 'rate' | 'net' | 'other') { super(msg); }
}

const S = (type: string, extra: object = {}) => ({ type, ...extra });
const STR = S('STRING');

async function generate(prompt: string, schema: object, models: string[]): Promise<any> {
  const key = settings.apiKey;
  if (!key) throw new AIError('AI সেট করা নেই। ⚙️ সেটিংসে Gemini key দিন।', 'nokey');
  const list = [...new Set([settings.model, ...models].filter(Boolean))];
  let lastErr: AIError | null = null;
  for (const m of list) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.3 },
        }),
      });
    } catch {
      throw new AIError('ইন্টারনেট সংযোগ নেই মনে হচ্ছে। নেট চালু করে আবার চেষ্টা করুন।', 'net');
    }
    if (res.status === 404) { lastErr = new AIError('মডেল পাওয়া যায়নি: ' + m, 'other'); continue; }
    if (res.status === 429) throw new AIError('একটু বেশি প্রশ্ন হয়ে গেছে। ১ মিনিট পরে আবার চাপুন।', 'rate');
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const t = await res.text();
      if (/API key|API_KEY|PERMISSION/i.test(t)) throw new AIError('Gemini key কাজ করছে না। ⚙️ সেটিংসে ঠিক করুন।', 'key');
      lastErr = new AIError('AI উত্তর দিতে পারেনি (' + res.status + ')', 'other');
      continue;
    }
    if (!res.ok) { lastErr = new AIError('AI সার্ভারে সমস্যা (' + res.status + ')। পরে চেষ্টা করুন।', 'other'); continue; }
    const data = await res.json();
    const text: string = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    try {
      const out = JSON.parse(text);
      if (settings.model !== m) settings.model = m;
      return out;
    } catch {
      lastErr = new AIError('AI-এর উত্তর বোঝা যায়নি। আবার চেষ্টা করুন।', 'other');
    }
  }
  throw lastErr ?? new AIError('AI কাজ করছে না', 'other');
}

const CONTEXT = `শিক্ষার্থী: একজন বাংলাভাষী মধ্যবয়সী সরকারি কর্মকর্তা, ইংরেজি পড়তে কষ্ট হয়। তিনি বাংলাদেশের BPPA-র "Basic Public Procurement Management" ট্রেনিং নিচ্ছেন (আইন: PPA-2006, বিধিমালা: PPR-2025)।
নিয়ম:
- খুব সহজ, ঘরোয়া, সম্মানজনক বাংলায় লেখো ("আপনি")। ছোট ছোট বাক্য।
- সরকারি প্রচলিত বাংলা পরিভাষা ব্যবহার করো (যেমন Procuring Entity = ক্রয়কারী প্রতিষ্ঠান, Tender = দরপত্র, Works = কার্য)। গুরুত্বপূর্ণ ইংরেজি শব্দ প্রথমবার বন্ধনীতে রাখো।
- স্লাইডে S-2.7 মানে আইনের ধারা ২(৭), R-2.13 মানে বিধিমালার বিধি ২(১৩) — দরকার হলে বুঝিয়ে বলো।
- স্লাইডে যা নেই এমন আইনি তথ্য বানিয়ে বলবে না।`;

export async function explainPage(lines: string[]): Promise<PageAI> {
  const schema = S('OBJECT', {
    properties: {
      summary_bn: STR,
      slides: S('ARRAY', { items: S('OBJECT', {
        properties: { title_en: STR, title_bn: STR, explain_bn: STR, example_bn: STR },
        required: ['title_en', 'title_bn', 'explain_bn'] }) }),
      terms: S('ARRAY', { items: S('OBJECT', {
        properties: { en: STR, bn: STR, meaning_bn: STR, pron_bn: STR },
        required: ['en', 'bn', 'meaning_bn', 'pron_bn'] }) }),
      quiz: S('ARRAY', { items: S('OBJECT', {
        properties: { question_bn: STR, options_bn: S('ARRAY', { items: STR }), answer_index: S('INTEGER'), why_bn: STR },
        required: ['question_bn', 'options_bn', 'answer_index', 'why_bn'] }) }),
    },
    required: ['summary_bn', 'slides', 'terms', 'quiz'],
  });
  const prompt = `${CONTEXT}

নিচে ট্রেনিংয়ের PDF-এর একটা পৃষ্ঠার ইংরেজি লেখা (সাধারণত ১-২টা স্লাইড)।
তোমার কাজ (JSON):
- summary_bn: এই পৃষ্ঠায় কী আছে, ১ বাক্যে।
- slides: প্রতিটা স্লাইডের জন্য — title_en (ইংরেজি শিরোনাম), title_bn (বাংলা শিরোনাম), explain_bn (৩-৬টা সহজ বাক্যে মূল কথা; একাধিক পয়েন্ট থাকলে প্রতি লাইনে "• " দিয়ে), example_bn (বাস্তব জীবনের ছোট একটা উদাহরণ, যেমন অফিসের জন্য চেয়ার কেনা; দরকার না হলে খালি)।
- terms: এই পৃষ্ঠার ৩-৮টা গুরুত্বপূর্ণ ইংরেজি শব্দ/টার্ম — en (স্লাইডে যেমন আছে), bn (বাংলা অর্থ, ১-৪ শব্দ), meaning_bn (১ বাক্যে সহজ ব্যাখ্যা), pron_bn (বাংলা অক্ষরে ইংরেজি উচ্চারণ)।
- quiz: ২-৩টা সহজ MCQ প্রশ্ন বাংলায় (৪টা অপশন, answer_index 0-3, why_bn = কেন এটা সঠিক, ১ বাক্যে)। শুধু শিরোনাম পৃষ্ঠা হলে quiz খালি রাখো।

পৃষ্ঠার লেখা:
"""
${lines.join('\n')}
"""`;
  const out = (await generate(prompt, schema, SMART)) as PageAI;
  out.quiz = (out.quiz ?? []).filter((q) => q.options_bn?.length >= 2 && q.answer_index >= 0 && q.answer_index < q.options_bn.length);
  return out;
}

export async function wordMeaning(word: string, context: string): Promise<Term> {
  const schema = S('OBJECT', {
    properties: { en: STR, bn: STR, meaning_bn: STR, pron_bn: STR },
    required: ['en', 'bn', 'meaning_bn', 'pron_bn'],
  });
  const prompt = `${CONTEXT}

শিক্ষার্থী এই ইংরেজি শব্দে চাপ দিয়েছেন: "${word}"
যে লাইনে শব্দটা আছে: "${context}"

JSON দাও:
- en: শব্দটা যদি লাইনের কোনো বড় টার্মের অংশ হয় (যেমন "Procuring Entity", "Value for Money"), তাহলে পুরো টার্ম; নাহলে শব্দটাই (মূল রূপে)।
- bn: এই প্রসঙ্গে বাংলা অর্থ (১-৪ শব্দ)।
- meaning_bn: এই লাইনে শব্দটা কী বোঝাচ্ছে, ১ সহজ বাক্যে।
- pron_bn: বাংলা অক্ষরে উচ্চারণ (যেমন procurement = প্রকিউরমেন্ট)।`;
  return (await generate(prompt, schema, FAST)) as Term;
}

export async function testKey(): Promise<string> {
  const r = await generate('Reply with JSON {"ok":"হ্যাঁ"}', S('OBJECT', { properties: { ok: STR }, required: ['ok'] }), FAST);
  return `${r.ok} — মডেল: ${settings.model}`;
}
