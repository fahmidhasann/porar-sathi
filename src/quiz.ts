import type { QuizItem } from './store';
import { h, bn } from './util';

export function quizView(items: QuizItem[]) {
  let answered = 0, correct = 0;
  const score = h('div', { class: 'score' });
  const upd = () => {
    score.textContent = answered === items.length
      ? (correct * 2 >= items.length ? '🎉' : '👍') + ` শেষ! ${bn(items.length)}টার মধ্যে ${bn(correct)}টা সঠিক।` +
        (correct === items.length ? ' দারুণ!' : correct * 2 < items.length ? ' আরেকবার পড়ে দেখুন।' : '')
      : `সঠিক: ${bn(correct)} / ${bn(items.length)}`;
  };
  upd();
  return h('div', { class: 'quiz' }, score,
    ...items.map((q, qi) => {
      const why = h('p', { class: 'why', hidden: true });
      const opts = q.options_bn.map((o, oi) =>
        h('button', { class: 'opt', onclick: () => {
          opts.forEach((b, bi) => { b.disabled = true; if (bi === q.answer_index) b.classList.add('right'); });
          if (oi === q.answer_index) { correct++; why.textContent = '✅ ঠিক! ' + q.why_bn; }
          else { opts[oi].classList.add('wrong'); why.textContent = '❌ সঠিক উত্তর: ' + q.options_bn[q.answer_index] + '। ' + q.why_bn; }
          why.hidden = false; answered++; upd();
        } }, o));
      return h('div', { class: 'card q' }, h('div', { class: 'q-no' }, `প্রশ্ন ${bn(qi + 1)}`), h('p', { class: 'q-text' }, q.question_bn), ...opts, why);
    }));
}
