import { describe } from "node:test";
import { controllerConformance } from "./conformance/controller-contract.mjs";
import { referenceAdapter } from "./conformance/reference-adapter.mjs";
describe("reference controller tools and persistence", () =>
  controllerConformance(referenceAdapter));
