import type { GatewayRequestHandlers } from "./types.js";
import { worldMonitor } from "../../world-monitor/service.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const worldHandlers: GatewayRequestHandlers = {
  "world.getBrief": async ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const hours = typeof params.hours === "number" ? params.hours : undefined;
      const result = worldMonitor.getBrief(limit, hours);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "world.getSignals": async ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const hours = typeof params.hours === "number" ? params.hours : undefined;
      const result = await worldMonitor.getSignals(limit, hours);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "world.search": async ({ params, respond }) => {
    if (typeof params.query !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "query must be a string"));
      return;
    }
    try {
      const result = await worldMonitor.search(params.query);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "world.refresh": async ({ respond }) => {
    try {
      await worldMonitor.refreshFeeds();
      respond(true, { success: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
