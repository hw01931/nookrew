---
name: open-office
description: Open or reuse the Nookrew office for the current project folder, where Claude Code and Codex sessions appear as small staff. Use when the user asks to open, start or show the Nookrew office.
disable-model-invocation: false
---

Use the current absolute project folder. No registered project is required. Ask for a folder only if none is known. The runtime is installed once in the user cache, never inside each project.

Find the scripts relative to this skill's base directory (shown when the skill loads): they are in ../../scripts. On Windows run powershell.exe -NoProfile -NonInteractive -File <absolute scripts/open-office.ps1> -Project <absolute folder>. On macOS or Linux run /bin/sh <absolute scripts/open-office.sh> <absolute folder>. The script downloads the matching official Nookrew archive, verifies its pinned SHA256 and starts the local office. Keep the host's execution and network approvals; no extra Node, npm, API key or paid model is needed.

Read the JSON result and give the user its loopback URL (127.0.0.1 or ::1) to open in a browser. Claude Code has no built-in browser pane, so do not claim to have opened it. Claude Code sessions of this folder show up on their own from the local transcripts; nothing else needs installing. Sessions open in Claude Code are read-only in the office, so approvals and interrupts stay here. Never send messages to a session on the user's behalf unless they ask.
