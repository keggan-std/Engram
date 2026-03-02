import { Router } from "express";
import { getServices } from "../database.js";
import { ok, serverError } from "./api-helpers.js";

export const instancesRouter = Router();

// GET /api/v1/instances — list all registered instances
instancesRouter.get("/", (_req, res) => {
  try {
    const services = getServices();
    const registry = services.registry.getRegistry();
    return ok(res, registry);
  } catch (err) {
    return serverError(res, err);
  }
});
