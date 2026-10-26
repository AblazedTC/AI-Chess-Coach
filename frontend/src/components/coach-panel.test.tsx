import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceModel } from "@/hooks/use-workspace";
import { initialState } from "@/lib/state";
import { coach, game } from "@/test/fixtures";
import { CoachPanel } from "./coach-panel";

function model(ply = 0) {
  return {
    state: { ...initialState, game, ply },
    position: game.positions.find((position) => position.ply === ply),
    conversation: undefined,
    health: null,
    coachBusy: false,
    coachError: undefined,
    askCoach: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
  } as unknown as WorkspaceModel;
}

describe("fundamentals coaching questions", () => {
  it("offers development, engine ideas, and a practical plan before any move is played", () => {
    render(<CoachPanel model={model()} />);
    expect(
      screen.getByRole("button", { name: "How should I develop and defend the center?" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "What is the idea behind the engine's suggested move?",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "What practical lesson and plan should I take from this position?",
      }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: /last move|alternative better/i })).toBeNull();
  });

  it.each([1, 2])("asks why the played move mattered at ply %i", (ply) => {
    render(<CoachPanel model={model(ply)} />);
    expect(screen.getByRole("button", { name: "Why did the last move matter?" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Why is the engine's alternative better?" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "What practical lesson and plan should I take from this position?",
      }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: /How should I develop/ })).toBeNull();
  });

  it.each([0, 1])(
    "fills an editable draft without sending any quick question at ply %i",
    async (ply) => {
      const user = userEvent.setup();
      const props = model(ply);
      const { container } = render(<CoachPanel model={props} />);
      const suggestions = container.querySelector(".question-suggestions")!;
      const input = screen.getByRole("textbox", { name: "Ask a question" });
      for (const button of within(suggestions as HTMLElement).getAllByRole("button")) {
        await user.click(button);
        expect(input).toHaveValue(button.textContent);
        expect(props.askCoach).not.toHaveBeenCalled();
      }
      await user.type(input, " Please explain simply.");
      const draft = (input as HTMLTextAreaElement).value;
      await user.click(screen.getByRole("button", { name: "Ask coach" }));
      expect(props.askCoach).toHaveBeenCalledExactlyOnceWith(draft);
      expect(input).toHaveValue(draft);
    },
  );

  it("preserves the draft across same-position updates and hides it in other contexts", async () => {
    const user = userEvent.setup();
    const props = model(1);
    const { rerender } = render(<CoachPanel model={props} />);
    const input = screen.getByRole("textbox", { name: "Ask a question" });
    await user.click(screen.getByRole("button", { name: "Why did the last move matter?" }));
    await user.type(input, " Was a pawn left undefended?");
    const draft = (input as HTMLTextAreaElement).value;
    rerender(<CoachPanel model={{ ...props, coachError: "Try again." }} />);
    expect(input).toHaveValue(draft);
    rerender(<CoachPanel model={model(0)} />);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: /last move/i })).toBeNull();
    rerender(<CoachPanel model={props} />);
    expect(input).toHaveValue(draft);
    rerender(
      <CoachPanel
        model={{ ...props, state: { ...props.state, game: { ...game, id: "another-game" } } }}
      />,
    );
    expect(input).toHaveValue("");
  });

  it("disables quick questions and submission while the coach is busy without losing the draft", async () => {
    const user = userEvent.setup();
    const props = model(1);
    const { rerender } = render(<CoachPanel model={props} />);
    await user.click(screen.getByRole("button", { name: "Why did the last move matter?" }));
    rerender(<CoachPanel model={{ ...props, coachBusy: true }} />);
    expect(screen.getByRole("region", { name: "Coach response" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Why is the engine's alternative better?" }),
    );
    expect(screen.getByRole("textbox", { name: "Ask a question" })).toHaveValue(
      "Why did the last move matter?",
    );
    expect(props.askCoach).not.toHaveBeenCalled();
  });

  it("keeps multiline explanations as plain text with paragraph-preserving styles", () => {
    const props = model();
    const explanation =
      "The last move left your center pawn undefended.\n\n" +
      "Develop a piece that protects it before attacking.\n\n" +
      '<b>Check your defenders.</b> **No markdown** <script>alert("unsafe")</script>';
    props.conversation = {
      messages: [
        { role: "user", content: "Why did that move matter?" },
        { role: "assistant", content: explanation },
      ],
      response: { ...coach, message: explanation },
    };
    const { container } = render(<CoachPanel model={props} />);
    const response = screen.getByRole("region", { name: "Coach response" });
    expect(response).toHaveAttribute("aria-live", "polite");
    expect(within(response).getByText("Why did that move matter?")).toBeInTheDocument();
    const paragraph = container.querySelector(".chat-message.assistant p")!;
    expect(paragraph.textContent).toBe(explanation);
    expect(paragraph.querySelector("b, script")).toBeNull();

    const stylesheet = "../app/globals.css";
    const css = readFileSync(new URL(stylesheet, import.meta.url), "utf8");
    const paragraphStyles = /\.chat-message p\s*\{([^}]+)\}/.exec(css)?.[1];
    expect(paragraphStyles).toMatch(/white-space:\s*pre-wrap/);
    expect(paragraphStyles).toMatch(/overflow-wrap:\s*anywhere/);
    expect(paragraphStyles).toMatch(/line-height:\s*1\.7/);
  });

  it("preserves warnings, evidence navigation, suggested moves, and errors", async () => {
    const user = userEvent.setup();
    const props = model();
    props.coachError = "Please try again.";
    props.conversation = {
      messages: [{ role: "assistant", content: coach.message }],
      response: {
        ...coach,
        suggested_moves: [{ san: "e4", uci: "e2e4", engine_verified: true }],
      },
    };
    render(<CoachPanel model={props} />);
    expect(screen.getByText(coach.warning!)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again.");
    await user.click(screen.getByText("Position evidence"));
    expect(screen.getByText("Engine verified")).toBeVisible();
    expect(screen.getByText("e4")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Position 0/ }));
    expect(props.navigate).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("labels and navigates selected-position and previous-position citations independently", async () => {
    const user = userEvent.setup();
    const props = model(2);
    props.conversation = {
      messages: [{ role: "assistant", content: coach.message }],
      response: {
        ...coach,
        ply: 2,
        position_key: "test-2",
        citations: [`${game.id}:2:test-2`, `${game.id}:1:test-1`],
      },
    };
    render(<CoachPanel model={props} />);
    await user.click(screen.getByText("Position evidence"));
    const selected = screen.getByRole("button", { name: /^Position 2/ });
    const previous = screen.getByRole("button", { name: /^Position 1/ });
    expect(selected).toHaveAttribute("title", `${game.id}:2:test-2`);
    expect(previous).toHaveAttribute("title", `${game.id}:1:test-1`);
    await user.click(selected);
    await user.click(previous);
    expect(props.navigate).toHaveBeenCalledTimes(2);
    expect(props.navigate).toHaveBeenNthCalledWith(1, 2);
    expect(props.navigate).toHaveBeenNthCalledWith(2, 1);
  });

  it.each([
    ["test-game:0:test-0", 0],
    ["test-game:500:test-500", 500],
    ["test-game:501:test-501", 2],
    ["test-game:-1:test-1", 2],
    ["test-game:1.5:test-1", 2],
    ["test-game:1e2:test-1", 2],
    ["test-game::test-1", 2],
    ["test-game:Infinity:test-1", 2],
    ["test-game:NaN:test-1", 2],
    ["test-game:1", 2],
    ["test-game:1:test-1:extra", 2],
    ["test-2", 2],
  ])("uses a bounded citation ply or the response ply for %s", async (citation, expected) => {
    const user = userEvent.setup();
    const props = model(2);
    props.conversation = {
      messages: [{ role: "assistant", content: coach.message }],
      response: { ...coach, ply: 2, citations: [citation] },
    };
    render(<CoachPanel model={props} />);
    await user.click(screen.getByText("Position evidence"));
    await user.click(screen.getByRole("button", { name: new RegExp(`^Position ${expected}`) }));
    expect(props.navigate).toHaveBeenCalledExactlyOnceWith(expected);
  });
});
