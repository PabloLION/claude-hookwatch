---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - planning-artifacts/prd.md
  - planning-artifacts/architecture.md
---

# hookwatch - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for hookwatch, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- **FR1**: Handler can receive and process all 18 Claude Code hook event types
- **FR2**: Handler can validate each event's stdin payload against a schema
- **FR3**: Handler can accept and store unknown/future event types without error
- **FR4**: Handler can send captured events to the Bun server for storage
- **FR5**: Handler can complete processing without blocking the Claude Code agent
- **FR6**: System can store validated event data in a local SQLite database
- **FR7**: System can support concurrent reads and writes to the database
- **FR8**: System can persist data across Bun server restarts
- **FR9**: System can create the database file with owner-only permissions
- **FR10**: Developer can view a chronological list of hook events
- **FR11**: Developer can filter events by session ID
- **FR12**: Developer can view the full stdin payload of any event
- **FR13**: Developer can view tool name and tool input for tool-related events
- **FR14**: Developer can view wrap command I/O (stdin/stdout/stderr) captured by `hookwatch wrap`
- **FR15**: Developer can manually start the Bun server via `hookwatch open`
- **FR16**: Developer can open the web UI in their default browser via `hookwatch open`
- **FR17**: Developer can wrap any command to capture its stdin, stdout, and stderr
- **FR18**: System can forward captured I/O to the Bun server for storage
- **FR19**: System can forward wrapped command's I/O to original destinations (passthrough)
- **FR20**: Handler can auto-start the Bun server on first hook invocation if not running
- **FR21**: Bun server can self-terminate after a configurable idle timeout
- **FR22**: Bun server can serve the web UI over HTTP on localhost
- **FR23**: Bun server can accept events from the hook handler
- **FR24**: Developer can install hookwatch-hooks via `claude plugin install`
- **FR25**: Developer can uninstall hookwatch-hooks cleanly with no leftover files
- **FR26**: Plugin can register hook handlers for all 18 event types via hooks.json
- **FR27**: Handler can output system messages to Claude Code via hook stdout
- **FR28**: Each injected message can identify its source hook and event type

### Non-Functional Requirements

- **NFR1**: Hook handler completes in <100ms amortized with warm Bun server
- **NFR2**: Hook handler cold path (Bun server not running) completes auto-start + event delivery without blocking the agent
- **NFR3**: Web UI renders event list without perceptible delay for up to 10,000 events
- **NFR4**: No transpilation or build step in the hook handler path
- **NFR5**: Hook handler never crashes — all errors caught and logged, never propagated to Claude Code
- **NFR6**: Hook handler never blocks — if Bun server is unreachable, event is dropped with exit 1 (non-blocking error, surfacing strategy TBD ch-cs6)
- **NFR7**: Zero data loss under normal operation (Bun server running, disk available)
- **NFR8**: Bun server recovers gracefully from unexpected termination — no corrupted database (SQLite WAL mode)
- **NFR9**: Database file created with `0600` permissions (owner read/write only)
- **NFR10**: Bun server listens on localhost only — no network exposure
- **NFR11**: No secrets or credentials in hookwatch's own configuration or logs
- **NFR12**: Forward-compatible with Claude Code hook stdin schema changes — unknown fields preserved, never rejected
- **NFR13**: Plugin installs and uninstalls cleanly via `claude plugin install/uninstall` with no leftover files or broken hooks
- **NFR14**: No external runtime dependencies beyond Bun (no npm install, no Python, no native modules)

### Additional Requirements

- No starter template — manual `bun init`, project is ~10 source files
- Implementation sequence: SQLite → Handler + Zod → Server + query → SSE → Web UI → CLI → Plugin manifest
- Security rules for AGENTS.md: parameterized SQL only (ch-lar), no innerHTML (ch-u88)
- UI delivery: Bun.Transpiler on-the-fly, no .js on disk, in-memory Map cache
- Distribution: npm-only (`npm install -g hookwatch` → `hookwatch install`)
- Naming conventions: snake_case db/API, kebab-case files, camelCase code
- CLI framework: citty (install, uninstall, open, wrap)
- Single package: hookwatch-hooks (v0) + hookwatch-skills (v1) in one repo
- Config paths: XDG (`~/.config/hookwatch/`, `~/.local/share/hookwatch/`)
- 5 security vectors evaluated: 2 mitigated by design, 3 deferred
- Bidirectional Zod validation: stdin (Claude Code → hook) and stdout (hook → Claude Code)
- Cross-component dependencies: Web UI → query endpoint → SQLite; SSE → server + signals → Preact; Handler → server → SQLite; CLI install → plugin manifest generation

### FR Coverage Map

```csv
FR,Epic,Description
FR1,Epic 1,Receive all 18 event types
FR2,Epic 1,Validate stdin payload via Zod
FR3,Epic 1,Accept unknown/future event types
FR4,Epic 1,POST events to Bun server
FR5,Epic 1,Non-blocking processing
FR6,Epic 1,SQLite storage
FR7,Epic 1,Concurrent reads/writes (WAL)
FR8,Epic 1,Persist across server restarts
FR9,Epic 1,0600 database permissions
FR10,Epic 2,Chronological event list
FR11,Epic 2,Session ID filter
FR12,Epic 2,Full stdin payload view
FR13,Epic 2,Tool name + tool input view
FR14,Epic 3,Wrap I/O viewer
FR15,Epic 2,Manual server start (hookwatch open)
FR16,Epic 2,Open browser (hookwatch open)
FR17,Epic 3,Wrap any command
FR18,Epic 3,Forward captured I/O to server
FR19,Epic 3,Passthrough to original destinations
FR20,Epic 1,Auto-start server on first hook
FR21,Epic 2,Idle timeout
FR22,Epic 2,Serve web UI on localhost
FR23,Epic 1,Accept events from handler
FR24,Epic 1,Install via claude plugin install
FR25,Epic 1,Clean uninstall
FR26,Epic 1,Register 18 event types in hooks.json
FR27,Epic 4,Output system messages via stdout
FR28,Epic 4,Identify source hook + event type
```

## Epic List

### Epic 1: Install & Capture Events

Developer installs hookwatch and all 18 hook event types flow into SQLite
storage. Verifiable immediately via server logs or direct database query.

**FRs covered:** FR1-9, FR20, FR23-26
**NFRs addressed:** NFR1-2, NFR4-8, NFR9-11, NFR12-14

### Epic 2: Browse Events in Web UI

Developer opens a browser and sees a chronological event list with session
filtering, event detail, and live updates via SSE. Includes `hookwatch open`
for manual server start + browser launch and idle timeout for server lifecycle.

**FRs covered:** FR10-13, FR15-16, FR21-22
**NFRs addressed:** NFR3
**Depends on:** Epic 1

### Epic 3: Hook Debugging with Wrap

Developer wraps any command to capture its stdin/stdout/stderr and views the
captured I/O in the web UI. Core hook debugging workflow.

**FRs covered:** FR14, FR17-19
**Depends on:** Epic 1, Epic 2

### Epic 4: Context Injection

Hook handler outputs structured system messages to Claude Code via stdout,
identifying the source hook and event type. Includes bidirectional Zod
validation of hook stdout.

**FRs covered:** FR27-28
**Depends on:** Epic 1

## Epic 1: Install & Capture Events

Developer installs hookwatch and all 18 hook event types flow into SQLite
storage. Verifiable immediately via server logs or direct database query.

### Story 1.1: Project Initialization & SQLite Database Layer

As a **developer building hookwatch**,
I want a project skeleton with a SQLite database layer,
So that events have a storage foundation to write to.

**Acceptance Criteria:**

**Given** a fresh clone of the hookwatch repo
**When** `bun install` is run
**Then** all dependencies (Zod, citty, smol-toml) are installed with no errors

**Given** the database layer is initialized
**When** a database connection is opened for the first time
**Then** the file is created at `~/.local/share/hookwatch/hookwatch.db` with `0600` permissions
**And** WAL mode is enabled (`PRAGMA journal_mode=wal`)
**And** the `events` table exists with columns: id, ts, event, session_id, cwd, tool_name, session_name, hook_duration_ms, payload

**Given** the events table exists
**When** an event row is inserted via the query helper
**Then** it is persisted and retrievable after closing and reopening the connection

**Covers:** FR6-9, NFR7-9

### Story 1.2: Zod Event Validation Schemas

As a **hookwatch handler**,
I want Zod schemas for all 18 event types,
So that incoming stdin payloads are validated with strict known fields and permissive unknown fields.

**Acceptance Criteria:**

**Given** a valid `PreToolUse` stdin JSON payload
**When** parsed through the event schema
**Then** known fields are typed and validated
**And** unknown fields are preserved in the output (not stripped)

**Given** a payload with an unknown event type (e.g., `"event": "FutureEvent"`)
**When** parsed through the schema
**Then** it passes validation using the fallback schema
**And** the full payload is preserved

**Given** a payload missing required fields (e.g., no `session_id`)
**When** parsed through the schema
**Then** validation fails with a descriptive Zod error

**Covers:** FR2-3, NFR12

### Story 1.3: Bun Server with Event Ingestion Endpoint

As a **hookwatch handler**,
I want a Bun server that accepts events via HTTP,
So that captured events flow from handler to database.

**Acceptance Criteria:**

**Given** the Bun server is started
**When** it binds to `127.0.0.1:6004`
**Then** it is accessible on localhost only
**And** `GET /health` returns `200 OK`

**Given** a valid event JSON is POSTed to `/api/events`
**When** the server receives it
**Then** the event is inserted into SQLite via the query helper
**And** the server responds with `201 Created`

**Given** an invalid JSON body is POSTed to `/api/events`
**When** the server receives it
**Then** it responds with `400` and structured error JSON `{ "error": { "code": "INVALID_QUERY", "message": "..." } }`

**Given** port 6004 is already in use
**When** the server starts without explicit `--port`
**Then** it auto-increments to 6005, 6006, etc.

**Covers:** FR23, NFR10, NFR14

### Story 1.4: Hook Handler — Receive, Validate & Forward Events

As a **Claude Code developer**,
I want the hook handler to capture every event and forward it to the server,
So that my agent activity is recorded without interrupting my workflow.

**Acceptance Criteria:**

**Given** Claude Code fires a hook event
**When** the handler reads stdin
**Then** it parses JSON, validates with Zod, and POSTs to `localhost:6004/api/events`
**And** exits 0 on success

**Given** the server is running and reachable
**When** a valid event is processed
**Then** the handler completes in <100ms

**Given** the handler encounters any error (parse failure, network error, etc.)
**When** the error occurs
**Then** the handler catches it, never propagates to Claude Code, and exits 1
**And** no exception is thrown to the parent process

**Given** a hook event with an unknown event type
**When** the handler processes it
**Then** it is forwarded to the server without error (forward-compatible)

**Covers:** FR1, FR4-5, NFR1, NFR4-6

### Story 1.5: Server Auto-Start from Handler

As a **Claude Code developer**,
I want the handler to start the Bun server automatically,
So that event capture works without manual setup.

**Acceptance Criteria:**

**Given** the handler POSTs to `/api/events` and gets connection refused
**When** auto-start is triggered
**Then** the handler spawns the Bun server as a detached background process

**Given** the server was just spawned
**When** the handler polls `GET /health` at 50ms intervals
**Then** it retries for up to 2 seconds

**Given** health check succeeds within the timeout
**When** the handler retries the POST
**Then** the event is delivered successfully and handler exits 0

**Given** health check does not succeed within 2 seconds
**When** the timeout is reached
**Then** the handler exits 1 (non-blocking error)

**Covers:** FR20, NFR2

### Story 1.6: Plugin Manifest & CLI Install/Uninstall

As a **Claude Code developer**,
I want to install hookwatch with a single command,
So that all 18 hook event types are registered automatically.

**Acceptance Criteria:**

**Given** hookwatch is installed globally via npm
**When** `hookwatch install` is run
**Then** `plugin.json` and `hooks.json` are generated from source
**And** `claude plugin install` is called to register the plugin
**And** all 18 event types are registered in `hooks.json`

**Given** hookwatch is already installed
**When** `hookwatch install` is run again
**Then** it uninstalls first, then reinstalls (update behavior)

**Given** hookwatch is installed
**When** `hookwatch uninstall` is run
**Then** `claude plugin uninstall` is called
**And** no leftover files or broken hooks remain

**Given** hookwatch is run with `--help` or `--version`
**When** the flag is passed
**Then** help text or version number is displayed

**Covers:** FR24-26, NFR13

## Epic 2: Browse Events in Web UI

Developer opens a browser and sees a chronological event list with session
filtering, event detail, and live updates via SSE.

### Story 2.1: Serve Web UI & Event List Page

As a **Claude Code developer**,
I want to open a browser and see a chronological list of hook events,
So that I can review what the agent did.

**Acceptance Criteria:**

**Given** the Bun server is running
**When** a browser navigates to `http://localhost:6004`
**Then** `index.html` is served with Pico CSS loaded
**And** `.ts` files are transpiled on-the-fly via `Bun.Transpiler` and served with `Content-Type: application/javascript`

**Given** events exist in the database
**When** the event list page loads
**Then** events are displayed in reverse chronological order (newest first)
**And** each row shows: timestamp, event type, session ID, tool name (if applicable)

**Given** no events exist in the database
**When** the event list page loads
**Then** an empty state message is displayed

**Covers:** FR10, FR22, NFR3

### Story 2.2: Session Filter

As a **Claude Code developer**,
I want to filter events by session ID,
So that I can focus on what happened in a specific session.

**Acceptance Criteria:**

**Given** the event list is displayed
**When** the session filter component loads
**Then** it shows a list of available session IDs from the database

**Given** a session ID is selected in the filter
**When** the filter is applied
**Then** only events matching that session ID are displayed
**And** the query uses `POST /api/query` with the session filter

**Given** the filter is cleared
**When** "All sessions" is selected
**Then** all events are displayed again

**Covers:** FR11

### Story 2.3: Event Detail & Tool Input View

As a **Claude Code developer**,
I want to expand any event to see its full stdin payload and tool input,
So that I can understand exactly what data the agent sent.

**Acceptance Criteria:**

**Given** the event list is displayed
**When** a developer clicks on an event row
**Then** it expands to show the full stdin JSON payload, formatted and syntax-highlighted

**Given** the expanded event is a tool-related event (e.g., `PreToolUse`)
**When** the detail view renders
**Then** `tool_name` and `tool_input` are displayed prominently above the raw payload

**Given** the event detail is open
**When** the developer clicks the event row again
**Then** the detail collapses

**Covers:** FR12-13

### Story 2.4: SSE Live Updates

As a **Claude Code developer**,
I want the event list to update in real-time as new events arrive,
So that I can watch agent activity live.

**Acceptance Criteria:**

**Given** the web UI is open in a browser
**When** a new event is ingested by the server
**Then** the server pushes the event via `GET /api/events/stream` (SSE)
**And** the event list updates automatically without page refresh

**Given** the SSE connection drops (e.g., server restart)
**When** the browser detects the disconnection
**Then** `EventSource` reconnects automatically

**Given** the session filter is active
**When** a new event arrives via SSE
**Then** it only appears in the list if it matches the active session filter

**Covers:** SSE live updates (cross-cutting for FR10-11)

### Story 2.5: hookwatch open Command

As a **Claude Code developer**,
I want to run `hookwatch open` to start the server and open the browser,
So that I can view events even when the server timed out.

**Acceptance Criteria:**

**Given** the Bun server is not running
**When** `hookwatch open` is run
**Then** the server is started on the default port (or auto-incremented)
**And** the web UI is opened in the default browser

**Given** the Bun server is already running
**When** `hookwatch open` is run
**Then** it opens the browser to the existing server's URL without starting a second instance

**Given** `hookwatch open --port 7000` is run
**When** port 7000 is available
**Then** the server starts on port 7000

**Given** `hookwatch open --port 7000` is run
**When** port 7000 is occupied
**Then** an error is displayed: "port 7000 in use" (no auto-increment on explicit port)

**Covers:** FR15-16

### Story 2.6: Server Idle Timeout

As a **Claude Code developer**,
I want the Bun server to self-terminate after inactivity,
So that it doesn't consume resources when I'm not using it.

**Acceptance Criteria:**

**Given** the Bun server is running
**When** no events are ingested and no HTTP requests are received for the configured timeout period
**Then** the server shuts down gracefully

**Given** the server is idle and approaching timeout
**When** a new event is ingested or an HTTP request arrives
**Then** the idle timer resets

**Given** the server has shut down due to idle timeout
**When** a hook event fires
**Then** the handler auto-starts the server (Story 1.5)

**Covers:** FR21

## Epic 3: Hook Debugging with Wrap

Developer wraps any command to capture its stdin/stdout/stderr and views the
captured I/O in the web UI.

### Story 3.1: Wrap Command — Capture & Passthrough I/O

As a **hook author**,
I want to wrap any command to capture its stdin, stdout, and stderr,
So that I can see exactly what data flows through my hook.

**Acceptance Criteria:**

**Given** a developer runs `hookwatch wrap -- my-hook-script.sh`
**When** the wrapped command executes
**Then** stdin is forwarded to the wrapped command
**And** stdout and stderr are captured and forwarded to the Bun server via `POST /api/events`
**And** the wrapped command's stdout and stderr are passed through to the terminal (tee behavior)

**Given** the wrapped command exits
**When** the wrap process completes
**Then** the exit code, stdout, stderr, and the original command are stored as a wrap event

**Given** the Bun server is not running
**When** `hookwatch wrap` is run
**Then** the server is auto-started (same as handler auto-start in Story 1.5)

**Covers:** FR17-19

### Story 3.2: Wrap I/O Viewer in Web UI

As a **hook author**,
I want to see captured wrap I/O in the web UI,
So that I can debug my hook's input/output behavior visually.

**Acceptance Criteria:**

**Given** wrap events exist in the database
**When** the event list page loads
**Then** wrap events are displayed alongside hook events with a distinct visual indicator

**Given** a developer clicks on a wrap event
**When** the detail view expands
**Then** stdin, stdout, and stderr are displayed in separate panels
**And** the original command and exit code are shown

**Given** the session filter is active
**When** wrap events are filtered
**Then** they follow the same session filtering as hook events

**Covers:** FR14

## Epic 4: Context Injection

Hook handler outputs structured system messages to Claude Code via stdout,
identifying the source hook and event type.

### Story 4.1: Hook Stdout Validation Schemas

As a **hookwatch developer**,
I want Zod schemas for hook stdout output,
So that messages sent to Claude Code are validated before delivery.

**Acceptance Criteria:**

**Given** the hook stdout schema is defined
**When** a valid system message JSON is validated
**Then** it passes with typed fields (message content, source hook, event type)

**Given** a malformed stdout JSON is validated
**When** required fields are missing
**Then** validation fails with a descriptive error
**And** the handler does not output invalid JSON to Claude Code

**Covers:** FR27-28 (validation layer)

### Story 4.2: Handler Context Injection Output

As a **Claude Code developer**,
I want hookwatch to output structured system messages to Claude Code,
So that the agent receives context about captured events.

**Acceptance Criteria:**

**Given** the handler successfully processes a hook event
**When** context injection is enabled
**Then** the handler writes a valid JSON system message to stdout
**And** the message identifies the source hook name and event type

**Given** the handler fails to deliver an event (server unreachable)
**When** context injection would normally output
**Then** no stdout is written (exit 1 already signals the failure)

**Given** Claude Code reads the handler's stdout
**When** the JSON is parsed
**Then** it conforms to the stdout validation schema from Story 4.1

**Covers:** FR27-28
