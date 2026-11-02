const SITE_REPO = process.env.SITE_REPO || "fundacionbelong-a11y/fundacionbelong";
const SITE_BRANCH = process.env.SITE_BRANCH || "main";

function yamlString(s: string): string {
  return JSON.stringify(s); // JSON es YAML válido para strings
}

export interface MdxInput {
  title: string;
  slug: string;
  excerpt: string;
  tags: string[];
  verticals: string[];
  section: string; // directorio bajo content/ ("blog" o slug de sección nueva)
  sectionName: string; // nombre legible de la sección
  bodyMarkdown: string;
  imagePath: string | null;
  comments: boolean;
  share: boolean;
  dateISO: string; // YYYY-MM-DD
}

export function buildMdx(input: MdxInput): string {
  const frontmatter = [
    `title: ${yamlString(input.title)}`,
    `date: ${input.dateISO}`,
    `author: "Pamela López Zúñiga"`,
    `excerpt: ${yamlString(input.excerpt)}`,
    `tags: [${input.tags.map((t) => yamlString(t)).join(", ")}]`,
    `verticals: [${input.verticals.map((v) => yamlString(v)).join(", ")}]`,
    `section: ${yamlString(input.section)}`,
    `sectionName: ${yamlString(input.sectionName)}`,
    `image: ${input.imagePath ? yamlString(input.imagePath) : "null"}`,
    `comments: ${input.comments}`,
    `share: ${input.share}`,
  ].join("\n");
  return `---\n${frontmatter}\n---\n\n${input.bodyMarkdown.trim()}\n`;
}

export interface FileEntry {
  path: string; // repo-relative
  content: string; // utf8 o base64
  encoding: "utf-8" | "base64";
}

async function getToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // fallback: gh CLI
  const { execSync } = await import("child_process");
  try {
    return execSync("gh auth token", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error("No hay token de GitHub disponible para publicar.");
  }
}

async function ghApi(pathname: string, init: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub respondió con error (${res.status}).${body ? " " + body.slice(0, 300) : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getHeadSha(): Promise<string> {
  const ref = await ghApi(`/repos/${SITE_REPO}/git/ref/heads/${SITE_BRANCH}`);
  return ref.object.sha;
}

async function createBlob(entry: FileEntry): Promise<string> {
  const blob = await ghApi(`/repos/${SITE_REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: entry.content, encoding: entry.encoding }),
  });
  return blob.sha;
}

async function getBaseTree(): Promise<string> {
  const ref = await ghApi(`/repos/${SITE_REPO}/git/ref/heads/${SITE_BRANCH}`);
  const commit = await ghApi(`/repos/${SITE_REPO}/git/commits/${ref.object.sha}`);
  return commit.tree.sha;
}

/**
 * Crea UN commit atómico con todos los archivos (mdx + imágenes).
 */
export async function commitFiles(
  files: FileEntry[],
  message: string
): Promise<{ sha: string; url: string }> {
  if (files.length === 0) throw new Error("No hay archivos para publicar.");
  const [baseTree, headSha] = await Promise.all([getBaseTree(), getHeadSha()]);
  const treeEntries = await Promise.all(
    files.map(async (f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: await createBlob(f),
    }))
  );
  const tree = await ghApi(`/repos/${SITE_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
  });
  const commit = await ghApi(`/repos/${SITE_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });
  await ghApi(`/repos/${SITE_REPO}/git/refs/heads/${SITE_BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  return { sha: commit.sha, url: `https://github.com/${SITE_REPO}/commit/${commit.sha}` };
}
