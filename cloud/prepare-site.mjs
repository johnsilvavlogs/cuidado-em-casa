import { cp, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
function argument(name, fallback) {
  const index = arguments_.indexOf(name);
  return index === -1 ? fallback : arguments_[index + 1];
}
const starter = path.resolve(argument("--starter", path.join(repository, "output/sites-cloud/starter")));
const target = path.resolve(argument("--target", path.join(repository, "output/sites-cloud/cuidado-em-casa")));
if (starter === target || target === repository || !target.startsWith(`${repository}${path.sep}`)) {
  throw new Error("The Site target must be a separate directory inside this repository.");
}
await stat(path.join(target, ".git"));

async function copy(source, destination, filter) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true, filter });
}
async function write(relative, value) {
  const filename = path.join(target, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, value);
}
async function json(filename, fallback) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function transform(relative, update) {
  const filename = path.join(target, relative);
  await write(relative, update(await readFile(filename, "utf8")));
}

// The source helper owns .git and Site identity. Never copy either from a template.
const manifestPath = path.join(target, ".openai/hosting.json");
const hosting = await json(manifestPath, {});
if (!hosting.project_id) throw new Error("Open the existing Site through the source helper before preparing it.");

for (const entry of ["scripts", "worker", "lib", "db", "vite.config.ts", "next.config.ts", "postcss.config.mjs", "drizzle.config.ts", "eslint.config.mjs", ".npmrc", ".gitignore"]) {
  await copy(path.join(starter, entry), path.join(target, entry), (source) => source !== path.join(starter, "lib/utils.ts"));
}
try { await unlink(path.join(target, "lib/utils.ts")); } catch (error) { if (error.code !== "ENOENT") throw error; }
await transform(".npmrc", (source) => source + "\nlegacy-peer-deps=true\n");
try { await stat(path.join(target, "drizzle/meta/_journal.json")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  await copy(path.join(starter, "drizzle"), path.join(target, "drizzle"));
}
for (const entry of ["components", "lib"]) {
  await copy(path.join(repository, "src", entry), path.join(target, "src", entry));
}
await copy(path.join(repository, "src/app"), path.join(target, "app"));
await copy(path.join(repository, "src/app/page.tsx"), path.join(target, "app/app/page.tsx"));
await unlink(path.join(target, "app/page.tsx"));
await transform("app/app/page.tsx", (source) => source
  .replace("${window.location.origin}/?demo=", "${window.location.origin}/app?demo=")
  .replaceAll('"", `/?demo=', '"", `/app?demo=')
  .replaceAll('"", "/")', '"", "/app")')
  .replaceAll("await response.json().catch(() => null)", "await response.json().catch(() => null) as (CareState & { error?: string; ok?: boolean }) | null"));
await write("app/play-demo/route.ts", `import { cookies } from "next/headers";
import { DEMO_SESSION_COOKIE, startDemo } from "@/lib/server/care-store";
import { errorResponse, privateHeaders } from "@/lib/server/care-http";

export async function GET(request: Request) {
  try {
    const { token, state } = await startDemo({ scenario: "ready", role: "patient" });
    (await cookies()).set(DEMO_SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 86400 });
    const target = new URL("/app", request.url);
    target.searchParams.set("demo", state.demoId);
    target.searchParams.set("role", state.role);
    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: target.href } });
  } catch (error) { return errorResponse(error); }
}
`);
await transform("src/components/voice-panel.tsx", (source) => source
  .replace("const message = await response.json();", "const message = await response.json() as { error?: string };")
  .replaceAll("const result = await response.json();", "const result = await response.json() as CareState & { error?: string; transport?: { sdp?: string } };"));
await copy(path.join(repository, "public"), path.join(target, "public"));

const staticExtensions = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".mp4", ".webm"]);
const staticFilter = async (source) => (await stat(source)).isDirectory() || staticExtensions.has(path.extname(source).toLowerCase());
await copy(path.join(repository, "website"), path.join(target, "public"), (source) => path.relative(path.join(repository, "website"), source) !== "index.html" && staticFilter(source));
await copy(path.join(repository, "docs"), path.join(target, "public/docs"), staticFilter);
let landing = await readFile(path.join(repository, "website/index.html"), "utf8");
landing = landing.replace(/(\b(?:src|href)=")(assets\/|styles\.css|config\.js|app\.js)/g, "$1/$2")
  .replace(/<a href="#previa"([^>]*\bdata-app-link\b[^>]*)>/g, '<a href="/play-demo"$1>');
await write("website/index.html", landing);
// The Worker must handle / so legacy shared links can redirect to /app.
try { await unlink(path.join(target, "public/index.html")); } catch (error) { if (error.code !== "ENOENT") throw error; }
await write("public/config.js", "window.CUIDADO_CONFIG = Object.freeze({ appUrl: '/play-demo' });\n");
await transform("public/app.js", (source) => source.replace("new URL(configured)", "new URL(configured, location.origin)").replace("url.protocol === 'https:'", "(url.protocol === 'https:' || url.origin === location.origin)"));
await transform("public/styles.css", (source) => source.replaceAll("url('assets/", "url('/assets/"));
await write("app/route.ts", `import landing from "../website/index.html?raw";

export function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("demo")) {
    url.pathname = "/app";
    return Response.redirect(url, 307);
  }
  return new Response(landing, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" } });
}
`);

// Leave framework-independent domain logic intact; replace only its storage boundary.
await transform("src/lib/server/care-store.ts", (source) => source
  .replace('import { CareRepository } from "./care-repository";', 'import { env } from "cloudflare:workers";\nimport { CloudCareRepository } from "../../../cloud/runtime/care-cloud-repository";')
  .replace(/const globalStore[^\n]*\nconst repository[^\n]*\n/, `function repository() {
  if (!env.DB || !env.DOCUMENTS) throw new Error("Cloud storage is not configured.");
  return new CloudCareRepository(env.DB, env.DOCUMENTS);
}
`)
  .replaceAll("repository.", "repository()."));
await transform("src/lib/ai/client.ts", (source) => 'import { env } from "cloudflare:workers";\n' + source
  .replaceAll("process.env.OPENAI_API_KEY", "env.OPENAI_API_KEY")
  .replace("new OpenAI({ timeout:", "new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout:"));
await transform("src/lib/server/openai.ts", (source) => 'import { env } from "cloudflare:workers";\n' + source
  .replaceAll("process.env.OPENAI_API_KEY", "env.OPENAI_API_KEY")
  .replaceAll("process.env.OPENAI_MODEL", "env.OPENAI_MODEL")
  .replace("new OpenAI({ timeout:", "new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout:"));
await transform("app/api/health/route.ts", (source) => source.replace('stage: "local-mvp"', 'stage: "cloud", storage: "d1-r2"'));

const templatePackage = await json(path.join(starter, "package.json"));
const sourcePackage = await json(path.join(repository, "package.json"));
const dependencies = { "drizzle-orm": templatePackage.dependencies["drizzle-orm"], ...sourcePackage.dependencies };
const devDependencies = { ...templatePackage.devDependencies, ...sourcePackage.devDependencies };
delete devDependencies["tw-animate-css"];
devDependencies["react-server-dom-webpack"] = sourcePackage.dependencies.react;
const package_ = {
  ...templatePackage, name: "cuidado-em-casa-cloud", engines: sourcePackage.engines,
  scripts: { ...templatePackage.scripts, typecheck: "tsc --noEmit" }, dependencies, devDependencies,
};
const previousPackage = await json(path.join(target, "package.json"), {});
await write("package.json", JSON.stringify(package_, null, 2) + "\n");
// A previous lock remains valid only when its dependency inputs still match.
if (JSON.stringify(previousPackage.dependencies) !== JSON.stringify(dependencies) || JSON.stringify(previousPackage.devDependencies) !== JSON.stringify(devDependencies)) {
  try { await unlink(path.join(target, "package-lock.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const tsconfig = await json(path.join(starter, "tsconfig.json"));
tsconfig.compilerOptions.target = "ES2022";
tsconfig.compilerOptions.paths = { "@/*": ["./src/*"] };
tsconfig.compilerOptions.types.push("vite/client");
await write("tsconfig.json", JSON.stringify(tsconfig, null, 2) + "\n");
await write("cloudflare-env.d.ts", `declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    DOCUMENTS: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }
}
`);
delete hosting.static;
hosting.d1 = "DB";
hosting.r2 = "DOCUMENTS";
await write(".openai/hosting.json", JSON.stringify(hosting, null, 2) + "\n");

// A separate owner supplies these files. They are copied unchanged when ready.
for (const [source, destination] of [["cloud/runtime", "cloud/runtime"], ["cloud/schema.ts", "db/schema.ts"], ["cloud/migrations", "drizzle"]]) {
  try { await copy(path.join(repository, source), path.join(target, destination)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
console.log(JSON.stringify({ target, project_id: hosting.project_id, routes: ["/", "/app", "/api/*"], dependencyInputsChanged: JSON.stringify(previousPackage) !== JSON.stringify(package_) }));
