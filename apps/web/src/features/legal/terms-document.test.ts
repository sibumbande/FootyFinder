import { describe, expect, it } from 'vitest';
import { clauseAnchor, parseInline, parseTerms } from './terms-document.js';

describe('Terms page parser (CEO Q1)', () => {
  it('anchors clauses and sub-clauses so the footer can link to #clause-8 and #clause-9', () => {
    const blocks = parseTerms('## 8. Privacy Notice\n\n**8.3 Other users.** They see your name.\n\n## 9. Assumption of Risk');
    expect(blocks[0]).toEqual({ kind: 'clause', id: 'clause-8', number: '8', text: 'Privacy Notice' });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', id: 'clause-8-3' });
    expect(blocks[2]).toMatchObject({ kind: 'clause', id: 'clause-9' });
    expect(clauseAnchor('14.2')).toBe('clause-14-2');
  });

  it('groups shaded boxes, lists and tables, and skips table separator rows', () => {
    const blocks = parseTerms('> **ATTENTION**\n> line one\n>\n> line two\n\n- a\n- b\n\n| Data | Kept |\n|---|---|\n| Chat | 12 months |');
    expect(blocks[0]).toMatchObject({ kind: 'box', paragraphs: [[{ kind: 'bold', text: 'ATTENTION' }, { kind: 'text', text: ' line one' }], [{ kind: 'text', text: 'line two' }]] });
    expect(blocks[1]).toMatchObject({ kind: 'list', items: [[{ text: 'a' }], [{ text: 'b' }]] });
    expect(blocks[2]).toMatchObject({ kind: 'table', rows: [[[{ text: 'Data' }], [{ text: 'Kept' }]], [[{ text: 'Chat' }], [{ text: '12 months' }]]] });
  });

  it('only links to anchors on the same page and never passes raw HTML through', () => {
    expect(parseInline('See [clause 9](#clause-9) and **this**.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'clause 9', anchor: 'clause-9' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'this' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('[evil](https://example.com) <script>x</script>')).toEqual([
      { kind: 'text', text: '[evil](https://example.com) <script>x</script>' },
    ]);
  });
});
