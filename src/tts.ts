import { settings } from './store';

let voices: SpeechSynthesisVoice[] = [];
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
function load() { if (synth) voices = synth.getVoices(); }
load();
synth?.addEventListener?.('voiceschanged', load);

export const ttsSupported = () => !!synth;
export const hasBangla = () => { load(); return voices.some((v) => v.lang.toLowerCase().replace('_', '-').startsWith('bn')); };

function pickVoice(lang: 'bn' | 'en') {
  load();
  const L = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
  if (lang === 'bn') return voices.find((v) => L(v) === 'bn-bd') ?? voices.find((v) => L(v).startsWith('bn'));
  return voices.find((v) => L(v) === 'en-us' && /google/i.test(v.name)) ?? voices.find((v) => L(v) === 'en-us') ?? voices.find((v) => L(v).startsWith('en'));
}

function chunks(text: string): string[] {
  const parts = text.replace(/\s+/g, ' ').split(/(?<=[।.!?;:])\s+|\n+/);
  const out: string[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    if (out.length && (out[out.length - 1] + ' ' + p).length < 180) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

let token = 0;
export function stop() { token++; synth?.cancel(); }

/** কয়েকটা অংশ পরপর পড়ে; শেষ হলে onEnd */
export function speak(segments: { text: string; lang: 'bn' | 'en' }[], onEnd?: () => void) {
  if (!synth) { onEnd?.(); return; }
  stop();
  const my = token;
  const queue = segments.flatMap((s) => chunks(s.text).map((t) => ({ t, lang: s.lang })));
  let i = 0;
  const next = () => {
    if (my !== token) return;
    if (i >= queue.length) { onEnd?.(); return; }
    const { t, lang } = queue[i++];
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.rate = lang === 'en' ? Math.min(settings.rate, 0.9) : settings.rate;
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  next();
}

export const say = (text: string, lang: 'bn' | 'en', onEnd?: () => void) => speak([{ text, lang }], onEnd);
