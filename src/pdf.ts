import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

export const openPdf = (data: ArrayBuffer) =>
  pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;

const JUNK_LINE = [
  /^©/,
  /Training on Basic Public Procurement Management$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  /^\d{1,3}$/,
  /^M\d+\.\d+$/,
];

/** PDF-এর text থেকে পড়ার মতো লাইন বানায় (header/footer বাদ দিয়ে) */
export function textLines(items: any[]): string[] {
  const its = (items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim());
  type L = { y: number; parts: { x: number; w: number; s: string }[] };
  const lines: L[] = [];
  for (const it of its) {
    const x = it.transform[4], y = it.transform[5];
    const tol = Math.max(2, Math.abs(it.transform[3]) * 0.4);
    let line = lines.find((l) => Math.abs(l.y - y) < tol);
    if (!line) lines.push((line = { y, parts: [] }));
    line.parts.push({ x, w: it.width, s: it.str });
  }
  lines.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let s = '', end = -1e9;
    for (const p of l.parts) {
      if (s && p.x - end > 1.5 && !s.endsWith(' ') && !p.s.startsWith(' ')) s += p.x - end > 40 ? '   ' : ' ';
      s += p.s;
      end = p.x + p.w;
    }
    s = s
      .replace(/[-▪■•§]/g, ' ')
      .replace(/Session:\s*M[\d.]+/gi, ' ')
      .replace(/Slide No\.?\s*\d+\s*\/\s*\d+/gi, ' ')
      .replace(/\s{4,}/g, '   ')
      .trim();
    if (!s || JUNK_LINE.some((r) => r.test(s))) continue;
    // ভাঙা লাইন জোড়া লাগানো: আগের লাইন বাক্য শেষ না হলে আর এই লাইন ছোট হাতের অক্ষরে শুরু হলে
    const prev = out[out.length - 1];
    if (prev && !/[.:?!;’'"]$/.test(prev) && /^[a-z(]/.test(s)) out[out.length - 1] = prev + ' ' + s;
    else out.push(s);
  }
  return out;
}
