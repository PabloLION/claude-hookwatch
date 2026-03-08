/**
 * Shared html tagged template literal.
 *
 * Binds htm to Preact's h() once and exports the result so every UI component
 * can import `html` directly instead of repeating `htm.bind(h)` in each file.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import htm from "htm";
import { h } from "preact";

export const html = htm.bind(h);
