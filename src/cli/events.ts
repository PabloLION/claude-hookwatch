/**
 * Shared event type definitions for the hookwatch CLI.
 *
 * Kept in a separate file so tests can import EVENT_TYPES without triggering
 * the citty runMain() call in index.ts.
 *
 * EVENT_TYPES is derived from EVENT_NAMES in src/types.ts — single source of
 * truth. Adding a new event type requires editing only src/types.ts.
 */

import { EVENT_NAMES } from "@/types.ts";

/** All 18 PascalCase event types that hookwatch handles. Same set as EVENT_NAMES. */
export const EVENT_TYPES = EVENT_NAMES;

export type EventType = (typeof EVENT_TYPES)[number];

/** Set for O(1) lookup. */
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
