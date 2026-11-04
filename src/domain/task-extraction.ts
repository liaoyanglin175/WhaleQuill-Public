export type TaskCandidate = { title: string; line: number };

// Explicit checkboxes / action markers only. Never turn arbitrary prose into commitments.
export function extractTaskCandidates(body: string): TaskCandidate[] {
  const seen = new Set<string>();
  return body.split(/\r?\n/).flatMap((text, index) => {
    const match = text.match(/^\s*(?:[-*+]\s*\[ \]\s*|(?:[-*+]\s*)?(?:待办|下周任务|明日任务|下一步|TODO|任务)\s*[:：]\s*)(.+)$/i);
    const title = match?.[1].trim();
    if (!title || seen.has(title)) return [];
    seen.add(title);
    return [{ title, line: index + 1 }];
  }).slice(0, 30);
}

export function markdownDocument(title: string, body: string, tags: string[]): string {
  return `# ${title.trim() || '未命名记录'}\n\n${tags.length ? `标签：${tags.join('、')}\n\n` : ''}${body}\n`;
}

export function markdownFilename(title: string): string {
  let name = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '未命名记录';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.md`;
}
