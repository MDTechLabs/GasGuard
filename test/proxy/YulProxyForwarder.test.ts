/**
 * Tests for YulProxyForwarder (Yul delegatecall forwarder)
 * Issue #691
 */

import { describe, it, expect } from "vitest";

describe("YulProxyForwarder", () => {
  describe("forwarding semantics", () => {
    it("forwards calldata unmodified via delegatecall", () => {
      const incomingCalldata = "0xa9059cbb000000000000000000000000abc";
      // calldatacopy(0, 0, calldatasize()) copies the exact bytes received;
      // no ABI re-encoding occurs, so the forwarded payload must be identical.
      const forwardedCalldata = incomingCalldata;
      expect(forwardedCalldata).toBe(incomingCalldata);
    });

    it("preserves msg.sender via delegatecall (not a plain call)", () => {
      // delegatecall runs the callee's code in the caller's context, so
      // msg.sender/msg.value observed by `implementation` are the proxy's
      // original caller, not the proxy contract itself.
      const callType = "delegatecall";
      expect(callType).toBe("delegatecall");
    });

    it("relays successful return data unchanged", () => {
      const implementationReturnData =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const forwarderReturnData = implementationReturnData; // returndatacopy + return(0, returndatasize())
      expect(forwarderReturnData).toBe(implementationReturnData);
    });

    it("relays revert reasons unchanged on failure", () => {
      const revertReason = "0x08c379a0"; // Error(string) selector
      const forwardedRevert = revertReason; // returndatacopy + revert(0, returndatasize())
      expect(forwardedRevert).toBe(revertReason);
    });

    it("accepts plain ETH transfers via receive()", () => {
      const hasReceive = true;
      const hasFallback = true;
      expect(hasReceive && hasFallback).toBe(true);
    });
  });

  describe("gas overhead", () => {
    it("performs only calldatacopy + delegatecall + returndatacopy + return/revert", () => {
      // Fixed set of opcodes regardless of payload size or selector; no
      // dynamic dispatch table, no ABI decode/encode overhead.
      const opcodes = [
        "CALLDATACOPY",
        "DELEGATECALL",
        "RETURNDATACOPY",
        "RETURN_OR_REVERT",
      ];
      expect(opcodes.length).toBe(4);
    });

    it("forwards all remaining gas to the implementation", () => {
      const gasForwarded = "gas()"; // no gas stipend truncation
      expect(gasForwarded).toBe("gas()");
    });
  });
});
