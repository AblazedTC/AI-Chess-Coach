import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function visibleMessages(source) {
  const lines = source.trimEnd().split("\n");
  const events = [];
  let incompleteTail = false;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      if (index !== lines.length - 1 || source.endsWith("\n")) throw error;
      incompleteTail = true;
    }
  }

  const agents = new Map(
    events
      .filter((event) => event.type === "subagent.started")
      .map((event) => [event.agentId, event.data.agentDisplayName]),
  );
  const messages = new Map([["main", []]]);
  for (const event of events) {
    if (!["user.message", "assistant.message"].includes(event.type)) continue;
    const content = event.data?.content;
    if (typeof content !== "string" || !content.trim()) continue;
    if (content.trimStart().startsWith("<system_notification>")) continue;
    const id = event.agentId ?? event.data.parentAgentTaskId;
    const name = agents.get(id) ?? "main";
    if (!messages.has(name)) messages.set(name, []);
    messages.get(name).push({
      role: event.type === "user.message" ? "User" : "Assistant",
      timestamp: event.timestamp,
      content: content
        .replace(/\b(?:sk-ant-|sk-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
        .replace(
          /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN)\s*[:=]\s*["']?[^\s"']+/g,
          "[REDACTED]",
        ),
    });
  }
  return { messages, incompleteTail };
}

export function exportChat(eventsPath, destination) {
  const { messages, incompleteTail } = visibleMessages(readFileSync(eventsPath, "utf8"));
  mkdirSync(destination, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = mkdtempSync(join(destination, `${stamp}-`));
  const counts = {};
  for (const [name, entries] of messages) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const text = [
      `# ${name} chat`,
      "",
      "Visible messages only. Tool payloads and internal context are excluded.",
      "",
      ...entries.map(
        (entry) => `## ${entry.role} - ${entry.timestamp}\n\n${entry.content}\n`,
      ),
    ].join("\n");
    writeFileSync(join(directory, `${safeName}.md`), text);
    counts[safeName] = entries.length;
  }
  writeFileSync(
    join(directory, "index.json"),
    JSON.stringify({ exported_at: new Date().toISOString(), incomplete_tail: incompleteTail, messages: counts }, null, 2) + "\n",
  );
  return { directory, counts, incompleteTail };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2] ?? process.env.COPILOT_SESSION_EVENTS;
  if (!input) throw new Error("Usage: node scripts/export-chat.mjs <events.jsonl> [output-directory]");
  const result = exportChat(resolve(input), resolve(process.argv[3] ?? "chat-exports"));
  console.log(JSON.stringify(result, null, 2));
}
