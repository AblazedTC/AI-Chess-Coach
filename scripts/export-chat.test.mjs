import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleMessages } from "./export-chat.mjs";

const event = (type, data, extra = {}) => JSON.stringify({ type, data, ...extra });

test("exports visible main and agent messages, not internal context or tool data", () => {
  const source = [
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
  assert.equal(result.messages.get("backend").length, 2);
  const text = JSON.stringify([...result.messages]);
  assert.doesNotMatch(text, /private|hidden|notification/);
});

test("redacts common credential values", () => {
  const source = event("user.message", { content: "ANTHROPIC_API_KEY=example-secret ghp_1234567890123456" });
  assert.equal(visibleMessages(source).messages.get("main")[0].content, "[REDACTED] [REDACTED]");
});

test("tolerates only a partial trailing event while the session is writing", () => {
  const source = event("assistant.message", { content: "Saved" }) + '\n{"type":';
  assert.equal(visibleMessages(source).incompleteTail, true);
  assert.throws(() => visibleMessages('{"broken":\n{}\n'));
});
