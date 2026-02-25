import { describe, it, expect } from "vitest";
import {
  createNetworkState,
  reduceNetworkState,
} from "../src/output/network-state.js";

describe("network state reducer", () => {
  it("switches active scope without mixing selections", () => {
    const state = createNetworkState(["main", "agent_1"]);
    const afterTab = reduceNetworkState(state, { type: "next-scope" });
    expect(afterTab.activeScopeId).toBe("agent_1");
    expect(afterTab.selectionByScope.main).toBe(0);
  });
});
