---
name: open-office
description: Open or reuse Nookrew for the current local Codex folder on Windows, macOS or Linux.
---

Use the current absolute local folder. No registered project is required. Ask for a folder only if none is known. Install the runtime once in the user's cache, never inside every project.

Resolve scripts relative to this skill's directory (../../scripts). On Windows x64 run powershell.exe -NoProfile -NonInteractive -File <absolute scripts/open-office.ps1> -Project <absolute folder>. On macOS/Linux x64 or ARM64 run /bin/sh <absolute scripts/open-office.sh> <absolute folder>. Scripts fetch the matching official Nookrew beta archive, verify its pinned SHA256, and launch the shared OfficePluginHost. Keep host network/execution approvals. No additional Node/npm, API key, paid model or duplicate Codex agent is needed.

Read the JSON result and open its actual loopback URL in Codex browser using open_in_codex. No local executor: explain this needs local Codex; don't claim success. Runtime/native HTTP checks are separate from actual Codex Desktop conversation acceptance on each OS. Closing is through the office close control and retains local data. Send messages only when the user asks; approvals/stopping remain in original Codex.
