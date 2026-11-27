import { describe, expect, it } from "vitest";
import { startErrorText } from "../src/app/session";

describe("startErrorText", () => {
  it("names the failing error so the on-screen line says why", () => {
    const e = new DOMException("The page is not visible", "SecurityError");
    expect(startErrorText("immersive-ar", e)).toBe("Could not start immersive-ar: SecurityError: The page is not visible");
  });
  it("copes with a plain Error and a non-error rejection", () => {
    expect(startErrorText("immersive-vr", new Error("boom"))).toBe("Could not start immersive-vr: boom");
    expect(startErrorText("immersive-vr", "nope")).toBe("Could not start immersive-vr: nope");
  });
});
