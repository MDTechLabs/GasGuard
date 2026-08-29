import { AuditEventEmitter } from "../audit-event-emitter";
import { EventType, OutcomeStatus } from "../../entities";

describe("AuditEventEmitter", () => {
  let emitter: AuditEventEmitter;

  beforeEach(() => {
    emitter = new AuditEventEmitter();
  });

  it("should be defined", () => {
    if (!emitter) throw new Error("Emitter not defined");
  });

  it("should have required methods", () => {
    if (
      typeof emitter.onAuditEvent !== "function" ||
      typeof emitter.emitApiKeyEvent !== "function" ||
      typeof emitter.emitApiRequestEvent !== "function" ||
      typeof emitter.emitGasTransactionEvent !== "function"
    ) {
      throw new Error("Missing required methods");
    }
  });

  it("should support event types", () => {
    if (
      !EventType.API_REQUEST ||
      !EventType.API_KEY_CREATED ||
      !EventType.API_KEY_ROTATED ||
      !EventType.GAS_TRANSACTION ||
      !EventType.API_KEY_REVOKED ||
      !EventType.GAS_SUBMISSION
    ) {
      throw new Error("Missing event types");
    }
  });

  it("should support outcome statuses", () => {
    if (
      !OutcomeStatus.SUCCESS ||
      !OutcomeStatus.FAILURE ||
      !OutcomeStatus.WARNING
    ) {
      throw new Error("Missing outcome statuses");
    }
  });
});
