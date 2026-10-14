// Presentation only: never changes stored history or the message sent to Codex.
export function userMessageDisplay(text) {
  let value = text;
  const prefix =
    /^\s*<in-app-browser-context\s+source=["']ambient-ui-state["']>\s*This block is automatically supplied ambient UI state,[\s\S]*?<\/in-app-browser-context>\s*(?:## My request:\s*)?/;
  for (;;) {
    const match = prefix.exec(value);
    if (match) {
      value = value.slice(match[0].length);
      continue;
    }
    const reply =
      /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*/.exec(
        value,
      );
    if (reply) {
      try {
        const answers = JSON.parse(reply[1]);
        if (Array.isArray(answers) && answers.length && answers.every((a) => typeof a.answer === 'string'))
          return answers.map((a) => a.answer).join('\n\n') + value.slice(reply[0].length);
      } catch {
        /* Preserve unrecognized user content. */
      }
    }
    return value;
  }
}
