// Markdown pequeno e seguro para as respostas do agente. Gera elementos React,
// nunca HTML cru: a resposta pode citar texto raspado de sites de terceiros.
// Cobre o que o agente usa: parágrafos, títulos, listas, tabelas, código,
// **negrito**, *itálico*, `código` e links http(s).

import type { ReactNode } from 'react';

export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text)}</div>;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) code.push(lines[i]!);
      i++;
      out.push(<pre key={out.length}><code>{code.join('\n')}</code></pre>);
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const header = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(cells(lines[i]!));
      out.push(
        <div className="md-table" key={out.length}>
          <table>
            <thead><tr>{header.map((h, k) => <th key={k}>{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k}>{header.map((_, c) => <td key={c}>{inline(r[c] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (/^#{1,4}\s/.test(line)) {
      out.push(<p className="md-h" key={out.length}>{inline(line.replace(/^#+\s/, ''))}</p>);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]!); i++) items.push(lines[i]!.replace(/^\s*([-*]|\d+\.)\s/, ''));
      const list = items.map((it, k) => <li key={k}>{inline(it)}</li>);
      out.push(ordered ? <ol key={out.length}>{list}</ol> : <ul key={out.length}>{list}</ul>);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i]!.trim() !== '' && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]!); i++) para.push(lines[i]!);
      if (para.length === 0) para.push(lines[i++]!);
      out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
    }
  }
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, k) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={k} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    return part;
  });
}
