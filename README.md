# Belong Studio

CMS mínimo para que Pamela (no técnica) publique artículos en [fundacionbelong.org](https://fundacionbelong.org) sin pasar por un agente humano.

## Arquitectura

- **Next.js 15+ (App Router, TypeScript, Tailwind)** — API routes serverless (sin `output: export`).
- **Auth**: login con contraseña única (`STUDIO_PASSWORD`), sesión de 12h con cookie firmada (HS256, `jose`).
- **Wizard de publicación** (`/`): 3 pasos en español:
  1. Pegar texto plano.
  2. Encuesta (verticales, tipo de artículo, imágenes, toggles comentarios/compartir).
  3. Vista previa editable (título, slug, excerpt, tags) → Publicar.
- **Flujo server-side en `POST /api/publish`**:
  1. **Texto**: Kimi (`kimi-k2.7-code`) vía endpoint OpenAI-compatible `https://api.kimi.com/coding/v1`. Devuelve JSON estricto `{title, slug, excerpt, tags[], bodyMarkdown}` — solo formatea, no inventa contenido. Reintento 1 vez, timeout 60s.
  2. **Imágenes**: Gemini 2.5 Flash Image ("Nano Banana"), prompts escritos por Kimi. Abstracción en `lib/image-gen.ts` (`IMAGE_PROVIDER=gemini` por defecto; `none` desactiva). Optimización con `sharp` (WebP, máx 1600px).
  3. **GitHub**: commit atómico vía GitHub Git API (Contents/trees) al repo del sitio (`fundacionbelong-a11y/fundacionbelong`): `content/blog/<slug>.mdx` + `public/images/blog/<slug>/`. Mensaje: `feat(content): <slug> via Belong Studio`.
  4. **Deploy**: Vercel redeploya automáticamente al pushear a `main`. URL del artículo: `https://fundacionbelong.org/conocimiento/<slug>/`.
- **`DRY_RUN=true`**: procesa todo pero NO commitea a GitHub; devuelve el MDX resultante.

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `STUDIO_PASSWORD` | ✅ | Contraseña única de Pamela |
| `KIMI_API_KEY` | ✅ | Key de Kimi (texto + prompts de imagen) |
| `GEMINI_API_KEY` | si `images=generate` | Key de Gemini para generar imágenes |
| `GITHUB_TOKEN` | opcional | Si no está, usa `gh auth token` del sistema |
| `IMAGE_PROVIDER` | opcional | `gemini` (default) o `none` |
| `DRY_RUN` | opcional | `true` = no commitear a GitHub |
| `SITE_REPO` / `SITE_BRANCH` | opcional | default `fundacionbelong-a11y/fundacionbelong` / `main` |
| `KIMI_MODEL` | opcional | default `kimi-k2.7-code` |

## Desarrollo local

```bash
cp .env.local.example .env.local  # rellena las variables
npm install
npm run dev
```

## Deploy en Vercel

1. Crear repo en GitHub y pushear este proyecto.
2. En [vercel.com/new](https://vercel.com/new) importar el repo ( framework Next.js detectado automáticamente).
3. Configurar las variables de entorno anteriores en *Settings → Environment Variables*.
4. Deploy. Cada push a `main` redeploya el Studio.

> El sitio principal (fundacionbelong) es otro repo: este Studio solo commitea contenido a él; el redeploy del sitio ocurre por el push a su `main`.

## Estructura

```
app/
  page.tsx            # wizard (protegido)
  login/page.tsx      # login
  api/login|logout/   # sesión
  api/publish/        # procesamiento completo (Kimi + imágenes + GitHub)
lib/
  auth.ts             # cookie firmada (jose)
  kimi.ts             # cliente Kimi + parseo JSON estricto
  image-gen.ts        # proveedor de imágenes (Gemini) + optimización sharp
  github.ts           # MDX + commit atómico vía GitHub API
components/Wizard.tsx # UI del wizard
```
