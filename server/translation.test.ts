import { describe, expect, it } from "vitest";
import { protectFormattingTokens, restoreFormattingTokens } from "./translation";

describe("formatting-token protection", () => {
  it("locks and restores nested subtitle formatting tokens", () => {
    const input = "{\\an8}<i>Hello</i>";
    const protectedValue = protectFormattingTokens(input);
    expect(protectedValue.protectedText).toBe("⟦FMT_0⟧⟦FMT_1⟧Hello⟦FMT_2⟧");
    expect(restoreFormattingTokens("⟦FMT_0⟧⟦FMT_1⟧Bonjour⟦FMT_2⟧", protectedValue.tokens)).toBe("{\\an8}<i>Bonjour</i>");
  });
});
