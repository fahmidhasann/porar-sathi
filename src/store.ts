import { get, set, del } from 'idb-keyval';

export interface DocMeta {
  id: string;
  name: string;
  pages: number;
  lastPage: number;
  openedAt: number;
}

export interface Term { en: string; bn: string; meaning_bn?: string; pron_bn?: string }
export interface QuizItem { question_bn: string; options_bn: string[]; answer_index: number; why_bn: string }
export interface SlideExplain { title_en: string; title_bn: string; explain_bn: string; example_bn?: string }
export interface PageAI { summary_bn: string; slides: SlideExplain[]; terms: Term[]; quiz: QuizItem[] }
export interface MyWord extends Term { context?: string; at: number }

export const listDocs = async (): Promise<DocMeta[]> =>
  ((await get<DocMeta[]>('docs')) ?? []).sort((a, b) => b.openedAt - a.openedAt);

export async function saveDoc(meta: DocMeta, data: ArrayBuffer) {
  await set('pdf:' + meta.id, new Blob([data], { type: 'application/pdf' }));
  const docs = (await get<DocMeta[]>('docs')) ?? [];
  const old = docs.find((d) => d.id === meta.id);
  await set('docs', [...docs.filter((d) => d.id !== meta.id), { ...meta, lastPage: old?.lastPage ?? 1 }]);
}

export async function updateDoc(id: string, patch: Partial<DocMeta>) {
  const docs = (await get<DocMeta[]>('docs')) ?? [];
  await set('docs', docs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export async function deleteDoc(id: string) {
  const docs = (await get<DocMeta[]>('docs')) ?? [];
  const doc = docs.find((d) => d.id === id);
  await set('docs', docs.filter((d) => d.id !== id));
  await del('pdf:' + id);
  if (doc) for (let p = 1; p <= doc.pages; p++) await del(`ai:${id}:${p}`);
}

export async function getPdf(id: string): Promise<ArrayBuffer | undefined> {
  const b = await get<Blob>('pdf:' + id);
  return b ? b.arrayBuffer() : undefined;
}

export const getDoc = async (id: string) => ((await get<DocMeta[]>('docs')) ?? []).find((d) => d.id === id);

export const getPageAI = (id: string, p: number) => get<PageAI>(`ai:${id}:${p}`);
export const setPageAI = (id: string, p: number, v: PageAI) => set(`ai:${id}:${p}`, v);

export async function allPageAI(): Promise<{ doc: DocMeta; page: number; ai: PageAI }[]> {
  const out: { doc: DocMeta; page: number; ai: PageAI }[] = [];
  for (const doc of await listDocs())
    for (let p = 1; p <= doc.pages; p++) {
      const ai = await getPageAI(doc.id, p);
      if (ai) out.push({ doc, page: p, ai });
    }
  return out;
}

export const getWord = (k: string) => get<Term>('w:' + k);
export const setWord = (k: string, v: Term) => set('w:' + k, v);

export const listMyWords = async () => (await get<MyWord[]>('mywords')) ?? [];
export async function addMyWord(w: MyWord) {
  const list = await listMyWords();
  await set('mywords', [w, ...list.filter((x) => x.en.toLowerCase() !== w.en.toLowerCase())].slice(0, 500));
}
export async function removeMyWord(en: string) {
  await set('mywords', (await listMyWords()).filter((x) => x.en !== en));
}

/* ---- settings (localStorage) ---- */
const LS = {
  get(k: string, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
export const settings = {
  get apiKey() { return LS.get('gemini_key').trim(); },
  set apiKey(v: string) { LS.set('gemini_key', v.trim()); },
  get model() { return LS.get('gemini_model'); },
  set model(v: string) { LS.set('gemini_model', v); },
  get rate() { return parseFloat(LS.get('tts_rate', '0.85')) || 0.85; },
  set rate(v: number) { LS.set('tts_rate', String(v)); },
  get fontScale() { return parseFloat(LS.get('font_scale', '1')) || 1; },
  set fontScale(v: number) { LS.set('font_scale', String(v)); },
};
