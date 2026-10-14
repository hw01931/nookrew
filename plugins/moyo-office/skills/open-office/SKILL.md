---
name: open-office
description: Open, reuse, check or close the Nookrew office for the user's current local Codex project. Use for @Nookrew start, @Nookrew 시작, open my office, employees, project documents or the office view.
---

# Open the user's office

A registered project is not required: a local Codex chat with a known working directory is supported. Use the existing working directory or project context to select its absolute local folder. If the user explicitly selects another project, use that folder. Ask for a path only when there is no known project. Do not scan all drives or install dependencies in each project.

If neither a local shell executor nor office_open is available, explain that this chat cannot start a local Windows application. Direct the user to a local Codex chat or desktop Work session with local execution. Do not tell them to reconnect or search again as though this were an authentication error. Never claim the office opened when no launch was performed.

1. When this host exposes the plugin's `office_open`, call it with `project` and a unique request `key`. The tool starts or reuses that project's local office using the shared installed runtime. Reuse the same key only for a retry of the same request.
   If this Codex build does not attach the packaged MCP tools, run the included `scripts/open-office.ps1` with the current absolute project folder via the normal authorized local shell tool. Resolve its path from this SKILL.md's directory; do not assume the plugin is inside the project. Example: `powershell.exe -NoProfile -NonInteractive -File <absolute-skill-directory>/scripts/open-office.ps1 -Project <absolute-project-path>`. Read the JSON report it prints. This is the same shared runtime, not a per-project install. Never bypass host execution approval or sandbox restrictions.
2. Open the returned `url` in Codex's browser panel, using `open_in_codex` when available or the host's browser-opening tool. This is a local browser view, not an embedded MCP Apps iframe or a replacement for Codex's chat interface.
3. Explain only the requested action. Characters show actual observed Codex sessions for that project. A character opens recent real conversation; the employee list edits the office profile. Sending uses the original Codex queue. Queue acknowledgement is not proof that a turn completed. Work already running is allowed to finish; approvals and stopping remain in the original Codex window.

Use `office_status` to check an office opened by this plugin instance. Use `office_close` with the project and a new request key only when the user asks to close that office. When these tools are not attached, use the office's own close button instead of guessing process IDs. Closing keeps project files and records. Do not close another project's office.

Windows x64 is currently supported. Codex and its existing ChatGPT login are required. The runtime includes Node; no Node/npm/model install is needed by an installed-plugin user. Do not switch model, permissions, API account, or launch duplicate agent sessions. Do not send test messages or other employee prompts unless the user requested that action. A missing capability must be reported honestly, not replaced by a success placeholder.
