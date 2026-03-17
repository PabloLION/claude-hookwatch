/**
 * Static file handler — serves files from src/ui/.
 *
 * Features:
 *   - Path traversal prevention: resolved path must start with UI_DIR
 *   - .ts files: transpiled on-the-fly via Bun.Transpiler, served as JS
 *   - Transpiler cache: in-memory Map keyed by resolved path, invalidated
 *     when the file's mtime changes
 *   - Other files: served directly with appropriate Content-Type
 *   - Missing files: 404 NOT_FOUND
 *
 * ch-u88: no innerHTML — this handler only returns file bytes or transpiled
 * text, never interpolates path values into HTML.
 */

import { statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { errorMsg } from '@/errors.ts';
import { isErrnoException } from '@/guards.ts';
import { errorResponse } from '@/server/errors.ts';
import { HTTP_OK } from '@/server/http-status.ts';

// Resolve src/ui/ relative to this file's directory (src/server/ → ../ui/)
const UI_DIR = resolve(import.meta.dir, '../ui');

const CONTENT_TYPE_JS = 'application/javascript; charset=utf-8';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': CONTENT_TYPE_JS,
  '.ts': CONTENT_TYPE_JS,
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

const transpiler = new Bun.Transpiler({ loader: 'tsx' });

/**
 * Resolve the URL pathname to a file path inside UI_DIR.
 * Returns null if the path escapes UI_DIR (traversal attack).
 */
function resolveUiPath(pathname: string): string | null {
  // Strip leading slash so resolve() stays inside UI_DIR
  const relative = pathname.replace(/^\//, '');
  const resolved = resolve(UI_DIR, relative);

  // Guard: resolved path must remain inside UI_DIR
  if (!resolved.startsWith(`${UI_DIR}/`) && resolved !== UI_DIR) {
    return null;
  }

  return resolved;
}

/**
 * Serve a single UI file.
 * @param pathname — URL pathname, e.g. "/index.html" or "/app.ts"
 */
export async function handleStatic(pathname: string): Promise<Response> {
  // Default / to index.html
  const normalised = pathname === '/' ? '/index.html' : pathname;

  const filePath = resolveUiPath(normalised);
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
      return errorResponse('NOT_FOUND', `File not found: ${normalised}`);
    }
    process.stderr.write(`[hookwatch] Static file error for ${normalised}: ${errorMsg(err)}\n`);
    return errorResponse('INTERNAL', `Could not read file: ${normalised}`);
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
          `[hookwatch] Static file read error for ${normalised}: ${errorMsg(err)}\n`,
        );
        return errorResponse('INTERNAL', `Could not read file: ${normalised}`);
      }
      let transformed: string;
      try {
        transformed = transpiler.transformSync(source);
      } catch (err) {
        const message = errorMsg(err);
        return errorResponse('INTERNAL', `Failed to transpile ${normalised}: ${message}`);
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
  } catch {
    // TOCTOU: file deleted between statSync and Response construction
    return errorResponse('NOT_FOUND', `File not found: ${normalised}`);
  }
}
