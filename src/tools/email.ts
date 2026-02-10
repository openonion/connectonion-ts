/**
 * @purpose Mock email tools for testing: write/read JSONL under ~/.connectonion/mock_email for demos and tests
 * @llm-note
 *   Dependencies: imports from [fs, os, path (Node.js built-ins)] | imported by [src/index.ts, tests/e2e/emailTools.test.ts] | tested by [tests/e2e/emailTools.test.ts]
 *   Data flow: sendEmail(to, subject, body) → generates id, timestamp → appends JSONL to ~/.connectonion/mock_email/emails.jsonl | getEmails(recipient?) → reads JSONL → parses entries → returns EmailEntry[]
 *   State/Effects: writes to ~/.connectonion/mock_email/emails.jsonl | creates directory if missing | appends to file without locking | reads entire file on getEmails() | markRead() rewrites entire file
 *   Integration: exposes sendEmail(to, subject, body), getEmails(recipient?), markRead(id), EmailEntry type | server-only utilities (uses fs) | CONNECTONION_HOME env var for base directory override
 *   Performance: synchronous fs operations | no file locking | reads entire file into memory | markRead() rewrites entire file (not scalable for large inboxes)
 *   Errors: throws on fs errors (ENOENT, EACCES) | invalid JSONL lines cause JSON.parse to throw | no error handling (fails fast)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type EmailEntry = {
  id: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  read?: boolean;
};

function emailDir(): string {
  const base = process.env.CONNECTONION_HOME || path.join(os.homedir(), '.connectonion');
  const dir = path.join(base, 'mock_email');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function emailFile(): string {
  return path.join(emailDir(), 'emails.jsonl');
}

export function sendEmail(to: string, subject: string, body: string = ''): string {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const entry: EmailEntry = { id, to, subject, body, timestamp: new Date().toISOString(), read: false };
  fs.appendFileSync(emailFile(), JSON.stringify(entry) + '\n', 'utf-8');
  return `queued:${id}`;
}

export function getEmails(recipient?: string): EmailEntry[] {
  const file = emailFile();
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file, 'utf-8');
  const lines = data.split(/\r?\n/).filter(Boolean);
  const items = lines.map(l => JSON.parse(l) as EmailEntry);
  return recipient ? items.filter(e => e.to === recipient) : items;
}

export function markRead(id: string): string {
  const file = emailFile();
  if (!fs.existsSync(file)) return 'not_found';
  const data = fs.readFileSync(file, 'utf-8');
  const lines = data.split(/\r?\n/).filter(Boolean);
  const items = lines.map(l => JSON.parse(l) as EmailEntry);
  let changed = false;
  const updated = items.map(e => {
    if (e.id === id) { e.read = true; changed = true; }
    return e;
  });
  if (!changed) return 'not_found';
  // rewrite file
  const out = updated.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(file, out, 'utf-8');
  return 'ok';
}
