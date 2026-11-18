import { LiveTabletopClient } from "./live_tabletop_client";
import { RulesArbiterClient } from "./rules_arbiter_client";

declare global {
  interface Window {
    LiveTabletopClient?: typeof LiveTabletopClient;
    RulesArbiterClient?: typeof RulesArbiterClient;
  }
}

if (typeof window !== "undefined") {
  window.LiveTabletopClient = LiveTabletopClient;
  window.RulesArbiterClient = RulesArbiterClient;
}

export { LiveTabletopClient, RulesArbiterClient };
