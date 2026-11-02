"use client";

import { useState, useEffect, useRef } from "react";

export interface UploadedImage {
  dataUrl: string;
  caption?: string;
  name: string;
}

const VERTICALES = ["Experiencias", "Formatos", "Frameworks", "Opinión"];
const TIPOS = ["Reflexión", "Caso/Experiencia", "Guía práctica", "Análisis", "Noticia/comunicado", "Otro"];

type ImageChoice = "generate" | "upload" | "none";
type SectionChoice = "blog" | "nueva";

interface ApiResult {
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
  error?: string;
}

export default function Wizard() {
  const [step, setStep] = useState(1);
  const [rawText, setRawText] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const DRAFT_KEY = "belong-studio-draft";
  const [verticals, setVerticals] = useState<string[]>([]);
  const [articleType, setArticleType] = useState("");
  const [otherType, setOtherType] = useState("");
  const [sectionChoice, setSectionChoice] = useState<SectionChoice>("blog");
  const [newSectionName, setNewSectionName] = useState("");
  const [imageChoice, setImageChoice] = useState<ImageChoice>("none");
  const [imageCount, setImageCount] = useState(2);
  const [imageStyle, setImageStyle] = useState("");
  const [uploads, setUploads] = useState<UploadedImage[]>([]);
  const [comments, setComments] = useState(true);
  const [share, setShare] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [published, setPublished] = useState(false);

  // overrides editables en paso 3
  const [edTitle, setEdTitle] = useState("");
  const [edSlug, setEdSlug] = useState("");
  const [edExcerpt, setEdExcerpt] = useState("");
  const [edTags, setEdTags] = useState("");

  const step1Valid = rawText.trim().length >= 30;
  const step2Valid =
    verticals.length > 0 &&
    (articleType !== "Otro" || otherType.trim().length > 0) &&
    (sectionChoice !== "nueva" || newSectionName.trim().length >= 3) &&
    (imageChoice !== "upload" || uploads.length > 0);

  function toggleVertical(v: string) {
    setVerticals((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : prev.length < 2 ? [...prev, v] : prev
    );
  }

  async function callApi(regenerate?: boolean, publish?: boolean): Promise<ApiResult | null> {
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        rawText,
        answers: {
          verticals,
          articleType: articleType === "Otro" ? `Otro: ${otherType.trim()}` : articleType,
          section:
            sectionChoice === "nueva"
              ? { kind: "nueva", name: newSectionName.trim() }
              : { kind: "blog" },
          images: imageChoice,
          imageCount: imageChoice === "generate" ? imageCount : undefined,
          imageStyle: imageChoice === "generate" ? imageStyle : undefined,
          uploadedImages: imageChoice === "upload" ? uploads : undefined,
          comments,
          share,
        },
        dryRun: !publish,
      };
      if (regenerate) {
        body.regenerate = "metadata";
        body.overrides = { bodyMarkdown: result?.bodyMarkdown };
      } else if (result && step === 3) {
        body.overrides = {
          title: edTitle,
          slug: edSlug,
          excerpt: edExcerpt,
          tags: edTags.split(",").map((t) => t.trim()).filter(Boolean),
          bodyMarkdown: result.bodyMarkdown,
        };
      }
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ApiResult = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Algo salió mal. Inténtalo de nuevo.");
        return null;
      }
      setResult(data);
      setEdTitle(data.title || "");
      setEdSlug(data.slug || "");
      setEdExcerpt(data.excerpt || "");
      setEdTags((data.tags || []).join(", "));
      return data;
    } catch {
      setError("No se pudo conectar con el servidor. Inténtalo de nuevo.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    const data = await callApi(false, false);
    if (data) setStep(3);
  }

  async function handlePublish() {
    const data = await callApi(false, true);
    if (data?.articleUrl) {
      setPublished(true);
      setStep(4);
    }
  }

  async function handleRegenerate() {
    await callApi(true, false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setError("");
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024) {
        setError(`"${f.name}" supera 8 MB. Elige una imagen más liviana.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("No se pudo leer la imagen."));
        r.readAsDataURL(f);
      });
      setUploads((prev) => [...prev, { dataUrl, name: f.name }]);
    }
    e.target.value = "";
  }

  // ---- autoguardado del borrador (localStorage) ----
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        setRawText(draft);
        setSavedAt(new Date());
      }
    } catch { /* almacenamiento no disponible */ }
  }, []);

  useEffect(() => {
    if (!draftLoaded.current) return;
    const t = setTimeout(() => {
      try {
        if (rawText.trim()) {
          localStorage.setItem(DRAFT_KEY, rawText);
          setSavedAt(new Date());
        } else {
          localStorage.removeItem(DRAFT_KEY);
          setSavedAt(null);
        }
      } catch { /* noop */ }
    }, 800);
    return () => clearTimeout(t);
  }, [rawText]);

  // Limpieza amigable de texto: normaliza espacios, saltos de línea y viñetas comunes de WhatsApp/Notas.
  function magicFormat() {
    const cleaned = rawText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    setRawText(cleaned);
  }

  const charCount = rawText.trim().length;
  const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
  const readingMin = wordCount ? Math.max(1, Math.round(wordCount / 200)) : 0;

  const card = (selected: boolean) =>
    `rounded-xl border-2 p-4 text-left font-medium transition cursor-pointer ${
      selected
        ? "border-olive-600 bg-olive-300/20 text-olive-700"
        : "border-stone-200 bg-white hover:border-olive-400"
    }`;

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, desc: string) => (
    <button
      type="button"
      onClick={() => set(!on)}
      className={`w-full flex items-center justify-between rounded-xl border-2 p-4 ${on ? "border-olive-600 bg-amber-50" : "border-stone-200 bg-white"}`}
    >
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-stone-500">{desc}</span>
      </span>
      <span
        className={`w-11 h-6 rounded-full relative transition ${on ? "bg-olive-600" : "bg-stone-300"}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );

  const STEP_LABELS = ["Tu texto", "Detalles del artículo", "Vista previa"];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      {/* barra superior */}
      <header className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-ink-900">Belong Studio</h1>
          <p className="text-sm text-ink-500 mt-0.5">Hola Pamela — publica tus artículos directamente en fundacionbelong.org</p>
        </div>
        {savedAt && step === 1 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 bg-white rounded-full px-3 py-1.5 shadow-soft border border-pearl-200 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-olive-500"></span>
            Guardado automáticamente · {savedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </header>

      {/* indicador de pasos */}
      {step < 4 && (
        <div className="mb-6">
          <div className="flex gap-2 mb-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={"h-1.5 flex-1 rounded-full " + (s <= step ? "bg-olive-500" : "bg-pearl-200")}
              />
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Paso {Math.min(step, 3)} de 3 · {STEP_LABELS[step - 1]}
          </p>
        </div>
      )}

      <div className="bg-white rounded-[1.25rem] shadow-lift border border-pearl-200 p-6 md:p-8">

      {step === 1 && (
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink-900 mb-1">Paso 1 · Tu texto</h2>
          <p className="text-sm text-ink-500 mb-5">
            Pega aquí tu texto tal como lo escribiste (desde WhatsApp, Notas, donde sea). Nosotros le
            damos formato.
          </p>

          {/* cuadro de texto flotante */}
          <div className="relative rounded-2xl border border-pearl-200 bg-cream-50 shadow-soft focus-within:shadow-lift focus-within:border-olive-300 transition-all">
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={16}
              placeholder="Escribe o pega tu artículo aquí…"
              className="w-full bg-transparent p-5 md:p-6 focus:outline-none text-base leading-relaxed text-ink-900 placeholder:text-ink-300 resize-y min-h-[320px]"
            />
            {/* estadísticas flotantes */}
            <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-3 text-[11px] text-ink-500 bg-white/80 backdrop-blur rounded-full px-3 py-1 shadow-soft border border-pearl-200">
              <span>{charCount.toLocaleString("es-CO")} caracteres</span>
              {readingMin > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-ink-300"></span>
                  <span>Lectura ~{readingMin} min</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <button
              onClick={magicFormat}
              disabled={!rawText.trim()}
              title="Limpia espacios y saltos de línea extra de forma automática"
              className="inline-flex items-center gap-2 text-sm font-medium text-olive-700 bg-olive-300/15 border border-olive-300/40 rounded-full px-4 py-2 hover:bg-olive-300/30 hover:shadow-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span aria-hidden>✨</span> Formato mágico
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!step1Valid}
              className="inline-flex items-center gap-2 bg-olive-600 hover:bg-olive-700 text-white rounded-xl px-6 py-3 font-medium shadow-soft hover:shadow-lift hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              Continuar <span aria-hidden>→</span>
            </button>
          </div>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3">{error}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <h2 className="font-display text-xl md:text-2xl text-ink-900">Paso 2 · Cuéntanos del artículo</h2>

          <div>
            <h3 className="font-medium mb-2">¿Para qué es el contenido? (elige hasta 2)</h3>
            <div className="grid grid-cols-2 gap-2">
              {VERTICALES.map((v) => (
                <button key={v} onClick={() => toggleVertical(v)} className={card(verticals.includes(v))}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">¿Qué tipo de artículo es?</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {TIPOS.map((t) => (
                <button key={t} onClick={() => setArticleType(t)} className={card(articleType === t)}>
                  {t}
                </button>
              ))}
            </div>
            {articleType === "Otro" && (
              <input
                value={otherType}
                onChange={(e) => setOtherType(e.target.value)}
                placeholder="Cuéntanos: ¿qué tipo es?"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-olive-500"
              />
            )}
          </div>

          <div>
            <h3 className="font-medium mb-2">¿Dónde va a vivir este contenido?</h3>
            <div className="grid gap-2">
              <button onClick={() => setSectionChoice("blog")} className={card(sectionChoice === "blog")}>
                Blog — Conocimiento (sección actual de artículos)
              </button>
              <button onClick={() => setSectionChoice("nueva")} className={card(sectionChoice === "nueva")}>
                Es una sección nueva del sitio
              </button>
            </div>
            {sectionChoice === "nueva" && (
              <div className="mt-2">
                <input
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="Nombre de la nueva sección (ej: Historias, Recursos, Prensa…)"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-olive-500"
                />
                <p className="text-xs text-stone-400 mt-1">
                  Tu artículo abrirá esta sección y los siguientes contenidos podrán ir a ella.
                </p>
              </div>
            )}
          </div>

          <div>
            <h3 className="font-medium mb-2">¿Imágenes?</h3>
            <div className="grid gap-2">
              <button onClick={() => setImageChoice("generate")} className={card(imageChoice === "generate")}>
                Quiero que el agente las genere
              </button>
              <button onClick={() => setImageChoice("upload")} className={card(imageChoice === "upload")}>
                Voy a subir mis propias imágenes
              </button>
              <button onClick={() => setImageChoice("none")} className={card(imageChoice === "none")}>
                Sin imágenes
              </button>
            </div>

            {imageChoice === "generate" && (
              <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-4">
                <div>
                  <label className="block text-sm font-medium mb-1">¿Cuántas imágenes? (1 a 4)</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => setImageCount(n)}
                        className={`w-10 h-10 rounded-lg border-2 font-medium ${imageCount === n ? "border-olive-600 bg-amber-50" : "border-stone-200 bg-white"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Estilo deseado (opcional)
                  </label>
                  <input
                    value={imageStyle}
                    onChange={(e) => setImageStyle(e.target.value)}
                    placeholder="Ej: fotos cálidas de personas trabajando en equipo…"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-olive-500"
                  />
                </div>
              </div>
            )}

            {imageChoice === "upload" && (
              <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-4">
                <label className="block">
                  <span className="inline-block bg-white border-2 border-dashed border-stone-300 rounded-xl px-4 py-3 text-sm cursor-pointer hover:border-olive-500">
                    Elegir imágenes (máx. 8 MB c/u)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {uploads.map((u, i) => (
                    <div key={i} className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.dataUrl} alt={u.name} className="w-full h-28 object-cover rounded-lg" />
                      <input
                        value={u.caption || ""}
                        onChange={(e) =>
                          setUploads((prev) =>
                            prev.map((p, j) => (j === i ? { ...p, caption: e.target.value } : p))
                          )
                        }
                        placeholder="Pie de foto (opcional)"
                        className="w-full text-xs rounded border border-stone-300 px-2 py-1"
                      />
                      <button
                        onClick={() => setUploads((prev) => prev.filter((_, j) => j !== i))}
                        className="text-xs text-red-600 underline"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-medium">Opciones</h3>
            {toggle(comments, setComments, "Comentarios", "Permitir que los lectores comenten")}
            {toggle(share, setShare, "Compartir", "Mostrar botones para compartir en redes")}
          </div>

          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="text-stone-500 hover:underline">
              ← Atrás
            </button>
            <button
              onClick={handlePreview}
              disabled={!step2Valid || loading}
              className="inline-flex items-center gap-2 bg-olive-600 hover:bg-olive-700 text-white rounded-xl px-6 py-3 font-medium shadow-soft hover:shadow-lift hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
            >
              {loading ? "Preparando vista previa…" : "Ver vista previa →"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-5">
          <h2 className="font-display text-xl md:text-2xl text-ink-900">Paso 3 · Revisa tu artículo</h2>

          <div className="grid gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Título</label>
              <input value={edTitle} onChange={(e) => setEdTitle(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Dirección (slug)</label>
              <input value={edSlug} onChange={(e) => setEdSlug(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Resumen (excerpt)</label>
              <textarea value={edExcerpt} onChange={(e) => setEdExcerpt(e.target.value)} rows={2} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Etiquetas (separadas por comas)</label>
              <input value={edTags} onChange={(e) => setEdTags(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </div>
          </div>

          {result.images && result.images.length > 0 && (
            <div>
              <h3 className="font-medium mb-2">Imágenes</h3>
              <p className="text-xs text-stone-400 mb-2">
                {result.dryRun
                  ? "En la vista previa no se generan imágenes todavía; se crearán al publicar."
                  : "Las imágenes se publicarán junto al artículo."}
              </p>
            </div>
          )}

          <div>
            <h3 className="font-medium mb-2">Contenido</h3>
            <div className="rounded-xl border border-stone-200 p-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed bg-stone-50">
              {result.bodyMarkdown}
            </div>
          </div>

          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex flex-wrap justify-between gap-2">
            <button onClick={() => setStep(2)} className="text-stone-500 hover:underline self-center">
              ← Atrás
            </button>
            <div className="flex gap-2">
              <button
                onClick={handleRegenerate}
                disabled={loading}
                className="border border-olive-300 text-olive-700 rounded-xl px-4 py-2.5 font-medium hover:bg-olive-300/20 disabled:opacity-40"
              >
                {loading ? "…" : "Regenerar título/excerpt"}
              </button>
              <button
                onClick={handlePublish}
                disabled={loading}
                className="inline-flex items-center gap-2 bg-olive-600 hover:bg-olive-700 text-white rounded-xl px-6 py-3 font-medium shadow-soft hover:shadow-lift hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
              >
                {loading ? "Publicando…" : "Publicar 🎉"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && published && result?.articleUrl && (
        <div className="text-center py-8">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="font-display text-2xl md:text-3xl text-ink-900 mb-2">¡Tu artículo está publicado!</h2>
          <p className="text-ink-500 mb-1">
            En unos minutos estará en vivo (el sitio se está actualizando).
          </p>
          <a
            href={result.articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-olive-700 underline text-lg my-4 hover:text-olive-600"
          >
            Ver mi artículo en fundacionbelong.org
          </a>
          <p className="text-sm text-ink-500">
            ✨ No olvides compartirlo en tus redes. ¡Gracias por escribir para Belong!
          </p>
          <button
            onClick={() => {
              setStep(1);
              setRawText("");
              setSavedAt(null);
              try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
              setResult(null);
              setPublished(false);
              setVerticals([]);
              setArticleType("");
              setSectionChoice("blog");
              setNewSectionName("");
              setImageChoice("none");
              setUploads([]);
            }}
            className="mt-6 text-ink-500 hover:text-terra-600 hover:underline"
          >
            Escribir otro artículo
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
