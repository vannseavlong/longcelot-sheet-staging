import fs from 'fs';
import { RESERVED_COLUMN_NAMES } from '../schema/reservedColumns';

export type MutationResult = { ok: true } | { ok: false; reason: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Checks that every bracket opened on this line is closed on this line, in order. */
function isBalanced(line: string): boolean {
  const stack: string[] = [];
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const ch of line) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== closers[ch]) return false;
    }
  }
  return stack.length === 0;
}

function isReserved(name: string): boolean {
  return (RESERVED_COLUMN_NAMES as readonly string[]).includes(name);
}

function findKeyLine(lines: string[], columnName: string): { index: number; count: number } {
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s*:`);
  const matches: number[] = [];
  lines.forEach((line, i) => {
    if (keyPattern.test(line)) matches.push(i);
  });
  return { index: matches[0] ?? -1, count: matches.length };
}

/**
 * Removes a single-line `columnName: builder()...,` entry from a schema file's `columns` block.
 * Only ever removes a line it can confirm is a complete, self-contained property (balanced
 * brackets, and either a trailing comma or it's the last property before the closing `}`) —
 * anything it can't confirm returns `ok: false` instead of guessing and corrupting the file.
 */
export function removeColumnLine(filePath: string, columnName: string): MutationResult {
  if (isReserved(columnName)) {
    return { ok: false, reason: `'${columnName}' is a reserved auto-generated column and cannot be dropped` };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, reason: `Could not read schema file: ${filePath}` };
  }

  const lines = content.split('\n');
  const { index, count } = findKeyLine(lines, columnName);

  if (count === 0) {
    return { ok: false, reason: `Column '${columnName}' not found in ${filePath}` };
  }
  if (count > 1) {
    return { ok: false, reason: `Column '${columnName}' matched ${count} lines in ${filePath} — edit manually` };
  }

  const trimmed = lines[index].trim();
  const endsWithComma = /,\s*(\/\/.*)?$/.test(trimmed);
  const nextNonEmpty = lines.slice(index + 1).find((l) => l.trim().length > 0);
  const isLastProperty = !!nextNonEmpty && /^\s*\}/.test(nextNonEmpty);

  if (!isBalanced(trimmed) || !(endsWithComma || isLastProperty)) {
    return {
      ok: false,
      reason: `Column '${columnName}' definition in ${filePath} spans multiple lines — remove it manually`,
    };
  }

  lines.splice(index, 1);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return { ok: true };
}

/**
 * Renames the object key of a `columns` entry in place, leaving everything else on/after that
 * line untouched. Safe even for multi-line column definitions — only the key text on the
 * opening line changes, nothing is deleted or re-parsed.
 */
export function renameColumnKey(filePath: string, oldName: string, newName: string): MutationResult {
  if (isReserved(oldName)) {
    return { ok: false, reason: `'${oldName}' is a reserved auto-generated column and cannot be renamed` };
  }
  if (isReserved(newName)) {
    return { ok: false, reason: `'${newName}' is a reserved column name and cannot be used` };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, reason: `Could not read schema file: ${filePath}` };
  }

  const lines = content.split('\n');
  const { index, count } = findKeyLine(lines, oldName);

  if (count === 0) {
    return { ok: false, reason: `Column '${oldName}' not found in ${filePath}` };
  }
  if (count > 1) {
    return { ok: false, reason: `Column '${oldName}' matched ${count} lines in ${filePath} — edit manually` };
  }

  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(oldName)}(\\s*:)`);
  lines[index] = lines[index].replace(keyPattern, `$1${newName}$2`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return { ok: true };
}
