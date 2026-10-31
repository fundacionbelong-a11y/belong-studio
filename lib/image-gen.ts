import sharp from "sharp";

export interface GeneratedImage {
  buffer: Buffer;
  mime: string;
  extension: string; // incluye el punto, ej ".webp"
}

/**
 * Abstracción de proveedores de generación de imágenes.
 * IMAGE_PROVIDER=openrouter (default) usa el endpoint /images/generations de OpenRouter
 * con el modelo google/gemini-3.1-flash-image (último modelo de imagen disponible).
 * Nota: Kimi NO genera imágenes (verificado: modelos con salida solo texto) — Kimi se usa
 * para todo el procesamiento de texto; las imágenes van por OpenRouter con la key existente.
 */
export async function generateImages(prompts: string[]): Promise<GeneratedImage[]> {
  const provider = process.env.IMAGE_PROVIDER || "openrouter";
  switch (provider) {
    case "openrouter":
      return generateWithOpenRouter(prompts);
    case "gemini":
      return generateWithGemini(prompts);
    case "none":
      throw new Error("La generación de imágenes no está habilitada en este entorno.");
    default:
      throw new Error(`Proveedor de imágenes desconocido: ${provider}`);
  }
}

/** Último modelo de imagen disponible en OpenRouter (actualizar según /models). */
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-3.1-flash-image";

async function generateWithOpenRouter(prompts: string[]): Promise<GeneratedImage[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Falta la configuración de generación de imágenes (OPENROUTER_API_KEY).");
  const url = "https://openrouter.ai/api/v1/images/generations";
  const results: GeneratedImage[] = [];
  for (const prompt of prompts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: OPENROUTER_IMAGE_MODEL, prompt, n: 1 }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`El generador de imágenes respondió con error (${res.status}). ${detail}`);
      }
      const data = await res.json();
      const item = data?.data?.[0];
      const b64: string | undefined = item?.b64_json;
      const imgUrl: string | undefined = item?.url;
      let buffer: Buffer | null = null;
      if (b64) {
        buffer = Buffer.from(b64, "base64");
      } else if (imgUrl) {
        const imgRes = await fetch(imgUrl);
        if (!imgRes.ok) throw new Error("No se pudo descargar la imagen generada.");
        buffer = Buffer.from(await imgRes.arrayBuffer());
      }
      if (!buffer) throw new Error("El generador de imágenes no devolvió ninguna imagen.");
      results.push(await optimize(buffer));
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

async function generateWithGemini(prompts: string[]): Promise<GeneratedImage[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta la configuración de generación de imágenes (GEMINI_API_KEY).");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
  const results: GeneratedImage[] = [];
  for (const prompt of prompts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });
      if (!res.ok) {
        throw new Error(`El generador de imágenes respondió con error (${res.status}).`);
      }
      const data = await res.json();
      const parts: { inlineData?: { data: string; mimeType: string } }[] =
        data?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p.inlineData)?.inlineData;
      if (!img) throw new Error("El generador de imágenes no devolvió ninguna imagen.");
      const buffer = Buffer.from(img.data, "base64");
      results.push(await optimize(buffer));
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

/** Optimiza: máx ~1600px de ancho, convierte a WebP. */
async function optimize(input: Buffer): Promise<GeneratedImage> {
  try {
    const out = await sharp(input)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer: out, mime: "image/webp", extension: ".webp" };
  } catch {
    // si sharp no puede procesarla, la devolvemos tal cual
    return { buffer: input, mime: "image/png", extension: ".png" };
  }
}

/** Optimiza una imagen subida por la usuaria (dataURL base64). */
export async function optimizeUpload(dataUrl: string): Promise<GeneratedImage> {
  const m = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!m) throw new Error("Una de las imágenes subidas no es válida.");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Una de las imágenes supera el límite de 8 MB.");
  }
  return optimize(buffer);
}
