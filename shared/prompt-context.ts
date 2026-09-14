import type { ContextEntry, PromptContext } from './types';
/** 生成 @ 文件或 / 技能的内联文本，对包含空格的名称保留可解析边界。 */
export function referenceText(kind: '@' | '/', value: string) {
  return kind + (/\s|["\\]/.test(value) ? JSON.stringify(value) : value);
}
/** 根据当前文字保留仍存在的引用，避免删掉文字后继续隐式携带旧上下文。 */
export function contextInText(
  text: string,
  context: PromptContext,
  skills: Pick<ContextEntry, 'id' | 'name'>[],
): PromptContext {
  const tokens: { kind: string; value: string }[] = [];
  for (const match of text.matchAll(/(?:^|\s)([@/])("(?:\\.|[^"\\])*"|[^\s]+)/gu)) {
    try {
      tokens.push({
        kind: match[1],
        value: match[2].startsWith('"') ? JSON.parse(match[2]) : match[2],
      });
    } catch {
      /* An unfinished quoted reference is ordinary input. */
    }
  }
  return {
    ...context,
    inline: true,
    references: context.references.filter((path) =>
      tokens.some((t) => t.kind === '@' && t.value === path),
    ),
    skills: context.skills.filter((id) => {
      const skill = skills.find((s) => s.id === id);
      return skill && tokens.some((t) => t.kind === '/' && t.value === skill.name);
    }),
  };
}
