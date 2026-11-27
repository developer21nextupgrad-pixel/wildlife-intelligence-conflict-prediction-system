export interface AssistantMapLocation {
  id: string;
  label: string;
  kind: 'village' | 'risk_zone' | 'incident' | 'sighting' | 'alert' | 'patrol';
  latitude: number;
  longitude: number;
  district?: string | null;
  riskLevel?: string | null;
  riskScore?: number | null;
  subtitle?: string | null;
}

export interface AssistantSourceRecord {
  tool: string;
  label: string;
  recordCount: number;
}

export interface AssistantStatus {
  configured: boolean;
  model: string;
  readOnly: boolean;
  availableTools: string[];
  message: string | null;
}

export interface AssistantChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
  toolsUsed?: string[];
  sources?: AssistantSourceRecord[];
  mapLocations?: AssistantMapLocation[];
  isError?: boolean;
  retryPrompt?: string;
}

export interface AssistantHistoryPayloadItem {
  role: 'user' | 'assistant';
  content: string;
}

export const ASSISTANT_SUGGESTED_QUESTIONS: readonly string[] = [
  'Which villages are at highest risk today?',
  'Show incidents from the last 7 days.',
  'What are the predicted conflict hotspots?',
  'Explain the current high-risk zones.',
  'Which alerts require immediate attention?',
];

export const MAX_ASSISTANT_HISTORY_TURNS = 10;

/**
 * Extracts bounded, non-error session history suitable for sending to the backend assistant.
 */
export function buildAssistantHistoryPayload(
  messages: AssistantChatTurn[],
  maxItems: number = MAX_ASSISTANT_HISTORY_TURNS
): AssistantHistoryPayloadItem[] {
  const valid = messages
    .filter((m) => !m.isError && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, 3800),
    }));
  if (maxItems <= 0) return [];
  return valid.slice(-maxItems);
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

/**
 * Parses assistant Markdown text into safe structured blocks for React rendering (no HTML injection).
 */
export function parseAssistantMarkdown(rawText: string): MarkdownBlock[] {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Markdown table: header row + separator row
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph (merge contiguous non-special lines)
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        /^(#{1,3})\s+/.test(next) ||
        /^[-*•]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        (next.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}

export type InlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string };

/**
 * Splits inline bold (**text**) and inline code (`code`) into safe renderable segments.
 */
export function parseInlineFormatting(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: text.slice(lastIdx, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      segments.push({ type: 'bold', text: token.slice(2, -2) });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      segments.push({ type: 'code', text: token.slice(1, -1) });
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIdx) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
}

export function getRiskBadgeClasses(riskLevel?: string | null): string {
  const norm = (riskLevel || '').trim().toLowerCase();
  if (norm === 'critical') {
    return 'bg-red-500/15 text-red-300 border-red-500/40';
  }
  if (norm === 'high') {
    return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  }
  if (norm === 'moderate' || norm === 'medium') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  }
  return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
}
