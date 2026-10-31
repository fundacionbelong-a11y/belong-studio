import { NextRequest, NextResponse } from "next/server";

// Motor de comentarios propio de Belong.
// Cada artículo (slug) = un Discussion en GitHub Discussions (categoría General)
// cuyo título es el slug. Los comentarios se publican como el bot y el nombre
// del autor viaja en un marcador HTML dentro del body.

const REPO = process.env.SITE_REPO || "fundacionbelong-a11y/fundacionbelong";
const [REPO_OWNER, REPO_NAME] = REPO.split("/");
const REPO_ID = "R_kgDOSosyKA";
const CATEGORY_ID = "DIC_kwDOSosyKM4DKGFY";

const ALLOWED_ORIGINS = [
  "https://www.fundacionbelong.org",
  "https://fundacionbelong.org",
];

// rate limit simple en memoria: máx 3 comentarios/min por IP
const rateMap = new Map<string, number[]>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

function getToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("El servicio de comentarios no está configurado. Contacta al administrador.");
  return token;
}

async function ghGraphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error("No pudimos comunicarnos con GitHub. Inténtalo de nuevo en un momento.");
  }
  if (data.errors && data.errors.length > 0) {
    throw new Error(data.errors[0]?.message || "GitHub devolvió un error inesperado.");
  }
  return data.data as T;
}

interface GqlCommentNode {
  id: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  author?: { login: string } | null;
}

interface ParsedComment {
  id: string;
  author: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
}

const AUTHOR_MARKER = /^<!--\s*belong-author:\s*([\s\S]*?)\s*-->\s*\n?/;

function parseComment(node: GqlCommentNode): ParsedComment {
  const m = node.body.match(AUTHOR_MARKER);
  const author = m ? m[1].trim() : (node.author?.login ?? "Anónimo");
  return {
    id: node.id,
    author,
    body: m ? node.body.slice(m[0].length) : node.body,
    bodyHTML: node.bodyHTML,
    createdAt: node.createdAt,
  };
}

async function findDiscussionBySlug(slug: string): Promise<{ id: string } | null> {
  const data = await ghGraphql<{
    search: { nodes: { id: string; title: string }[] };
  }>(
    `query($query: String!) {
      search(query: $query, type: DISCUSSION, first: 10) {
        nodes { ... on Discussion { id title } }
      }
    }`,
    { query: `repo:${REPO_OWNER}/${REPO_NAME} type:discussions in:title ${slug}` }
  );
  const found = (data.search?.nodes || []).find((n) => n.title === slug);
  return found ? { id: found.id } : null;
}

async function getComments(slug: string): Promise<ParsedComment[]> {
  const discussion = await findDiscussionBySlug(slug);
  if (!discussion) return [];
  const data = await ghGraphql<{
    node: {
      comments: { nodes: GqlCommentNode[] };
    };
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on Discussion {
          comments(first: 100) {
            nodes { id body bodyHTML createdAt author { login } }
          }
        }
      }
    }`,
    { id: discussion.id }
  );
  const nodes = data.node?.comments?.nodes || [];
  return nodes.map(parseComment);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "desconocida"
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const stamps = (rateMap.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT) {
    rateMap.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  rateMap.set(ip, stamps);
  if (rateMap.size > 5000) rateMap.clear(); // evita crecimiento indefinido
  return true;
}

function fail(req: NextRequest, message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get("slug") || "";
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return fail(req, "El identificador del artículo no es válido.");
    }
    const comments = await getComments(slug);
    return NextResponse.json({ comments }, { headers: corsHeaders(req) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error inesperado.";
    return NextResponse.json(
      { error: `No pudimos cargar los comentarios. ${msg}` },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return fail(req, "Estás comentando muy rápido. Espera un minuto e inténtalo de nuevo.", 429);
  }

  let input: { slug?: string; author?: string; text?: string; website?: string };
  try {
    input = await req.json();
  } catch {
    return fail(req, "La solicitud no es válida.");
  }

  const { slug, author, text, website } = input;
  if (website) {
    // honeypot: silenciosamente aceptamos pero no publicamos
    return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return fail(req, "El identificador del artículo no es válido.");
  }
  const name = (author || "").trim();
  if (name.length < 2 || name.length > 60) {
    return fail(req, "Escribe tu nombre (entre 2 y 60 caracteres).");
  }
  const body = (text || "").trim();
  if (body.length < 3 || body.length > 2000) {
    return fail(req, "El comentario debe tener entre 3 y 2000 caracteres.");
  }

  try {
    let discussion = await findDiscussionBySlug(slug);
    if (!discussion) {
      const created = await ghGraphql<{
        createDiscussion: { discussion: { id: string } };
      }>(
        `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
          createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
            discussion { id }
          }
        }`,
        {
          repositoryId: REPO_ID,
          categoryId: CATEGORY_ID,
          title: slug,
          body: `Comentarios del artículo: https://www.fundacionbelong.org/conocimiento/blog/${slug}/`,
        }
      );
      discussion = { id: created.createDiscussion.discussion.id };
    }

    const fullBody = `<!-- belong-author: ${name} -->\n\n${body}`;
    const added = await ghGraphql<{
      addDiscussionComment: { comment: GqlCommentNode };
    }>(
      `mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment { id body bodyHTML createdAt author { login } }
        }
      }`,
      { discussionId: discussion.id, body: fullBody }
    );

    const comment = parseComment(added.addDiscussionComment.comment);
    return NextResponse.json({ ok: true, comment }, { headers: corsHeaders(req) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error inesperado.";
    return NextResponse.json(
      { error: `No pudimos publicar tu comentario. ${msg}` },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}
