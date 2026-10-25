import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { exportChat, visibleMessages } from "./export-chat.mjs";

const event = (type, data, extra = {}) => JSON.stringify({ type, data, ...extra });

test("exports visible main and agent messages, not internal context or tool data", () => {
  const source =
    [
      event("subagent.started", { agentDisplayName: "backend" }, { agentId: "a" }),
      event("system.message", { content: "private instructions" }),
      event("tool.execution_start", { arguments: "private tool inputs" }),
      event("assistant.message", { content: "Main reply", reasoningText: "hidden" }),
      event("user.message", { content: "Build it", parentAgentTaskId: "a" }),
      event("assistant.message", { content: "Built it" }, { agentId: "a" }),
      event("user.message", { content: "<system_notification>status</system_notification>" }),
    ].join("\n") + "\n";
  const result = visibleMessages(source);
  assert.equal(result.messages.get("main").length, 1);
  assert.equal(result.messages.get("agent:a").length, 2);
  assert.equal(result.names.get("agent:a"), "backend");
  const text = JSON.stringify([...result.messages]);
  assert.doesNotMatch(text, /private|hidden|notification/);
});

test("redacts common credential values", () => {
  const source = event("user.message", {
    content: "ANTHROPIC_API_KEY=example-secret ghp_1234567890123456",
  });
  assert.equal(visibleMessages(source).messages.get("main")[0].content, "[REDACTED] [REDACTED]");
});

test("tolerates only a partial trailing event while the session is writing", () => {
  const source = event("assistant.message", { content: "Saved" }) + '\n{"type":';
  assert.equal(visibleMessages(source).incompleteTail, true);
  assert.throws(() => visibleMessages('{"broken":\n{}\n'));
});

test("keeps agents with shared display names in separate identity groups", () => {
  const source = [
    event("subagent.started", { agentDisplayName: "review" }, { agentId: "a" }),
    event("subagent.started", { agentDisplayName: "review" }, { agentId: "b" }),
    event("assistant.message", { content: "First reviewer" }, { agentId: "a" }),
    event("assistant.message", { content: "Second reviewer" }, { agentId: "b" }),
    event("assistant.message", { content: "Unannounced agent" }, { agentId: "c" }),
  ].join("\n");
  const { messages } = visibleMessages(source);
  assert.equal(messages.size, 4);
  assert.equal(messages.get("main").length, 0);
  assert.equal(messages.get("agent:a")[0].content, "First reviewer");
  assert.equal(messages.get("agent:b")[0].content, "Second reviewer");
  assert.equal(messages.get("agent:c")[0].content, "Unannounced agent");
});

function exportFixture(t, source) {
  const base = resolve("qa");
  const directory = mkdtempSync(join(base, "export-chat-test-"));
  t.after(() => {
    assert.equal(dirname(directory), base);
    assert.ok(basename(directory).startsWith("export-chat-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const eventsPath = join(directory, "events.jsonl");
  writeFileSync(eventsPath, source);
  return { eventsPath, destination: join(directory, "exports") };
}

test("writes main and every agent without name or sanitization collisions", (t) => {
  const agents = [
    ["first", "review", "First agent reply"],
    ["second", "review", "Second agent reply"],
    ["third", "review/api", "Slash name reply"],
    ["fourth", "review_api", "Underscore name reply"],
    ["fifth", "main", "Agent named main reply"],
    ["../sixth", "../../outside", "Path-like display name reply"],
    ["\u0001", "case-safe", "Control ID reply"],
    ["i", "case-safe", "ASCII ID reply"],
  ];
  const source =
    [
      event("assistant.message", { content: "Visible main reply" }),
      event("tool.execution_complete", { content: "DO NOT EXPORT TOOL" }),
      event("system.message", { content: "DO NOT EXPORT SYSTEM" }),
      event("user.message", {
        content: "<system_reminder>DO NOT EXPORT INTERNAL</system_reminder>",
      }),
      ...agents.flatMap(([id, name, content]) => [
        event("subagent.started", { agentDisplayName: name }, { agentId: id }),
        event(
          "assistant.message",
          { content, reasoningText: "DO NOT EXPORT REASONING" },
          { agentId: id },
        ),
      ]),
      event("user.message", { content: "OPENAI_API_KEY=fake-credential ghp_1234567890123456" }),
      event("subagent.started", { agentDisplayName: "empty" }, { agentId: "no-messages" }),
    ].join("\n") + "\n";
  const { eventsPath, destination } = exportFixture(t, source);
  const result = exportChat(eventsPath, destination);
  const files = readdirSync(result.directory).filter((file) => file.endsWith(".md"));
  assert.equal(files.length, agents.length + 2);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.includes("main.md"));
  assert.match(readFileSync(join(result.directory, "main.md"), "utf8"), /Visible main reply/);
  for (const [id, , content] of agents) {
    const prefix = `agent-${Buffer.from(id).toString("hex")}-`;
    const matching = files.filter((file) => file.startsWith(prefix));
    assert.equal(matching.length, 1);
    const path = resolve(result.directory, matching[0]);
    assert.equal(dirname(path), resolve(result.directory));
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes(content));
    for (const [, , otherContent] of agents) {
      if (otherContent !== content) assert.ok(!text.includes(otherContent));
    }
  }
  const allText = files
    .map((file) => readFileSync(join(result.directory, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(allText, /DO NOT EXPORT|fake-credential|ghp_1234567890123456/);
  assert.match(allText, /\[REDACTED\]/);
  const index = JSON.parse(readFileSync(join(result.directory, "index.json"), "utf8"));
  assert.deepEqual(index.messages, result.counts);
  assert.equal(
    Object.values(index.messages).reduce((sum, count) => sum + count, 0),
    10,
  );
});

test("repeated on-disk exports preserve earlier snapshots and report partial tails", (t) => {
  const source = event("assistant.message", { content: "Snapshot reply" }) + '\n{"type":';
  const { eventsPath, destination } = exportFixture(t, source);
  const first = exportChat(eventsPath, destination);
  const original = readFileSync(join(first.directory, "main.md"), "utf8");
  const second = exportChat(eventsPath, destination);
  assert.notEqual(first.directory, second.directory);
  assert.equal(readFileSync(join(first.directory, "main.md"), "utf8"), original);
  assert.equal(readFileSync(join(second.directory, "main.md"), "utf8"), original);
  assert.equal(first.incompleteTail, true);
  assert.equal(second.incompleteTail, true);
});
