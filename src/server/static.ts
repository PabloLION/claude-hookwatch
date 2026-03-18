/**
 * Static file handler — serves UI assets from src/ui/ and shared source
 * modules from src/ (via the /@/ URL prefix).
 *
 * Features:
 *   - Path traversal prevention: resolved path must stay inside its base dir
 *   - /@/* routes: shared source modules for browser (import map maps @/ → /@/)
 *   - .ts files: transpiled on-the-fly via Bun.Transpiler, served as JS
 *   - Transpiler cache: in-memory Map keyed by resolved path, invalidated
 *     when the file's mtime changes
 *   - Other files: served directly with appropriate Content-Type
 *   - Missing files: 404 NOT_FOUND
 *
 * No innerHTML — this handler only returns file bytes or transpiled
 * text, never interpolates path values into HTML.
 */

import { statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { errorMsg } from '@/errors.ts';
import { isErrnoException } from '@/guards.ts';
import { errorResponse } from '@/server/errors.ts';
import { HTTP_OK } from '@/server/http-status.ts';

// Resolve src/ui/ and src/ relative to this file's directory (src/server/)
const UI_DIR = resolve(import.meta.dir, '../ui');
const SRC_DIR = resolve(import.meta.dir, '..');

const CONTENT_TYPE_JS = 'application/javascript; charset=utf-8';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': CONTENT_TYPE_JS,
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface CacheEntry {
  readonly mtime: number;
  readonly content: string;
}

// In-memory transpile cache — keyed by resolved file path
const transpileCache = new Map<string, CacheEntry>();

// tsx loader handles both .ts and .tsx — superset of ts loader
const transpiler = new Bun.Transpiler({ loader: 'tsx' });

/**
 * Resolve a URL pathname to a file path inside baseDir.
 * Returns null if the path escapes baseDir (traversal attack).
 */
function resolveSafePath(baseDir: string, pathname: string): string | null {
  // Null byte in path is always invalid — reject before any filesystem call
  if (pathname.includes('\0')) return null;

  // Strip leading slash so resolve() stays inside baseDir
  const relative = pathname.replace(/^\//, '');
  const resolved = resolve(baseDir, relative);

  // Guard: resolved path must remain inside baseDir
  if (!resolved.startsWith(`${baseDir}/`) && resolved !== baseDir) {
    return null;
  }

  return resolved;
}

/**
 * Serve a single UI file.
 * @param pathname — URL pathname, e.g. "/index.html" or "/app.ts"
 */
export async function handleStatic(pathname: string): Promise<Response> {
  // Normalize early: default / to index.html, resolve /@/ prefix for shared source modules
  const normalized = pathname === '/' ? '/index.html' : pathname;

  let filePath: string | null;
  if (normalized.startsWith('/@/')) {
    // Shared source modules requested by browser via import map (@/ → /@/).
    // normalized.slice(2) turns "/@/schemas/rows.ts" → "/schemas/rows.ts".
    filePath = resolveSafePath(SRC_DIR, normalized.slice(2));
  } else {
    filePath = resolveSafePath(UI_DIR, normalized);
  }

  if (filePath === null) {
    return errorResponse('NOT_FOUND', 'Path not allowed');
  }

  // Check file existence
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch (err) {
    // ENOENT is the normal "file not found" case — return 404.
    // All other errors (EACCES, EIO, etc.) indicate a real problem — log and return 500.
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return errorResponse('NOT_FOUND', `File not found: ${normalized}`);
    }
    process.stderr.write(`[hookwatch] Static file error for ${normalized}: ${errorMsg(err)}\n`);
    return errorResponse('INTERNAL', `Could not read file: ${normalized}`);
  }

  const mtime = stat.mtimeMs;
  const ext = extname(filePath);

  // TypeScript files — transpile and cache
  if (ext === '.ts' || ext === '.tsx') {
    const cached = transpileCache.get(filePath);
    let content: string;

    if (cached !== undefined && cached.mtime === mtime) {
      content = cached.content;
    } else {
      const tsFile = Bun.file(filePath);
      let source: string;
      try {
        source = await tsFile.text();
      } catch (err) {
        process.stderr.write(
          `[hookwatch] Static file read error for ${normalized}: ${errorMsg(err)}\n`,
        );
        return errorResponse('INTERNAL', `Could not read file: ${normalized}`);
      }
      let transformed: string;
      try {
        transformed = transpiler.transformSync(source);
      } catch (err) {
        const message = errorMsg(err);
        process.stderr.write(`[hookwatch] Transpile error for ${normalized}: ${message}\n`);
        return errorResponse('INTERNAL', `Failed to transpile ${normalized}: ${message}`);
      }
      content = transformed;
      transpileCache.set(filePath, { mtime, content });
    }

    return new Response(content, {
      status: HTTP_OK,
      headers: { 'Content-Type': CONTENT_TYPE_JS },
    });
  }

  // All other files — serve directly
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const file = Bun.file(filePath);
  try {
    return new Response(file, {
      status: HTTP_OK,
      headers: { 'Content-Type': contentType },
    });
  } catch (err) {
    // Last-resort backstop: Bun.file() + new Response() are deferred I/O (no
    // read at construction), so filesystem errors surface during response
    // streaming (caught by Bun.serve error handler). This catch guards against
    // any synchronous Bun internal error during Response construction.
    process.stderr.write(
      `[hookwatch] Response construction error for ${normalized}: ${errorMsg(err)}\n`,
    );
    return errorResponse('INTERNAL', `Could not serve file: ${normalized}`);
  }
}
