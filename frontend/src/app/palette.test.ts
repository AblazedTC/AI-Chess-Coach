import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

// Keep Vite's browser-asset transform from replacing this filesystem URL.
const stylesheet = "./globals.css";
const css = readFileSync(new URL(stylesheet, import.meta.url), "utf8");
const root = /:root\s*\{([^}]+)\}/.exec(css)?.[1];
if (!root) throw new Error("globals.css must declare the workspace palette in :root");
const tokens = new Map(
  Array.from(root.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi), (match) => [
    match[1],
    match[2].toLowerCase(),
  ]),
);

function color(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing six-digit hex palette token ${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(color(foreground));
  const b = luminance(color(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const surfaces = ["--background", "--panel", "--panel-raised", "--sunken"];

describe("workspace palette accessibility", () => {
  it.each([
    ["--background", "#2b2926"],
    ["--panel", "#22201d"],
    ["--panel-raised", "#363430"],
    ["--sunken", "#1b1a18"],
    ["--line", "#45423d"],
    ["--text", "#f2f1ef"],
    ["--muted", "#b4b1ac"],
    ["--subtle", "#8f8b85"],
    ["--accent", "#7fa650"],
    ["--accent-strong", "#95bd62"],
    ["--accent-contrast", "#10140b"],
    ["--focus", "#b7e07c"],
    ["--board-light", "#eeeed2"],
    ["--board-dark", "#769656"],
    ["--eval-white", "#f2f1ef"],
    ["--eval-black", "#3a3835"],
  ])("declares %s as the intended original workspace color", (token, expected) => {
    expect(color(token)).toBe(expected);
  });

  for (const surface of surfaces) {
    it.each(["--text", "--muted"])("%s meets WCAG AA text contrast on " + surface, (text) => {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps the keyboard focus indicator distinguishable on ${surface}`, () => {
      expect(contrast("--focus", surface)).toBeGreaterThanOrEqual(3);
    });
  }

  it.each(["--accent", "--accent-strong"])(
    "keeps dark primary-button text readable on %s",
    (background) => {
      expect(contrast("--accent-contrast", background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ...surfaces,
    "--text",
    "--muted",
    "--accent",
    "--accent-strong",
    "--accent-contrast",
    "--focus",
    "--board-light",
    "--board-dark",
    "--eval-white",
    "--eval-black",
  ])("uses %s rather than leaving an unused palette declaration", (token) => {
    expect(new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(css), `CSS must consume ${token}`).toBe(
      true,
    );
  });
});
