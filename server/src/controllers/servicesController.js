import { listServices } from "../models/Service.js";
import { getServiceImageBlob, imageFilenameFromUrl } from "../models/Service.js";
import { SERVICE_UPLOADS_DIR } from "../db/connection.js";
import fs from "fs";
import path from "path";

export function getPublicServices(_req, res) {
  try {
    res.json({ services: listServices() });
  } catch (err) {
    console.error("Failed to load services:", err);
    res.status(500).json({ error: "Failed to load services" });
  }
}

export function getPublicServiceImage(req, res) {
  try {
    const id = String(req.params.id || "");
    const blob = getServiceImageBlob(id);
    if (blob) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(blob);
      return;
    }

    const listed = listServices().find((service) => service.id === id);
    const filename = imageFilenameFromUrl(listed?.imageUrl);
    if (filename) {
      const filePath = path.join(SERVICE_UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
        return;
      }
    }

    res.status(404).end();
  } catch (err) {
    console.error("Failed to load service image:", err);
    res.status(404).end();
  }
}
