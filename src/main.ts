import './style.css';
import { get, del } from 'idb-keyval';
import { openPdf } from './pdf';
import { renderReader, cleanupReader } from './reader';
import { listDocs, saveDoc, deleteDoc, listMyWords, removeMyWord, allPageAI, settings, type DocMeta } from './store';
import { testKey, AIError } from './ai';
import { say, stop as stopSpeech, hasBangla } from './tts';
import { quizView } from './quiz';
import { h, bn, toast, sha256 } from './util';

const app = document.getElementById('app')!;
const applyFont = () => document.documentElement.style.setProperty('--fs', String(settings.fontScale));
applyFont();

/* ---------- PDF import ---------- */
async function importPdf(name: string, data: ArrayBuffer) {
  const busy = h('div', { class: 'busy' }, h('span', { class: 'spinner' }), 'PDF খোলা হচ্ছে…');
  document.body.append(busy);
  try {
    const id = await sha256(data);
    const doc = await openPdf(data);
    const meta: DocMeta = { id, name: name.replace(/\.pdf$/i, ''), pages: doc.numPages, lastPage: 1, openedAt: Date.now() };
    await doc.destroy();
    await saveDoc(meta, data);
    location.hash = '#/read/' + id;
  } catch (e) {
    console.error(e);
    toast('😕 এই ফাইলটা খোলা গেল না। ঠিক PDF কিনা দেখুন।', 5000);
  } finally {
    busy.remove();
  }
}

async function checkShared() {
  if (!location.search.includes('shared=1')) return false;
  history.replaceState(null, '', location.pathname + location.hash);
  const s = await get<{ name: string; blob: Blob }>('shared-pdf');
  if (!s) return false;
  await del('shared-pdf');
  const before = location.hash;
  await importPdf(s.name || 'শেয়ার করা PDF', await s.blob.arrayBuffer());
  return location.hash !== before;
}

/* ---------- Home ---------- */
async function renderHome(root: HTMLElement) {
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, onchange: async () => {
    const f = input.files?.[0];
    if (f) await importPdf(f.name, await f.arrayBuffer());
    input.value = '';
  } });
  const docs = await listDocs();
  root.append(
    h('header', { class: 'hero' },
      h('a', { class: 'gear', href: '#/settings', 'aria-label': 'সেটিংস' }, '⚙️'),
      h('img', { src: 'icon-192.png', alt: '', class: 'hero-icon' }),
      h('h1', {}, 'পড়ার সাথী'),
      h('p', {}, 'ইংরেজি ক্লাসের PDF বাংলায় সহজে বুঝুন')),
    h('main', { class: 'home' },
      h('button', { class: 'btn btn-big', onclick: () => input.click() }, '📄 নতুন PDF খুলুন'),
      input,
      h('p', { class: 'muted small center' }, 'অথবা WhatsApp-এ PDF-এর উপর চেপে ধরে → Share → "পড়ার সাথী"'),
      docs.length > 0 && h('h2', {}, 'আমার PDF গুলো'),
      ...docs.map((d) => h('div', { class: 'doc' },
        h('a', { class: 'doc-main', href: '#/read/' + d.id },
          h('span', { class: 'doc-ic' }, '📘'),
          h('span', {}, h('div', { class: 'doc-name' }, d.name),
            h('div', { class: 'muted small' }, `পৃষ্ঠা ${bn(d.lastPage)} / ${bn(d.pages)} পর্যন্ত পড়েছেন`))),
        h('button', { class: 'icon-btn del', 'aria-label': 'মুছে ফেলুন', onclick: async () => {
          if (confirm(`"${d.name}" মুছে ফেলবেন?`)) { await deleteDoc(d.id); route(); }
        } }, '🗑'))),
      h('a', { class: 'btn btn-big btn-soft', href: '#/revise' }, '📚 রিভিশন — আমার শব্দ ও কুইজ'),
    ),
  );
}

/* ---------- Revise ---------- */
async function renderRevise(root: HTMLElement, tab = 'words') {
  const words = await listMyWords();
  const body = h('div', {});
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: tab === 'words' ? 'on' : '', onclick: () => { root.replaceChildren(); renderRevise(root, 'words'); } }, `⭐ আমার শব্দ (${bn(words.length)})`),
    h('button', { class: tab === 'quiz' ? 'on' : '', onclick: () => { root.replaceChildren(); renderRevise(root, 'quiz'); } }, '✅ কুইজ অনুশীলন'));
  root.append(topbar('রিভিশন'), h('main', { class: 'page' }, tabs, body));

  if (tab === 'words') {
    if (!words.length) body.append(h('p', { class: 'muted center' }, 'এখনো কোনো শব্দ নেই। PDF পড়ার সময় শব্দে চাপ দিলে এখানে জমা হবে।'));
    for (const w of words)
      body.append(h('div', { class: 'card word-card' },
        h('div', { class: 'wc-head' },
          h('b', { class: 'wc-en' }, w.en),
          h('button', { class: 'icon-btn small', onclick: () => say(w.en, 'en') }, '🔊'),
          h('button', { class: 'icon-btn small del', 'aria-label': 'বাদ দিন', onclick: async () => { await removeMyWord(w.en); root.replaceChildren(); renderRevise(root, 'words'); } }, '✕')),
        w.pron_bn ? h('div', { class: 'muted small' }, 'উচ্চারণ: ' + w.pron_bn) : '',
        h('div', { class: 'wc-bn' }, w.bn),
        w.meaning_bn ? h('p', { class: 'small' }, w.meaning_bn) : ''));
  } else {
    const all = (await allPageAI()).flatMap((x) => x.ai.quiz);
    if (!all.length) { body.append(h('p', { class: 'muted center' }, 'আগে কিছু পৃষ্ঠায় "বাংলায় বুঝাও" চাপুন — তারপর এখানে কুইজ জমা হবে।')); return; }
    const pick = all.sort(() => Math.random() - 0.5).slice(0, 10);
    body.append(quizView(pick), h('button', { class: 'btn btn-wide', onclick: () => { root.replaceChildren(); renderRevise(root, 'quiz'); } }, '🔄 নতুন ১০টা প্রশ্ন'));
  }
}

/* ---------- Settings ---------- */
function renderSettings(root: HTMLElement) {
  const keyIn = h('input', { type: 'text', value: settings.apiKey, placeholder: 'AIza…', autocomplete: 'off', spellcheck: false, class: 'input' });
  const keyMsg = h('p', { class: 'small' });
  const rate = h('input', { type: 'range', min: '0.6', max: '1.2', step: '0.05', value: String(settings.rate), oninput: () => { settings.rate = +rate.value; } });
  const fontLabel = h('span', {}, bn(Math.round(settings.fontScale * 100)) + '%');
  const font = (d: number) => { settings.fontScale = Math.min(1.6, Math.max(0.85, +(settings.fontScale + d).toFixed(2))); applyFont(); fontLabel.textContent = bn(Math.round(settings.fontScale * 100)) + '%'; };
  const voiceMsg = h('p', { class: 'small' });
  const checkVoice = () => {
    voiceMsg.textContent = hasBangla() ? '✅ বাংলা ভয়েস আছে।' : '⚠️ বাংলা ভয়েস পাওয়া যায়নি। ফোনের Settings → "Text-to-speech" খুঁজুন → Google Speech Services → ⚙️ → Install voice data → বাংলা (বাংলাদেশ) ডাউনলোড করুন।';
  };
  setTimeout(checkVoice, 500);

  root.append(topbar('সেটিংস'), h('main', { class: 'page' },
    h('section', { class: 'card' },
      h('h3', {}, '🤖 AI (Gemini) — একবারের সেটআপ'),
      h('ol', { class: 'small steps' },
        h('li', {}, h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' খুলুন (Google অ্যাকাউন্ট দিয়ে)'),
        h('li', {}, '"Create API key" চাপুন — এটা ফ্রি'),
        h('li', {}, 'key টা কপি করে নিচে বসান → "সেভ ও পরীক্ষা"')),
      keyIn,
      h('button', { class: 'btn btn-wide', onclick: async () => {
        settings.apiKey = keyIn.value;
        settings.model = '';
        keyMsg.textContent = '⏳ পরীক্ষা হচ্ছে…';
        try { keyMsg.textContent = '✅ কাজ করছে! ' + (await testKey()); }
        catch (e) { keyMsg.textContent = '❌ ' + (e instanceof AIError ? e.message : String(e)); }
      } }, 'সেভ ও পরীক্ষা'),
      keyMsg,
      h('p', { class: 'muted small' }, 'নোট: ফ্রি key-তে Google লেখাগুলো দেখতে পারে — তাই শুধু ট্রেনিং ম্যাটেরিয়াল দিন, ব্যক্তিগত কাগজ না।')),
    h('section', { class: 'card' },
      h('h3', {}, '🔤 লেখার সাইজ'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => font(-0.1) }, 'অ ছোট'), fontLabel, h('button', { class: 'btn', onclick: () => font(0.1) }, 'অ বড়'))),
    h('section', { class: 'card' },
      h('h3', {}, '🔊 পড়ে শোনানো'),
      h('label', { class: 'small' }, 'গতি (বামে = আস্তে)'), rate,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => say('আসসালামু আলাইকুম। আমি আপনার পড়ার সাথী।', 'bn') }, 'বাংলা শুনুন'),
        h('button', { class: 'btn', onclick: () => say('Public procurement means procurement with public funds.', 'en') }, 'English শুনুন')),
      voiceMsg),
  ));
}

function topbar(title: string) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'ফিরে যান', onclick: () => (location.hash = '#/') }, '←'),
    h('div', { class: 'top-title' }, title));
}

/* ---------- Router ---------- */
let seq = 0;
async function route() {
  const my = ++seq;
  stopSpeech();
  cleanupReader();
  document.querySelector('.sheet-backdrop')?.remove();
  const view = h('div', { class: 'view' });
  app.replaceChildren(view);
  window.scrollTo({ top: 0 });
  const [, a, b] = (location.hash.slice(1) || '/').split('/');
  try {
    if (a === 'read' && b) await renderReader(view, b);
    else if (a === 'revise') await renderRevise(view);
    else if (a === 'settings') renderSettings(view);
    else await renderHome(view);
  } catch (e) {
    console.error(e);
    if (my === seq) { app.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'error' }, '😕 কিছু একটা সমস্যা হয়েছে।'), h('a', { class: 'btn', href: '#/' }, 'হোমে যান'))); }
  }
}

window.addEventListener('hashchange', route);
checkShared().then((imported) => { if (!imported) route(); });
