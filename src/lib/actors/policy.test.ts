import { describe, expect, it, vi } from "vitest";
import { authorizePublicActorRead } from "./policy";
import { MockActorAwardsRepository } from "./mock-awards-repository";

vi.mock("server-only", () => ({}));

describe("actor access policy", () => {
  it("accepts numeric public actor IDs and supported locale tags", () => {
    expect(authorizePublicActorRead("1190668", "fr-FR")).toEqual({ actorId: "1190668", locale: "fr-FR" });
  });

  it("rejects path-like actor IDs and malformed locales", () => {
    expect(() => authorizePublicActorRead("../api/movies")).toThrowError("Actor was not found.");
    expect(() => authorizePublicActorRead("1190668", "../../secret")).toThrowError("Invalid language selection.");
  });

  it("returns labeled sample awards and an empty state for unknown actors", async () => {
    const repository = new MockActorAwardsRepository();
    const sample = await repository.getAwards("1190668");
    const empty = await repository.getAwards("999999999");

    expect(sample.source).toBe("sample");
    expect(sample.awards.length).toBeGreaterThan(0);
    expect(empty.awards).toEqual([]);
  });
});