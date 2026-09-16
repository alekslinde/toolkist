import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// This repo is public. These checks match *shapes* rather than a list of
// specific strings: an explicit denylist would collect the very values it
// exists to keep out, and would go stale the moment a new one appeared.
//
// Scope is tracked files only — anything git ignores never reaches a reader.

const ROOT = join(import.meta.dirname, '../..');

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

// Vendored bundles and lockfiles are third-party text we do not author; they
// produce only false positives here.
const EXCLUDED = [
  /^package-lock\.json$/,
  /\.min\.(js|css)$/,
  /^public\/heic2any/,
  /^src\/lib\/repo-hygiene\.test\.ts$/,
];

function auditable(): { path: string; text: string }[] {
  return trackedFiles()
    .filter(p => !EXCLUDED.some(re => re.test(p)))
    .map(p => {
      try {
        return { path: p, text: readFileSync(join(ROOT, p), 'utf8') };
      } catch {
        return { path: p, text: '' };
      }
    })
    .filter(f => f.text && !f.text.includes('\0'));
}

function hits(re: RegExp): string[] {
  const found: string[] = [];
  for (const { path, text } of auditable()) {
    for (const line of text.split('\n')) {
      if (re.test(line)) found.push(`${path}: ${line.trim().slice(0, 120)}`);
    }
  }
  return found;
}

describe('public repo hygiene', () => {
  it('contains no home-directory paths', () => {
    // A developer's own machine layout, and the account name embedded in it.
    expect(hits(/(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/)).toEqual([]);
  });

  it('contains no assigned credential values', () => {
    // Matches a key/secret/token NAME assigned a literal value. A bare mention
    // of a variable name is fine — documenting that one exists discloses
    // nothing, whereas its value discloses everything.
    const re = /\b(?:api[_-]?key|secret|token|password|passwd|bearer)\b\s*[:=]\s*["'][^"'$\s{}]{12,}["']/i;
    expect(hits(re)).toEqual([]);
  });

  it('contains no private key blocks', () => {
    expect(hits(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/)).toEqual([]);
  });

  it('contains no bare IPv4 addresses outside documentation ranges', () => {
    // 0.x, 127.x and the RFC 5737 doc ranges are safe to write down.
    const found = hits(/\b(?:\d{1,3}\.){3}\d{1,3}\b/).filter(h => {
      const m = h.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (!m) return false;
      const ip = m[0];
      if (ip.split('.').some(o => Number(o) > 255)) return false; // version string
      return !/^(?:0\.|127\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip);
    });
    expect(found).toEqual([]);
  });
});
