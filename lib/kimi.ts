export interface PublishAnswers {
  verticals: string[]; // hasta 2
  articleType: string; // o "Otro: ..."
  images: "generate" | "upload" | "none";
  imageCount?: number; // 1-4 si generate
  imageStyle?: string;
  comments: boolean;
  share: boolean;
  uploadedImages?: { dataUrl: string; caption?: string; name: string }[];
}

export interface PublishRequest {
  rawText: string;
  answers: PublishAnswers;
  // campos editables del paso 3 (vacíos en la primera llamada)
  overrides?: {
    title?: string;
    slug?: string;
    excerpt?: string;
    tags?: string[];
    bodyMarkdown?: string;
  };
  regenerate?: "metadata" | null; // solo regenerar título/excerpt/slug/tags
  dryRun?: boolean;
}

export interface PublishResult {
  ok: boolean;
  dryRun?: boolean;
  title?: string;
  slug?: string;
  excerpt?: string;
  tags?: string[];
  bodyMarkdown?: string;
  images?: { url: string; caption?: string }[];
  articleUrl?: string;
  mdx?: string;
  commit?: { sha: string; url: string };
  error?: string;
}

const KIMI_URL = "https://api.kimi.com/coding/v1/chat/completions";
const MODEL = process.env.KIMI_MODEL || "kimi-k2.7-code";

function getApiKey(): string {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error("Falta la configuración del asistente de texto (KIMI_API_KEY).");
  return key;
}

function buildSystemPrompt(): string {
  return `Eres el asistente editorial de Belong, una fundación. Tu única tarea es convertir texto plano escrito por Pamela (en español, a menudo desde WhatsApp o Notas) en un artículo de blog bien formateado.

REGLAS ESTRICTAS:
- NO inventes contenido, datos, citas ni ideas que no estén en el texto original.
- Solo formatea y estructura: corrige ortografía y puntuación obvias, agrega subtítulos ## cuando el texto lo amerita, convierte listas en listas de markdown, párrafos limpios.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código.
- El JSON debe tener exactamente esta forma:
{"title": string, "slug": string, "excerpt": string, "tags": string[], "bodyMarkdown": string}
- slug: kebab-case en minúsculas, sin acentos, corto (3-6 palabras).
- excerpt: máximo 2 oraciones, en español.
- tags: 3 a 6 etiquetas cortas en español.
- bodyMarkdown: el contenido completo del artículo en markdown limpio (puede incluir ## subtítulos).`;
}

function buildUserPrompt(rawText: string, answers: PublishAnswers, extra?: string): string {
  let p = `TEXTO ORIGINAL DE PAMELA:\n"""\n${rawText}\n"""\n\n`;
  p += `CONTEXTO DEL WIZARD:\n`;
  p += `- Verticales: ${answers.verticals.join(", ") || "sin definir"}\n`;
  p += `- Tipo de artículo: ${answers.articleType}\n`;
  if (extra) p += `\nINSTRUCCIÓN ADICIONAL: ${extra}\n`;
  return p;
}

export async function callKimi(
  rawText: string,
  answers: PublishAnswers,
  extraInstruction?: string
): Promise<{ title: string; slug: string; excerpt: string; tags: string[]; bodyMarkdown: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(KIMI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
        "x-canary-kfc": "always",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 1, // el modelo solo permite 1
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(rawText, answers, extraInstruction) },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`El asistente de texto respondió con error (${res.status}).${detail ? " Detalle: " + detail.slice(0, 200) : ""}`);
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    return parseStrictJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseStrictJson(content: string) {
  let text = content.trim();
  // quitar envoltorio de código si existe
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("La respuesta del asistente no contiene JSON válido.");
  text = text.slice(start, end + 1);
  const parsed = JSON.parse(text);
  for (const k of ["title", "slug", "excerpt", "tags", "bodyMarkdown"]) {
    if (!(k in parsed)) throw new Error(`La respuesta del asistente le falta el campo "${k}".`);
  }
  if (!Array.isArray(parsed.tags)) parsed.tags = [String(parsed.tags)];
  return parsed as { title: string; slug: string; excerpt: string; tags: string[]; bodyMarkdown: string };
}

/** Pide a Kimi N prompts de imagen editorial acordes al estilo Belong. */
export async function generateImagePrompts(
  rawText: string,
  article: { title: string; excerpt: string },
  count: number,
  style?: string
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(KIMI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
        "x-canary-kfc": "always",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 1,
        messages: [
          {
            role: "system",
            content:
              "Eres un director de arte. Genera prompts de imagen para un generador de imágenes (Gemini Flash Image). Responde ÚNICAMENTE con un array JSON de strings, sin texto extra. Estilo Belong: cálido, humano, diverso, profesional, luz natural, sin texto en las imágenes.",
          },
          {
            role: "user",
            content: `Artículo: "${article.title}". Resumen: ${article.excerpt}\n\nEscribe ${count} prompts de imagen (uno por elemento del array), en inglés, descriptivos, fotográficos/editoriales.${style ? ` Estilo deseado por la autora: ${style}.` : ""}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`No se pudieron crear las ideas de imagen (${res.status}).`);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const arr = JSON.parse(content.replace(/```(?:json)?/gi, "").trim());
    if (!Array.isArray(arr)) throw new Error("Respuesta de prompts inválida.");
    return arr.slice(0, count).map((p) => String(p));
  } finally {
    clearTimeout(timeout);
  }
}
