import { GLOSSARY } from './glossary';
import { wordMeaning, AIError } from './ai';
import { getWord, setWord, settings, type Term } from './store';
import { norm } from './util';

const hasWord = (hay: string, w: string) => (' ' + hay + ' ').includes(' ' + w + ' ');

/** লাইনের ভেতরে tapped শব্দসহ সবচেয়ে লম্বা টার্ম খোঁজে */
function findPhrase(terms: Term[], word: string, context: string): Term | undefined {
  const w = norm(word), ctx = norm(context);
  let best: Term | undefined, bestLen = 0;
  for (const t of terms) {
    const e = norm(t.en);
    if (!e) continue;
    const words = e.split(' ');
    const match = words.includes(w) || words.some((x) => x.replace(/s$/, '') === w.replace(/s$/, ''));
    if (!match) continue;
    if (words.length > 1 && !hasWord(ctx, e) && !ctx.includes(e)) continue;
    if (e.length > bestLen) { best = t; bestLen = e.length; }
  }
  return best;
}

async function quickTranslate(text: string): Promise<string> {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=bn&dt=t&q=' + encodeURIComponent(text));
  if (!r.ok) throw new Error('translate failed');
  const j = await r.json();
  return (j[0] as any[]).map((x) => x[0]).join('');
}

export async function lookup(word: string, context: string, pageTerms: Term[] = []): Promise<Term & { source: string }> {
  const fromPage = findPhrase(pageTerms, word, context);
  if (fromPage) return { ...fromPage, source: 'page' };
  const fromGloss = findPhrase(GLOSSARY, word, context);
  if (fromGloss) return { ...fromGloss, source: 'glossary' };

  const key = norm(word);
  const cached = await getWord(key);
  if (cached) return { ...cached, source: 'cache' };

  if (settings.apiKey) {
    try {
      const t = await wordMeaning(word, context);
      await setWord(key, t);
      return { ...t, source: 'ai' };
    } catch (e) {
      if (e instanceof AIError && e.kind === 'net') throw e;
    }
  }
  try {
    const bnText = await quickTranslate(word);
    const t: Term = { en: word, bn: bnText };
    await setWord(key, t);
    return { ...t, source: 'translate' };
  } catch {
    throw new AIError('অর্থ আনতে ইন্টারনেট লাগবে।', 'net');
  }
}
