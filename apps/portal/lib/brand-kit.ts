import { ProjectBrandKit, type BrandAssetBundle } from "@rs/contracts";
import { getPrivate, putPrivate } from "./blob";

export const BRAND_KIT_PATH = (projectId: string) =>
  `projects/${projectId}/brand-kit/kit.json`;

const LOGO_MIMES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const HERO_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/jpg"]);

const MAX_LOGO_BYTES = 2_000_000;
const MAX_HERO_BYTES = 8_000_000;

export function emptyBrandKit(projectId: string): ProjectBrandKit {
  return {
    schema_version: "brand-kit/1",
    project_id: projectId,
    logo: null,
    hero: null,
    updated_at: new Date().toISOString(),
  };
}

export async function loadProjectBrandKit(
  projectId: string,
): Promise<ProjectBrandKit | null> {
  try {
    const raw = await getPrivate(BRAND_KIT_PATH(projectId));
    const parsed = ProjectBrandKit.safeParse(JSON.parse(raw.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveProjectBrandKit(kit: ProjectBrandKit): Promise<ProjectBrandKit> {
  const next = ProjectBrandKit.parse({
    ...kit,
    updated_at: new Date().toISOString(),
  });
  await putPrivate(BRAND_KIT_PATH(kit.project_id), JSON.stringify(next, null, 2), "application/json");
  return next;
}

function extForMime(mime: string, role: "logo" | "hero"): string {
  if (mime.includes("svg")) return "svg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  return role === "logo" ? "png" : "jpg";
}

export function sniffImageMime(bytes: Uint8Array, filename: string, declared?: string | null): string {
  const name = filename.toLowerCase();
  if (declared && declared.startsWith("image/")) {
    if (declared === "image/jpg") return "image/jpeg";
    return declared;
  }
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  // SVG often arrives as text/plain / octet-stream from browsers.
  const head = Buffer.from(bytes.slice(0, 256)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.includes("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export type BrandKitUploadInput = {
  projectId: string;
  actorEmail?: string;
  logo?: { bytes: Uint8Array; filename: string; mime?: string | null } | null;
  hero?: { bytes: Uint8Array; filename: string; mime?: string | null } | null;
};

/**
 * Persist client logo / hero uploads and return the merged brand kit.
 * Does not invent assets — only stores what the operator supplies.
 */
export async function upsertBrandKitAssets(
  input: BrandKitUploadInput,
): Promise<ProjectBrandKit> {
  const existing = (await loadProjectBrandKit(input.projectId)) ?? emptyBrandKit(input.projectId);
  let logo = existing.logo;
  let hero = existing.hero;
  const now = new Date().toISOString();

  if (input.logo) {
    if (input.logo.bytes.byteLength === 0) throw new Error("logo file is empty");
    if (input.logo.bytes.byteLength > MAX_LOGO_BYTES) {
      throw new Error(`logo exceeds ${MAX_LOGO_BYTES} byte limit`);
    }
    const mime = sniffImageMime(input.logo.bytes, input.logo.filename, input.logo.mime);
    if (!LOGO_MIMES.has(mime)) {
      throw new Error("logo must be SVG, PNG, JPEG, or WebP");
    }
    const ext = extForMime(mime, "logo");
    const blob_path = `projects/${input.projectId}/brand-kit/logo.${ext}`;
    await putPrivate(blob_path, input.logo.bytes, mime);
    logo = {
      blob_path,
      mime,
      filename: input.logo.filename,
      uploaded_at: now,
      uploaded_by: input.actorEmail,
      bytes: input.logo.bytes.byteLength,
    };
  }

  if (input.hero) {
    if (input.hero.bytes.byteLength === 0) throw new Error("hero file is empty");
    if (input.hero.bytes.byteLength > MAX_HERO_BYTES) {
      throw new Error(`hero exceeds ${MAX_HERO_BYTES} byte limit`);
    }
    const mime = sniffImageMime(input.hero.bytes, input.hero.filename, input.hero.mime);
    if (!HERO_MIMES.has(mime) && mime !== "image/jpeg") {
      throw new Error("hero must be PNG, JPEG, or WebP (full-bleed photo)");
    }
    const safeMime = mime === "image/jpg" ? "image/jpeg" : mime;
    const ext = extForMime(safeMime, "hero");
    const blob_path = `projects/${input.projectId}/brand-kit/banner.${ext}`;
    await putPrivate(blob_path, input.hero.bytes, safeMime);
    hero = {
      blob_path,
      mime: safeMime,
      filename: input.hero.filename,
      uploaded_at: now,
      uploaded_by: input.actorEmail,
      bytes: input.hero.bytes.byteLength,
      kind: "photo",
    };
  }

  if (!input.logo && !input.hero) {
    throw new Error("provide logo and/or hero file");
  }

  return saveProjectBrandKit({
    schema_version: "brand-kit/1",
    project_id: input.projectId,
    logo,
    hero,
    updated_at: now,
  });
}

/**
 * Prefer client-uploaded logo/hero over extraction figures.
 * Order: client SVG/PNG logo > extraction (SVG preferred in picker);
 * client hero photo > extraction banner strip / page render.
 */
export function applyClientBrandKit(
  bundle: BrandAssetBundle,
  kit: ProjectBrandKit | null | undefined,
): BrandAssetBundle {
  if (!kit?.logo && !kit?.hero) return bundle;
  const others = bundle.assets.filter((a) => a.role !== "logo" && a.role !== "banner");
  const assets: BrandAssetBundle["assets"] = [...others];

  if (kit.logo?.blob_path) {
    const svg = (kit.logo.mime || "").includes("svg");
    assets.unshift({
      role: "logo",
      blob_path: kit.logo.blob_path,
      mime: kit.logo.mime,
      origin: svg ? "client_upload_svg" : "client_upload",
      licence: "client",
    });
  } else {
    const extractionLogo = bundle.assets.find((a) => a.role === "logo");
    if (extractionLogo) assets.unshift(extractionLogo);
  }

  if (kit.hero?.blob_path) {
    assets.push({
      role: "banner",
      blob_path: kit.hero.blob_path,
      mime: kit.hero.mime,
      origin: "client_upload_photo",
      background: "photo",
      licence: "client",
    });
  } else {
    const extractionBanner = bundle.assets.find((a) => a.role === "banner");
    if (extractionBanner) assets.push(extractionBanner);
  }

  return {
    ...bundle,
    assets,
  };
}

export function brandOrigins(bundle: BrandAssetBundle | null | undefined): {
  logoOrigin: string | null;
  bannerOrigin: string | null;
  logoIsClient: boolean;
  bannerIsClient: boolean;
  logoIsSvg: boolean;
} {
  const logo = bundle?.assets.find((a) => a.role === "logo");
  const banner = bundle?.assets.find((a) => a.role === "banner");
  const logoOrigin = logo?.origin ?? null;
  const bannerOrigin = banner?.origin ?? null;
  return {
    logoOrigin,
    bannerOrigin,
    logoIsClient: Boolean(logoOrigin?.startsWith("client_upload")),
    bannerIsClient: Boolean(bannerOrigin?.startsWith("client_upload")),
    logoIsSvg:
      Boolean(logoOrigin?.includes("svg")) || Boolean(logo?.mime?.includes("svg")),
  };
}
