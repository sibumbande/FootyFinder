/**
 * CEO Q1: the Terms of Service get their own page with a clickable contents list and anchors
 * (/legal/terms#clause-8). The published text (docs/legal/TERMS_OF_SERVICE.md) uses a small,
 * safe subset of Markdown, parsed here into blocks; nothing is ever rendered as raw HTML.
 * - "## 8. Privacy Notice" -> a clause heading with the anchor "clause-8"
 * - "### What we collect" -> a sub-heading ("## Annexure A ..." gets the anchor "annexure-a")
 * - "**8.3 Other users.** ..." -> a paragraph with the anchor "clause-8-3"
 * - "> ..." lines -> one shaded box (the CPA s49 / liability notices)
 * - "- ..." lines -> a bullet list; "| a | b |" lines -> a table
 * Inline: **bold** and [text](#anchor) links to anchors on the same page only.
 */
export type InlinePart = { kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; anchor: string };
export type TermsBlock =
  | { kind: 'title'; text: string }
  | { kind: 'clause'; id: string; number: string; text: string }
  | { kind: 'subheading'; id?: string; text: string }
  | { kind: 'paragraph'; id?: string; parts: InlinePart[] }
  | { kind: 'box'; paragraphs: InlinePart[][] }
  | { kind: 'list'; items: InlinePart[][] }
  | { kind: 'table'; rows: InlinePart[][][] };

export const clauseAnchor = (number: string) => `clause-${number.replace('.', '-')}`;

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(#([a-z0-9-]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] });
    else parts.push({ kind: 'link', text: match[2]!, anchor: match[3]! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

const tableCells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => parseInline(cell.trim()));

export function parseTerms(source: string): TermsBlock[] {
  const blocks: TermsBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trimEnd();
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const clause = /^## (\d+)\.\s+(.+)$/.exec(line);
    if (line.startsWith('# ')) blocks.push({ kind: 'title', text: line.slice(2).trim() });
    else if (clause) blocks.push({ kind: 'clause', id: clauseAnchor(clause[1]!), number: clause[1]!, text: clause[2]!.trim() });
    else if (line.startsWith('## ') || line.startsWith('### ')) {
      const text = line.replace(/^#+\s+/, '');
      const annexure = /^Annexure ([A-Z])\b/.exec(text);
      blocks.push({ kind: 'subheading', ...(annexure ? { id: `annexure-${annexure[1]!.toLowerCase()}` } : {}), text });
    }
    else if (line.startsWith('>')) {
      const paragraphs: InlinePart[][] = [];
      let current: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('>')) {
        const text = lines[index]!.replace(/^>\s?/, '').trim();
        if (!text && current.length) {
          paragraphs.push(parseInline(current.join(' ')));
          current = [];
        } else if (text) current.push(text);
        index += 1;
      }
      if (current.length) paragraphs.push(parseInline(current.join(' ')));
      blocks.push({ kind: 'box', paragraphs });
      continue;
    } else if (/^- /.test(line)) {
      const items: InlinePart[][] = [];
      while (index < lines.length && /^- /.test(lines[index]!)) {
        items.push(parseInline(lines[index]!.slice(2).trim()));
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    } else if (line.startsWith('|')) {
      const rows: InlinePart[][][] = [];
      while (index < lines.length && lines[index]!.startsWith('|')) {
        if (!/^\|[\s:-]+(\|[\s:-]+)*\|?$/.test(lines[index]!.trim())) rows.push(tableCells(lines[index]!));
        index += 1;
      }
      blocks.push({ kind: 'table', rows });
      continue;
    } else {
      const subclause = /^\*\*(\d+\.\d+)\s/.exec(line);
      blocks.push({ kind: 'paragraph', ...(subclause ? { id: clauseAnchor(subclause[1]!) } : {}), parts: parseInline(line.trim()) });
    }
    index += 1;
  }
  return blocks;
}
