import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_SUGGESTED_QUESTIONS,
  AssistantChatTurn,
  buildAssistantHistoryPayload,
  getRiskBadgeClasses,
  parseAssistantMarkdown,
  parseInlineFormatting,
} from './assistantHelpers';

test('ASSISTANT_SUGGESTED_QUESTIONS includes required operational prompts', () => {
  assert.equal(ASSISTANT_SUGGESTED_QUESTIONS.length, 5);
  assert.ok(ASSISTANT_SUGGESTED_QUESTIONS.some((q) => /highest risk/i.test(q)));
  assert.ok(ASSISTANT_SUGGESTED_QUESTIONS.some((q) => /last 7 days/i.test(q)));
  assert.ok(ASSISTANT_SUGGESTED_QUESTIONS.some((q) => /hotspots/i.test(q)));
  assert.ok(ASSISTANT_SUGGESTED_QUESTIONS.some((q) => /high-risk zones/i.test(q)));
  assert.ok(ASSISTANT_SUGGESTED_QUESTIONS.some((q) => /alerts/i.test(q)));
});

test('buildAssistantHistoryPayload excludes error bubbles and enforces bounded history window', () => {
  const turns: AssistantChatTurn[] = [
    { id: '1', role: 'user', content: 'Q1', timestamp: '2026-01-01T00:00:00Z' },
    { id: '2', role: 'assistant', content: 'Error!', timestamp: '2026-01-01T00:00:01Z', isError: true },
    { id: '3', role: 'assistant', content: 'A1', timestamp: '2026-01-01T00:00:02Z' },
    { id: '4', role: 'user', content: 'Q2', timestamp: '2026-01-01T00:00:03Z' },
    { id: '5', role: 'assistant', content: 'A2', timestamp: '2026-01-01T00:00:04Z' },
  ];

  const payload = buildAssistantHistoryPayload(turns, 3);
  assert.deepEqual(payload, [
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'Q2' },
    { role: 'assistant', content: 'A2' },
  ]);
});

test('parseAssistantMarkdown parses headings, lists, tables, and preserves raw text safely', () => {
  const md = [
    '## Top Risk Villages',
    '',
    '| Village | Risk Score | Level |',
    '| --- | --- | --- |',
    '| Kadambur Fringe | 91% | Critical |',
    '| Mangala Colony | 78% | High |',
    '',
    '- Deploy **RRT Unit Alpha** to `Sector 4B`',
    '- Inspect solar fence',
    '',
    '1. First step',
    '2. Second step',
  ].join('\n');

  const blocks = parseAssistantMarkdown(md);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'table');
  if (blocks[1].type === 'table') {
    assert.deepEqual(blocks[1].headers, ['Village', 'Risk Score', 'Level']);
    assert.equal(blocks[1].rows.length, 2);
    assert.equal(blocks[1].rows[0][0], 'Kadambur Fringe');
  }
  assert.equal(blocks[2].type, 'ul');
  assert.equal(blocks[3].type, 'ol');
});

test('parseInlineFormatting splits bold and inline code without interpreting HTML', () => {
  const segments = parseInlineFormatting('Check **Kadambur** at `11.65, 76.62` <script>alert(1)</script>');
  assert.deepEqual(segments, [
    { type: 'text', text: 'Check ' },
    { type: 'bold', text: 'Kadambur' },
    { type: 'text', text: ' at ' },
    { type: 'code', text: '11.65, 76.62' },
    { type: 'text', text: ' <script>alert(1)</script>' },
  ]);
});

test('getRiskBadgeClasses maps severity tiers to distinct styles', () => {
  assert.match(getRiskBadgeClasses('Critical'), /red/);
  assert.match(getRiskBadgeClasses('High'), /orange/);
  assert.match(getRiskBadgeClasses('Moderate'), /amber/);
  assert.match(getRiskBadgeClasses('Low'), /emerald/);
});
