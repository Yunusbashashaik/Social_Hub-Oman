import { Router } from "express";
import { getPublicServiceImage, getPublicServices } from "../controllers/servicesController.js";

export const servicesRouter = Router();

servicesRouter.get("/", getPublicServices);
servicesRouter.get("/:id/image", getPublicServiceImage);
