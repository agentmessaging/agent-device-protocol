import { Controller } from "../packages/sdk/controller.mjs";
import { controllerConformance } from "./conformance/controller-contract.mjs";
controllerConformance((options) => new Controller(options));
