import { getDb, SERVICE_UPLOADS_DIR } from "../db/connection.js";
import { persistAdminState } from "../db/persist.js";
import fs from "fs";
import path from "path";

function rowToService(row) {
  if (!row) return null;
  const outOfStock = Boolean(row.out_of_stock);
  const month = outOfStock ? 0 : Number(row.price_month);
  const year = outOfStock ? 0 : Number(row.price_year);
  return {
    id: row.id,
    icon: row.icon || "",
    accent: row.accent || "#38bdf8",
    typeEn: row.type_en,
    typeAr: row.type_ar,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    descriptionEn: row.description_en,
    descriptionAr: row.description_ar,
    prices: { month, year },
    imageUrl: row.image_url || null,
    hasCustomImage: Boolean(row.image_url || row.image_blob),
    outOfStock,
    sortOrder: row.sort_order,
  };
}

function deriveOutOfStock(prices, explicit) {
  if (typeof explicit === "boolean") return explicit;
  const month = Number(prices?.month);
  const year = Number(prices?.year);
  return (
    (Number.isFinite(month) && month === 0) ||
    (Number.isFinite(year) && year === 0)
  );
}

function sanitizePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Invalid price");
  }
  return Math.round(n * 1000) / 1000;
}

export function listServices() {
  const rows = getDb()
    .prepare("SELECT * FROM services ORDER BY sort_order ASC, name_en ASC")
    .all();
  return rows.map(rowToService);
}

export function getServiceById(id) {
  const row = getDb().prepare("SELECT * FROM services WHERE id = ?").get(id);
  return rowToService(row);
}

export function getServiceImageBlob(id) {
  const row = getDb().prepare("SELECT * FROM services WHERE id = ?").get(id);
  if (!row?.image_blob) return null;
  if (Buffer.isBuffer(row.image_blob)) return row.image_blob;
  if (typeof row.image_blob === "string") {
    return Buffer.from(row.image_blob, "base64");
  }
  return Buffer.from(row.image_blob);
}

export function imageFilenameFromUrl(imageUrl) {
  const raw = String(imageUrl || "");
  const parts = raw.split("/").filter(Boolean);
  const name = parts[parts.length - 1] || "";
  if (!name || name.includes("..") || name.includes("\\")) return "";
  return name;
}

export function writeServiceImageFile(imageUrl, imageBlob) {
  const name = imageFilenameFromUrl(imageUrl);
  if (!name || !imageBlob) return;
  fs.mkdirSync(SERVICE_UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SERVICE_UPLOADS_DIR, name), imageBlob);
}

export function countServices() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM services").get().n;
}

export function insertService(data, options = {}) {
  const db = getDb();
  // Place newly added services at the top so special offers are seen first.
  const minOrder =
    db.prepare("SELECT COALESCE(MIN(sort_order), 0) AS m FROM services").get().m -
    1;

  const outOfStock = deriveOutOfStock(data.prices, data.outOfStock);
  const month = outOfStock ? 0 : sanitizePrice(data.prices?.month ?? 0);
  const year = outOfStock ? 0 : sanitizePrice(data.prices?.year ?? 0);

  db.prepare(
    `INSERT INTO services (
      id, icon, accent, type_en, type_ar, name_en, name_ar,
      description_en, description_ar, price_month, price_year,
      image_url, image_blob, out_of_stock, sort_order, updated_at
    ) VALUES (
      @id, @icon, @accent, @typeEn, @typeAr, @nameEn, @nameAr,
      @descriptionEn, @descriptionAr, @priceMonth, @priceYear,
      @imageUrl, @imageBlob, @outOfStock, @sortOrder, datetime('now')
    )`,
  ).run({
    id: data.id,
    icon: data.icon || "✨",
    accent: data.accent || "#38bdf8",
    typeEn: data.typeEn || "Shared / Private",
    typeAr: data.typeAr || "مشترك / خاص",
    nameEn: data.nameEn,
    nameAr: data.nameAr || data.nameEn,
    descriptionEn: data.descriptionEn || "",
    descriptionAr: data.descriptionAr || "",
    priceMonth: month,
    priceYear: year,
    imageUrl: data.imageUrl || null,
    imageBlob: data.imageBlob || null,
    outOfStock: outOfStock ? 1 : 0,
    sortOrder: data.sortOrder ?? minOrder,
  });

  const created = getServiceById(data.id);
  if (data.imageBlob && data.imageUrl) {
    writeServiceImageFile(data.imageUrl, data.imageBlob);
  }
  if (options.persist !== false) persistAdminState();
  return created;
}

export function updateService(id, patch) {
  const current = getServiceById(id);
  if (!current) return null;

  const nextPrices = {
    month:
      patch.prices?.month !== undefined
        ? sanitizePrice(patch.prices.month)
        : current.prices.month,
    year:
      patch.prices?.year !== undefined
        ? sanitizePrice(patch.prices.year)
        : current.prices.year,
  };

  const outOfStock = deriveOutOfStock(
    nextPrices,
    typeof patch.outOfStock === "boolean" ? patch.outOfStock : undefined,
  );

  const next = {
    nameEn: typeof patch.nameEn === "string" ? patch.nameEn : current.nameEn,
    nameAr: typeof patch.nameAr === "string" ? patch.nameAr : current.nameAr,
    descriptionEn:
      typeof patch.descriptionEn === "string"
        ? patch.descriptionEn
        : current.descriptionEn,
    descriptionAr:
      typeof patch.descriptionAr === "string"
        ? patch.descriptionAr
        : current.descriptionAr,
    icon: typeof patch.icon === "string" ? patch.icon : current.icon,
    accent: typeof patch.accent === "string" ? patch.accent : current.accent,
    typeEn: typeof patch.typeEn === "string" ? patch.typeEn : current.typeEn,
    typeAr: typeof patch.typeAr === "string" ? patch.typeAr : current.typeAr,
    imageUrl:
      patch.imageUrl !== undefined ? patch.imageUrl : current.imageUrl,
    imageBlob:
      patch.imageBlob !== undefined ? patch.imageBlob : getServiceImageBlob(id),
    priceMonth: outOfStock ? 0 : nextPrices.month,
    priceYear: outOfStock ? 0 : nextPrices.year,
    outOfStock: outOfStock ? 1 : 0,
  };

  getDb()
    .prepare(
      `UPDATE services SET
        name_en = @nameEn,
        name_ar = @nameAr,
        description_en = @descriptionEn,
        description_ar = @descriptionAr,
        icon = @icon,
        accent = @accent,
        type_en = @typeEn,
        type_ar = @typeAr,
        image_url = @imageUrl,
        image_blob = @imageBlob,
        price_month = @priceMonth,
        price_year = @priceYear,
        out_of_stock = @outOfStock,
        updated_at = datetime('now')
      WHERE id = @id`,
    )
    .run({ ...next, id });

  if (next.imageBlob && next.imageUrl) {
    writeServiceImageFile(next.imageUrl, next.imageBlob);
  }

  const updated = getServiceById(id);
  persistAdminState();
  return updated;
}

export function deleteService(id) {
  const existing = getServiceById(id);
  if (!existing) return false;
  getDb().prepare("DELETE FROM services WHERE id = ?").run(id);
  persistAdminState();
  return true;
}

export function replaceAllServices(services) {
  const db = getDb();
  const rows = Array.isArray(services) ? services : [];
  const replace = db.transaction((list) => {
    db.prepare("DELETE FROM services").run();
    list.forEach((service, index) => {
      insertService(
        {
          ...service,
          sortOrder: service.sortOrder ?? index,
          imageUrl: service.imageUrl || null,
          imageBlob:
            service.imageBlob ||
            (service.imageBase64
              ? Buffer.from(service.imageBase64, "base64")
              : null),
        },
        { persist: false },
      );
    });
  });
  replace(rows);
  persistAdminState();
  return listServices();
}

export function seedServicesIfEmpty(defaults) {
  if (countServices() > 0) return false;
  replaceAllServices(
    defaults.map((service, index) => ({
      ...service,
      sortOrder: index,
      imageUrl: service.imageUrl || null,
    })),
  );
  return true;
}
