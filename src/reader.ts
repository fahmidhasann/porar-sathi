import { pdfjs, openPdf, textLines } from './pdf';
import { getDoc, getPdf, updateDoc, getPageAI, setPageAI, addMyWord, settings, type PageAI, type Term } from './store';
import { explainPage, AIError } from './ai';
import { lookup } from './lookup';
import { speak, say, stop as stopSpeech, hasBangla, ttsSupported } from './tts';
import { quizView } from './quiz';
import { h, bn, toast } from './util';

type PDFDoc = Awaited<ReturnType<typeof openPdf>>;

type Crop = { x0: number; x1: number; y0: number; y1: number };

/** পৃষ্ঠার চারপাশের খালি সাদা জায়গা বাদ দেওয়ার হিসাব (ফোনে লেখা বড় দেখাতে) */
async function cropBox(page: any): Promise<Crop> {
  const full: Crop = { x0: 0, x1: 1, y0: 0, y1: 1 };
  try {
    const vp = page.getViewport({ scale: 0.4 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data, width: W, height: H } = ctx.getImageData(0, 0, c.width, c.height);
    const col = new Uint32Array(W), row = new Uint32Array(H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 235) { col[x]++; row[y]++; }
      }
    const first = (a: Uint32Array, min: number) => a.findIndex((v) => v >= min);
    const last = (a: Uint32Array, min: number) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] >= min) return i; return -1; };
    const cMin = Math.max(2, H * 0.04);
    let x0 = first(col, cMin), x1 = last(col, cMin), y0 = first(row, 2), y1 = last(row, 2);
    if (x0 < 0 || y0 < 0) return full;
    const px = W * 0.015, py = H * 0.01;
    const r: Crop = { x0: Math.max(0, x0 - px) / W, x1: Math.min(W, x1 + 1 + px) / W, y0: Math.max(0, y0 - py) / H, y1: Math.min(H, y1 + 1 + py) / H };
    if (r.x1 - r.x0 > 0.92) { r.x0 = 0; r.x1 = 1; }
    if (r.y1 - r.y0 > 0.95) { r.y0 = 0; r.y1 = 1; }
    return r;
  } catch { return full; }
}

export let cleanupReader: () => void = () => {};

export async function renderReader(root: HTMLElement, id: string) {
  const meta = await getDoc(id);
  const data = await getPdf(id);
  if (!meta || !data) { location.hash = '#/'; return; }

  const pdf: PDFDoc = await openPdf(data);
  if (!root.isConnected) { pdf.destroy(); return; }
  let pageNum = Math.min(Math.max(1, meta.lastPage || 1), pdf.numPages);
  let zoom = 1;
  let lines: string[] = [];
  let ai: PageAI | undefined;
  let renderTask: { cancel(): void; promise: Promise<void> } | null = null;
  let alive = true;
  const inflight = new Map<number, Promise<PageAI>>();

  /* ---------- layout ---------- */
  const title = h('div', { class: 'top-title' }, meta.name);
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'ফিরে যান', onclick: () => (location.hash = '#/') }, '←'),
    title,
  );
  const pageLabel = h('div', { class: 'page-label' });
  const canvas = h('canvas');
  const textLayerDiv = h('div', { class: 'textLayer' });
  const mark = h('div', { class: 'word-mark', hidden: true });
  const pageBox = h('div', { class: 'pdf-page' }, canvas, textLayerDiv, mark);
  const clip = h('div', { class: 'pdf-clip' }, pageBox);
  const pageWrap = h('div', { class: 'pdf-wrap' }, clip);
  const crops = new Map<number, Crop>();
  const zoomBtn = h('button', { class: 'chip-btn', onclick: () => { zoom = zoom === 1 ? 2 : 1; zoomBtn.textContent = zoom === 1 ? '🔍 বড় করুন' : '🔍 ছোট করুন'; renderPage(false); } }, '🔍 বড় করুন');
  const bigBtn = h('button', { class: 'chip-btn', onclick: () => toggleBig() }, '📖 বড় লেখায় পড়ুন');
  const bigText = h('div', { class: 'bigtext', hidden: true });
  const explainBtn = h('button', { class: 'act act-explain', onclick: () => showExplain() }, h('span', { class: 'act-ic' }, '🇧🇩'), 'বাংলায় বুঝাও');
  const listenBtn = h('button', { class: 'act act-listen', onclick: () => toggleListen() }, h('span', { class: 'act-ic' }, '🔊'), 'শুনাও');
  const quizBtn = h('button', { class: 'act act-quiz', onclick: () => showQuiz() }, h('span', { class: 'act-ic' }, '✅'), 'কুইজ');
  const panel = h('section', { class: 'panel', 'aria-live': 'polite' });
  const prevBtn = h('button', { class: 'nav-btn', onclick: () => go(pageNum - 1) }, '◀ আগের');
  const nextBtn = h('button', { class: 'nav-btn', onclick: () => go(pageNum + 1) }, 'পরের ▶');
  const navLabel = h('div', { class: 'nav-label' });
  const bottom = h('nav', { class: 'bottombar' }, prevBtn, navLabel, nextBtn);

  const hint = localStorage.getItem('hint_seen') ? null
    : h('div', { class: 'hint' }, '👆 যেকোনো ইংরেজি শব্দে আঙুল দিয়ে চাপ দিন — বাংলা অর্থ দেখাবে।',
        h('button', { class: 'hint-x', onclick: (e: Event) => { (e.target as HTMLElement).parentElement!.remove(); try { localStorage.setItem('hint_seen', '1'); } catch {} } }, 'বুঝেছি'));

  const main = h('main', { class: 'reader' },
    pageLabel, hint, pageWrap,
    h('div', { class: 'chip-row' }, zoomBtn, bigBtn),
    bigText,
    h('div', { class: 'actions' }, explainBtn, listenBtn, quizBtn),
    panel,
  );
  root.append(top, main, bottom);

  cleanupReader = () => {
    alive = false;
    stopSpeech();
    renderTask?.cancel();
    pdf.destroy();
    window.removeEventListener('resize', onResize);
    cleanupReader = () => {};
  };
  let resizeT = 0;
  const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => renderPage(false), 250); };
  window.addEventListener('resize', onResize);

  /* ---------- page rendering ---------- */
  async function renderPage(fresh = true) {
    const page = await pdf.getPage(pageNum);
    if (!alive) return;
    const base = page.getViewport({ scale: 1 });
    let crop = crops.get(pageNum);
    if (!crop) { crop = await cropBox(page); crops.set(pageNum, crop); }
    if (!alive) return;
    const avail = Math.min(pageWrap.clientWidth || window.innerWidth - 24, 900);
    const scale = (avail * zoom) / (base.width * (crop.x1 - crop.x0));
    const vp = page.getViewport({ scale });
    let dpr = Math.min(window.devicePixelRatio || 1, 3);
    while (dpr > 1 && vp.width * vp.height * dpr * dpr > 12e6) dpr -= 0.5;
    Object.assign(clip.style, { width: vp.width * (crop.x1 - crop.x0) + 'px', height: vp.height * (crop.y1 - crop.y0) + 'px' });
    Object.assign(pageBox.style, { left: -vp.width * crop.x0 + 'px', top: -vp.height * crop.y0 + 'px' });
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';
    pageBox.style.width = vp.width + 'px';
    pageBox.style.height = vp.height + 'px';
    pageBox.style.setProperty('--scale-factor', String(scale));
    mark.hidden = true;

    renderTask?.cancel();
    const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    renderTask = task;
    const tc = await page.getTextContent();
    if (!alive) return;
    textLayerDiv.replaceChildren();
    await new pdfjs.TextLayer({ textContentSource: tc, container: textLayerDiv, viewport: vp }).render();
    try { await task.promise; } catch { /* cancelled */ }

    if (fresh) {
      lines = textLines(tc.items);
      ai = await getPageAI(id, pageNum);
      if (!bigText.hidden) fillBig();
      panel.replaceChildren();
      if (ai) panel.append(explainView(ai));
      else if (!lines.length) panel.append(h('p', { class: 'muted' }, 'এই পৃষ্ঠায় পড়ার মতো লেখা নেই।'));
      prefetch(pageNum + 1);
    }
  }

  function updateNav() {
    const label = `পৃষ্ঠা ${bn(pageNum)} / ${bn(pdf.numPages)}`;
    pageLabel.textContent = label;
    navLabel.textContent = label;
    prevBtn.disabled = pageNum <= 1;
    nextBtn.disabled = pageNum >= pdf.numPages;
  }

  function go(n: number) {
    if (n < 1 || n > pdf.numPages) return;
    stopSpeech();
    setListening(false);
    pageNum = n;
    updateNav();
    updateDoc(id, { lastPage: n, openedAt: Date.now() });
    window.scrollTo({ top: 0 });
    renderPage(true);
  }

  /* ---------- word tap ---------- */
  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const d = document as any;
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  }

  textLayerDiv.addEventListener('click', (e) => {
    if (window.getSelection()?.toString()) return;
    const c = caretAt(e.clientX, e.clientY);
    if (!c || c.node.nodeType !== Node.TEXT_NODE) return;
    const text = c.node.textContent ?? '';
    const re = /[A-Za-z0-9'’\-]/;
    let s = c.offset, en = c.offset;
    if (s > 0 && !re.test(text[s] ?? '') && re.test(text[s - 1])) s--, en--;
    while (s > 0 && re.test(text[s - 1])) s--;
    while (en < text.length && re.test(text[en])) en++;
    const range = document.createRange();
    range.setStart(c.node, s);
    range.setEnd(c.node, en);
    const r = range.getBoundingClientRect();
    if (!r.width || e.clientX < r.left - 8 || e.clientX > r.right + 8 || e.clientY < r.top - 8 || e.clientY > r.bottom + 8) return;
    const word = text.slice(s, en).replace(/^['’\-]+|['’\-]+$/g, '');
    if (!/[A-Za-z]{2,}/.test(word)) return;
    const box = pageBox.getBoundingClientRect();
    Object.assign(mark.style, { left: r.left - box.left - 2 + 'px', top: r.top - box.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
    mark.hidden = false;
    const spanText = text.trim();
    const ctx = lines.find((l) => l.includes(spanText)) ?? spanText;
    openWordSheet(word, ctx);
  });

  /* ---------- big text mode ---------- */
  function toggleBig() {
    bigText.hidden = !bigText.hidden;
    bigBtn.textContent = bigText.hidden ? '📖 বড় লেখায় পড়ুন' : '📖 বড় লেখা বন্ধ';
    if (!bigText.hidden) { fillBig(); bigText.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function fillBig() {
    bigText.replaceChildren(
      h('p', { class: 'muted small' }, 'শব্দে চাপ দিন = অর্থ · 🔊 = ইংরেজি লাইনটা শুনুন'),
      ...lines.map((line) => {
        const p = h('p', { class: 'bline' });
        for (const part of line.split(/([A-Za-z][A-Za-z'’\-]*)/)) {
          if (/^[A-Za-z]/.test(part)) p.append(h('span', { class: 'w', onclick: () => openWordSheet(part, line) }, part));
          else if (part) p.append(part);
        }
        p.append(' ', h('button', { class: 'line-say', 'aria-label': 'শুনুন', onclick: () => say(line, 'en') }, '🔊'));
        return p;
      }),
    );
  }

  /* ---------- AI ---------- */
  function ensureAI(n: number): Promise<PageAI> {
    if (n === pageNum && ai) return Promise.resolve(ai);
    let p = inflight.get(n);
    if (!p) {
      p = (async () => {
        const cached = await getPageAI(id, n);
        if (cached) return cached;
        const ls = n === pageNum ? lines : textLines((await (await pdf.getPage(n)).getTextContent()).items);
        if (!ls.length) return { summary_bn: 'এই পৃষ্ঠায় লেখা নেই।', slides: [], terms: [], quiz: [] };
        const res = await explainPage(ls);
        await setPageAI(id, n, res);
        return res;
      })();
      inflight.set(n, p);
      p.catch(() => {}).finally(() => inflight.delete(n));
    }
    return p.then((r) => { if (n === pageNum) ai = r; return r; });
  }

  function prefetch(n: number) {
    if (!settings.apiKey || n > pdf.numPages) return;
    setTimeout(async () => {
      if (!alive || (await getPageAI(id, n))) return;
      ensureAI(n).catch(() => {});
    }, 4000);
  }

  function loading(msg: string) {
    panel.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), msg));
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function showError(e: unknown, retry: () => void) {
    const msg = e instanceof AIError ? e.message : 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।';
    panel.replaceChildren(h('div', { class: 'error' }, h('p', {}, '😕 ' + msg),
      e instanceof AIError && (e.kind === 'nokey' || e.kind === 'key')
        ? h('a', { class: 'btn', href: '#/settings' }, '⚙️ সেটিংস')
        : h('button', { class: 'btn', onclick: retry }, '🔄 আবার চেষ্টা')));
  }

  async function showExplain() {
    const at = pageNum;
    if (!ai) loading('বাংলায় বোঝানো হচ্ছে… (১০-২০ সেকেন্ড)');
    try {
      const r = await ensureAI(at);
      if (at !== pageNum) return;
      panel.replaceChildren(explainView(r));
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { if (at === pageNum) showError(e, showExplain); }
  }

  async function showQuiz() {
    const at = pageNum;
    if (!ai) loading('কুইজ তৈরি হচ্ছে…');
    try {
      const r = await ensureAI(at);
      if (at !== pageNum) return;
      panel.replaceChildren(
        r.quiz.length ? quizView(r.quiz) : h('p', { class: 'muted' }, 'এই পৃষ্ঠায় কুইজ নেই — পরের পৃষ্ঠায় যান।'),
      );
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { if (at === pageNum) showError(e, showQuiz); }
  }

  function explainView(r: PageAI) {
    return h('div', { class: 'explain' },
      r.summary_bn && h('p', { class: 'summary' }, r.summary_bn),
      ...r.slides.map((s) => h('article', { class: 'card' },
        h('div', { class: 'card-en' }, s.title_en),
        h('h3', {}, s.title_bn),
        ...s.explain_bn.split(/\n+/).filter(Boolean).map((t) => h('p', {}, t)),
        s.example_bn && h('p', { class: 'example' }, h('b', {}, 'উদাহরণ: '), s.example_bn),
      )),
      r.terms.length > 0 && h('div', { class: 'terms' },
        h('h4', {}, '📌 এই পৃষ্ঠার জরুরি শব্দ'),
        h('div', { class: 'term-list' }, ...r.terms.map((t) =>
          h('button', { class: 'term', onclick: () => openWordSheet(t.en, t.en, t) },
            h('span', { class: 'term-en' }, t.en), h('span', { class: 'term-bn' }, t.bn))))),
    );
  }

  /* ---------- listen ---------- */
  let listening = false;
  function setListening(v: boolean) {
    listening = v;
    listenBtn.replaceChildren(h('span', { class: 'act-ic' }, v ? '⏹' : '🔊'), v ? 'থামাও' : 'শুনাও');
    listenBtn.classList.toggle('on', v);
  }
  async function toggleListen() {
    if (listening) { stopSpeech(); setListening(false); return; }
    if (!ttsSupported()) { toast('এই ফোনে পড়ে শোনানোর সুবিধা নেই।'); return; }
    let r = ai;
    if (!r && settings.apiKey) {
      loading('বাংলায় বোঝানো হচ্ছে… তারপর পড়ে শোনাবো');
      try { r = await ensureAI(pageNum); panel.replaceChildren(explainView(r)); } catch (e) { showError(e, toggleListen); return; }
    }
    setListening(true);
    if (r) {
      if (!hasBangla()) toast('ফোনে বাংলা ভয়েস নেই — ⚙️ সেটিংসে দেখুন কীভাবে চালু করবেন।', 5000);
      speak(r.slides.flatMap((s) => [
        { text: s.title_bn + '।', lang: 'bn' as const },
        { text: s.explain_bn.replace(/•/g, ''), lang: 'bn' as const },
        ...(s.example_bn ? [{ text: 'উদাহরণ: ' + s.example_bn, lang: 'bn' as const }] : []),
      ]), () => setListening(false));
    } else {
      speak([{ text: lines.join('. '), lang: 'en' }], () => setListening(false));
    }
  }

  /* ---------- word sheet ---------- */
  async function openWordSheet(word: string, context: string, known?: Term) {
    document.querySelector('.sheet-backdrop')?.remove();
    const body = h('div', { class: 'sheet-body' }, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'অর্থ খোঁজা হচ্ছে…'));
    const close = () => { back.remove(); mark.hidden = true; };
    const back = h('div', { class: 'sheet-backdrop', onclick: (e: Event) => { if (e.target === back) close(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'শব্দের অর্থ' },
        h('div', { class: 'sheet-head' },
          h('div', { class: 'sheet-word' }, word),
          h('button', { class: 'icon-btn', 'aria-label': 'ইংরেজি উচ্চারণ', onclick: () => say(word, 'en') }, '🔊')),
        body,
        h('button', { class: 'btn btn-wide', onclick: close }, 'বন্ধ করুন')));
    document.body.append(back);

    try {
      const t = known ? { ...known, source: 'page' } : await lookup(word, context, ai?.terms ?? []);
      const head = back.querySelector('.sheet-word')!;
      head.textContent = t.en || word;
      body.replaceChildren(
        t.pron_bn ? h('div', { class: 'pron' }, 'উচ্চারণ: ', h('b', {}, t.pron_bn)) : '',
        h('div', { class: 'sheet-bn' }, t.bn,
          h('button', { class: 'icon-btn small', 'aria-label': 'বাংলা শুনুন', onclick: () => say(t.bn + '। ' + (t.meaning_bn ?? ''), 'bn') }, '🔊')),
        t.meaning_bn ? h('p', { class: 'sheet-meaning' }, t.meaning_bn) : '',
        h('p', { class: 'muted small' }, '⭐ "আমার শব্দ" তালিকায় রাখা হলো — রিভিশনে পাবেন।'),
      );
      addMyWord({ en: t.en || word, bn: t.bn, meaning_bn: t.meaning_bn, pron_bn: t.pron_bn, context, at: Date.now() });
    } catch (e) {
      body.replaceChildren(h('p', { class: 'error' }, '😕 ' + (e instanceof Error ? e.message : 'অর্থ পাওয়া যায়নি')));
    }
  }

  updateNav();
  await renderPage(true);
}
