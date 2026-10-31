import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { callKimi, generateImagePrompts, type PublishRequest, type PublishResult } from "@/lib/kimi";
import { generateImages, optimizeUpload } from "@/lib/image-gen";
import { buildMdx, commitFiles, type FileEntry } from "@/lib/github";

export const maxDuration = 300;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("KIMI_API_KEY")) return "El asistente de texto no está configurado. Contacta al administrador.";
  if (msg.includes("GEMINI_API_KEY")) return "El generador de imágenes no está configurado. Contacta al administrador.";
  if (msg.includes("AbortError") || msg.includes("aborted")) return "El asistente tardó demasiado en responder. Inténtalo de nuevo en un momento.";
  return msg;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." }, { status: 401 });
  }

  let input: PublishRequest;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
  }

  const dryRun = input.dryRun === true || process.env.DRY_RUN === "true";
  const { rawText, answers, overrides } = input;

  // ---- validación ----
  if (!rawText || rawText.trim().length < 30) {
    return NextResponse.json({ error: "El texto es demasiado corto. Pega el contenido completo del artículo." }, { status: 400 });
  }
  if (!answers || !Array.isArray(answers.verticals) || answers.verticals.length === 0) {
    return NextResponse.json({ error: "Falta elegir al menos una vertical en la encuesta." }, { status: 400 });
  }
  if (!answers.articleType) {
    return NextResponse.json({ error: "Falta elegir el tipo de artículo." }, { status: 400 });
  }
  if (!["generate", "upload", "none"].includes(answers.images)) {
    return NextResponse.json({ error: "La opción de imágenes no es válida." }, { status: 400 });
  }
  if (answers.images === "generate" && (!answers.imageCount || answers.imageCount < 1 || answers.imageCount > 4)) {
    return NextResponse.json({ error: "El número de imágenes a generar debe estar entre 1 y 4." }, { status: 400 });
  }
  if (answers.images === "upload" && (!answers.uploadedImages || answers.uploadedImages.length === 0)) {
    return NextResponse.json({ error: "Elegiste subir tus propias imágenes pero no subiste ninguna." }, { status: 400 });
  }

  try {
    // ---- LLM de texto ----
    let article;
    const o = overrides || {};
    const regenerating = input.regenerate === "metadata";
    const hasFullOverrides = o.title && o.slug && o.excerpt && o.tags && o.bodyMarkdown;

    if (hasFullOverrides && !regenerating) {
      article = {
        title: o.title!, slug: slugify(o.slug!), excerpt: o.excerpt!,
        tags: o.tags!, bodyMarkdown: o.bodyMarkdown!,
      };
    } else {
      const extra = regenerating
        ? "Regenera SOLO title, slug, excerpt y tags. Devuelve bodyMarkdown exactamente igual (copia el texto original sin cambios)."
        : undefined;
      try {
        article = await callKimi(rawText, answers, extra);
      } catch (firstErr) {
        // un reintento si falla el parseo
        article = await callKimi(rawText, answers, extra);
        void firstErr;
      }
      if (o.bodyMarkdown && !regenerating) article.bodyMarkdown = o.bodyMarkdown;
    }

    article.slug = slugify(article.slug || article.title);
    if (!article.slug) throw new Error("No se pudo generar una dirección (slug) para el artículo.");
    article.tags = (article.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8);

    // ---- imágenes ----
    const imageFiles: FileEntry[] = [];
    let imagePaths: string[] = [];
    let previewImages: { url: string; caption?: string }[] = [];

    if (answers.images === "generate") {
      const prompts = await generateImagePrompts(rawText, article, answers.imageCount!, answers.imageStyle);
      const imgs = await generateImages(prompts);
      imagePaths = imgs.map((img, i) => `/images/blog/${article.slug}/img-${i + 1}${img.extension}`);
      imageFiles.push(
        ...imgs.map((img, i) => ({
          path: `public/images/blog/${article.slug}/img-${i + 1}${img.extension}`,
          content: img.buffer.toString("base64"),
          encoding: "base64" as const,
        }))
      );
      previewImages = imagePaths.map((url, i) => ({ url, caption: prompts[i] }));
    } else if (answers.images === "upload") {
      const uploads = answers.uploadedImages!;
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const img = await optimizeUpload(u.dataUrl);
        const name = `img-${i + 1}${img.extension}`;
        imagePaths.push(`/images/blog/${article.slug}/${name}`);
        imageFiles.push({
          path: `public/images/blog/${article.slug}/${name}`,
          content: img.buffer.toString("base64"),
          encoding: "base64",
        });
        previewImages.push({ url: imagePaths[i], caption: u.caption });
      }
    }

    // ---- MDX ----
    const dateISO = new Date().toISOString().slice(0, 10);
    const mdx = buildMdx({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      tags: article.tags,
      verticals: answers.verticals.slice(0, 2),
      bodyMarkdown: article.bodyMarkdown,
      imagePath: imagePaths[0] ?? null,
      comments: answers.comments !== false,
      share: answers.share !== false,
      dateISO,
    });

    const result: PublishResult = {
      ok: true,
      dryRun,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      tags: article.tags,
      bodyMarkdown: article.bodyMarkdown,
      images: previewImages,
      mdx,
    };

    if (dryRun) {
      return NextResponse.json(result);
    }

    // ---- commit atómico a GitHub ----
    const files: FileEntry[] = [
      { path: `content/blog/${article.slug}.mdx`, content: mdx, encoding: "utf-8" },
      ...imageFiles,
    ];
    const commit = await commitFiles(files, `feat(content): ${article.slug} via Belong Studio`);
    result.commit = commit;
    result.articleUrl = `https://fundacionbelong.org/conocimiento/blog/${article.slug}/`;
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: friendlyError(e) }, { status: 500 });
  }
}
