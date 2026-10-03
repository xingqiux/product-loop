import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  apiEnvelopeSchema,
  archiveManifestName,
  decisionListSchema,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  type LegacyImportBody,
  ok,
  type ProjectIdentity,
  projectCacheDirName,
  projectIdentityVersion,
  type RepoKind,
  type Result,
  renderCopy,
  repoKind,
  stage,
  tarEnd,
  tarFileHeader,
  tarPadding,
} from "@product-loop/model";
import type { Backend } from "../connect.ts";
import { doctorCopy } from "../copy/doctor.ts";
import type { Outcome } from "../output.ts";
import { shownFrom } from "../page/data.ts";
import { projectCacheDir, writeDecisionDoc, writeProjectCache } from "../project/cache.ts";
import { registeredAt } from "../project/current.ts";
import { ensureIgnoreRule, ignoreFileFor } from "../project/ignore.ts";
import { backendRemote, syncMainline } from "../project/mainline-sync.ts";
import { readFailure } from "../project/read-error.ts";
import { imagePattern, readText } from "./files.ts";
import { removeTracked } from "./git.ts";
import { cleanMainline } from "./mainline.ts";
import { assignRoundFiles, type MigrateState, planRounds } from "./migrate.ts";
import { pageImages } from "./migrate-pages.ts";
import type { DoctorScan } from "./scan.ts";

// ploop doctor --fix：按确认过的迁移对照执行迁移，见「08 版本与迁移」第四节第 3 步和第七节。
// 依次登记、归档、上传附件、导入并核对、标记完成，再写项目缓存和忽略规则，最后清理旧文件。
// 每一步失败都停下，不清理。重跑时先问后端停在哪一步，从那里接着做。
// 清理只删归档包清单里的文件，项目缓存要用的主线.md、决定.md 留下。已提交的用 git 删，单独提交一次。

const text = doctorCopy.run;

/** 大的包和导入要多等一会儿。 */
const longCall = { timeoutMs: 10 * 60_000 };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function fileError(file: string, error: unknown): ErrorBody<"NOT_FOUND"> {
  const { reason } = readFailure(error);
  const t = text.errors.file;
  return errorBody("NOT_FOUND", [
    { message: renderCopy(t.message, { file, reason }), hint: renderCopy(t.hint), where: file },
  ]);
}

/** 读不带外壳的响应。成功时返回数据。 */
async function envelopeOf(response: Response): Promise<Result<unknown, ErrorBody>> {
  const parsed = apiEnvelopeSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    const message = `HTTP ${response.status}`;
    return err(errorBody("INTERNAL", [{ message, hint: message }]));
  }
  return parsed.data.ok ? ok(parsed.data.data) : err(parsed.data.error);
}

// ---- 登记

/** 仓库类别：--repo，旧主线写的，已有的忽略规则写在哪里。不在仓库里的按自己的。 */
function repoKindOf(scan: DoctorScan, given: RepoKind | undefined): RepoKind | undefined {
  if (given !== undefined) return given;
  const { ignore } = scan;
  switch (ignore.kind) {
    case "noRepo":
      return "own";
    case "ignored":
      return ignore.rule.source.includes("info/exclude") ? "shared" : "own";
    case "notIgnored":
      return ignore.repoKind;
  }
}

type Registered = { readonly id: string; readonly repoKind: RepoKind };

async function register(
  backend: Backend,
  scan: DoctorScan,
  given: RepoKind | undefined,
): Promise<Result<Registered, ErrorBody>> {
  const before = await registeredAt(backend, scan.root);
  if (!before.ok) return before;
  if (before.value !== undefined) {
    const kind = repoKind.key(before.value.repoKind) ?? "own";
    return ok({ id: before.value.id, repoKind: kind });
  }
  const kind = repoKindOf(scan, given) ?? "own";
  const ignoreFile = await ignoreFileFor(scan.root, kind);
  if (!ignoreFile.ok) return ignoreFile;
  const source = scan.location.source?.dir ?? scan.root;
  const created = await backend.call((api) =>
    api.api.v1.projects.$post({
      json: {
        root: scan.root,
        repoKind: repoKind.label(kind),
        ignoreFile: ignoreFile.value,
        legacySource: source,
      },
    }),
  );
  if (!created.ok) return created;
  return ok({ id: created.value.data.project.id, repoKind: kind });
}

// ---- 归档

/** 整个包：第一个文件是清单，接着是各个旧文件，路径相对旧文件的位置。 */
async function* tarChunks(
  dir: string,
  files: readonly string[],
  manifest: string,
): AsyncGenerator<Uint8Array> {
  const list = new TextEncoder().encode(manifest);
  yield tarFileHeader(archiveManifestName, list.byteLength);
  yield list;
  yield tarPadding(list.byteLength);
  for (const file of files) {
    const bytes = await readFile(join(dir, file));
    yield tarFileHeader(file, bytes.byteLength);
    yield bytes;
    yield tarPadding(bytes.byteLength);
  }
  yield tarEnd();
}

type Archived = { readonly file: string; readonly files: number };

async function archive(
  backend: Backend,
  projectId: string,
  dir: string,
  files: readonly string[],
): Promise<Result<Archived, ErrorBody>> {
  const manifest: { path: string; size: number; sha256: string }[] = [];
  for (const path of files) {
    try {
      const bytes = await readFile(join(dir, path));
      manifest.push({ path, size: bytes.byteLength, sha256: sha256(bytes) });
    } catch (error) {
      return err(fileError(path, error));
    }
  }
  const temp = await mkdtemp(join(tmpdir(), "ploop-archive-"));
  try {
    const file = join(temp, "archive.tar.gz");
    const chunks = tarChunks(dir, files, JSON.stringify(manifest));
    await pipeline(Readable.from(chunks), createGzip(), createWriteStream(file));
    const hash = await hashFile(file);
    const body = await readFile(file);
    const sent = await backend.raw(
      `/api/v1/projects/${encodeURIComponent(projectId)}/legacy/archive?sha256=${hash}`,
      { method: "POST", body, headers: { "Content-Type": "application/gzip" } },
      longCall,
    );
    if (!sent.ok) return sent;
    const data = await envelopeOf(sent.value);
    if (!data.ok) return data;
    const received = data.value as { file: string; files: number };
    return ok({ file: received.file, files: received.files });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// ---- 附件

const contentTypes: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".json", "application/json"],
  [".html", "text/html"],
]);

/** 先 HEAD 问后端有没有，没有再 PUT。返回哈希。同一个文件只传一次。 */
function uploader(backend: Backend) {
  const done = new Map<string, string>();
  return async (file: string): Promise<Result<string, ErrorBody>> => {
    const known = done.get(file);
    if (known !== undefined) return ok(known);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (error) {
      return err(fileError(file, error));
    }
    const hash = sha256(bytes);
    const head = await backend.raw(`/api/v1/blobs/${hash}`, { method: "HEAD" });
    if (!head.ok) return head;
    if (head.value.status !== 200) {
      const type = contentTypes.get(extname(file).toLowerCase()) ?? "application/octet-stream";
      const put = await backend.call((api) =>
        api.api.v1.blobs[":hash"].$put(
          { param: { hash } },
          { init: { body: bytes, headers: { "Content-Type": type } } },
        ),
      );
      if (!put.ok) return put;
    }
    done.set(file, hash);
    return ok(hash);
  };
}

// ---- 导入

/** 按迁移对照拼出导入的内容，截图和快照先上传。 */
async function importBody(
  backend: Backend,
  scan: DoctorScan,
  state: MigrateState,
  sourceDir: string,
): Promise<Result<LegacyImportBody, ErrorBody>> {
  const walk = join(sourceDir, "walk");
  const upload = uploader(backend);
  const rounds = planRounds(state.pages.pages);
  const referenced = new Map<string, string>();
  for (const round of rounds) {
    for (const page of round.pages) {
      for (const image of pageImages(page.data))
        referenced.set(`${page.folder}/${image}`, round.key);
    }
  }
  const attachable = [...(await walkImages(walk)), ...scan.pages.facts];
  const files = assignRoundFiles(rounds, attachable, referenced);
  const out: LegacyImportBody["rounds"] = [];
  for (const round of rounds) {
    const pages: LegacyImportBody["rounds"][number]["pages"] = [];
    for (const page of round.pages) {
      if (page.data === undefined) {
        const hash = await upload(join(walk, page.file));
        if (!hash.ok) return hash;
        pages.push({ legacyId: page.legacyId, snapshot: hash.value });
        continue;
      }
      const images: { path: string; hash: string }[] = [];
      for (const image of pageImages(page.data)) {
        const hash = await upload(join(walk, page.folder, image));
        if (!hash.ok) return hash;
        images.push({ path: image, hash: hash.value });
      }
      pages.push({ legacyId: page.legacyId, data: page.data, images });
    }
    const attached: { path: string; hash: string }[] = [];
    for (const path of files.get(round.key) ?? []) {
      const hash = await upload(join(walk, path));
      if (!hash.ok) return hash;
      attached.push({ path, hash: hash.value });
    }
    out.push({
      legacyId: round.legacyId,
      stage: stage.label(round.stage),
      date: round.date,
      pages,
      files: attached,
    });
  }
  const original = await readText(join(sourceDir, "主线.md"));
  const decisions = state.decisions?.items ?? [];
  const queue = state.queue?.items ?? [];
  return ok({
    mainline: original === undefined ? null : { original, cleaned: cleanMainline(original) },
    decisions: [...decisions],
    queue: [...queue],
    rounds: out,
    expected: {
      rounds: rounds.length,
      pages: scan.pages.pages.length + scan.pages.htmlOnly.length,
      decisions: decisions.length,
      queue: queue.length,
      images: scan.pages.images,
    },
  });
}

/** walk/ 下全部的截图，路径相对 walk/。 */
async function walkImages(walk: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await readdir(join(walk, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walkImages(walk, path)));
    else if (entry.isFile() && imagePattern.test(path)) found.push(path);
  }
  return found;
}

// ---- 项目缓存和清理

/** 清理时留下的文件：项目缓存里新写的几个。只有旧文件本来就在项目缓存里时才会撞上。 */
const cacheFiles: ReadonlySet<string> = new Set([
  "主线.md",
  "决定.md",
  "project.json",
  "README.md",
]);

async function removeEmptyDirs(dir: string, stop: string): Promise<void> {
  let current = dir;
  while (current.startsWith(stop) && current !== stop) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

type Cleaned = {
  readonly removed: number;
  readonly kept: readonly string[];
  readonly gitRemoved: number;
  readonly warnings: readonly Issue[];
};

async function cleanup(scan: DoctorScan, state: MigrateState): Promise<Cleaned> {
  const source = scan.location.source;
  if (source === undefined) return { removed: 0, kept: [], gitRemoved: 0, warnings: [] };
  const inCache = source.kind === "projectCache";
  const kept = inCache ? scan.location.files.filter((file) => cacheFiles.has(file)) : [];
  const drop = scan.location.files.filter((file) => !kept.includes(file));
  const tracked = new Set(scan.location.tracked.filter((file) => drop.includes(file)));
  const warnings: Issue[] = [];
  let gitRemoved = 0;
  // 已经从 git 删掉的文件：提交失败时也删了，只是还没提交。
  let gitGone = false;
  if (tracked.size > 0) {
    const failed = await removeTracked(source.dir, [...tracked], renderCopy(text.commit));
    if (failed === undefined) gitRemoved = tracked.size;
    else {
      gitGone = failed.step === "commit";
      const t = gitGone ? text.errors.gitUncommitted : text.errors.git;
      warnings.push({ message: renderCopy(t.message), hint: renderCopy(t.hint) });
    }
  }
  let removed = gitRemoved + (gitGone ? tracked.size : 0);
  for (const file of drop) {
    // git 没删成的已提交文件留着，由用户处理
    if (tracked.has(file) && gitRemoved === 0 && !gitGone) continue;
    if (!tracked.has(file)) {
      await rm(join(source.dir, file), { force: true });
      removed++;
    }
    await removeEmptyDirs(dirname(join(source.dir, file)), source.dir);
  }
  await rm(state.dir, { recursive: true, force: true });
  // 旧文件夹整个是产品循环的，删空了连文件夹一起删（决定 175）
  if (source.kind === "folder") await removeEmptyDirs(source.dir, dirname(source.dir));
  return { removed, kept, gitRemoved, warnings };
}

/** 写 project.json、主线.md、决定.md 和忽略规则。 */
async function writeCache(
  backend: Backend,
  scan: DoctorScan,
  registered: Registered,
): Promise<Result<{ cacheDir: string; ignore?: { file: string; added: boolean } }, ErrorBody>> {
  const project = await registeredAt(backend, scan.root);
  if (!project.ok) return project;
  const skillVersion = project.value?.skillVersion ?? scan.currentVersion;
  const identity: ProjectIdentity = {
    schemaVersion: projectIdentityVersion,
    projectId: registered.id,
    skillVersion,
  };
  // 先取决定再写 project.json：写了 project.json，项目缓存里的旧文件就不再算旧布局
  const decisions = await backend.call((api) =>
    api.api.v1.projects[":pid"].decisions.$get({
      param: { pid: registered.id },
      query: { includeVoided: "true" },
    }),
  );
  if (!decisions.ok) return decisions;
  const list = decisionListSchema.parse(decisions.value.data);
  const cacheDir = await writeProjectCache(scan.root, identity);
  const remote = backendRemote(backend, registered.id);
  const synced = await syncMainline({ root: scan.root, identity, remote, mode: "pull" });
  if (!synced.ok) return synced;
  await writeDecisionDoc(scan.root, list);
  // 不在仓库里的不用写，已被忽略的不再写
  if (scan.ignore.kind !== "notIgnored") return ok({ cacheDir });
  const file = await ignoreFileFor(scan.root, registered.repoKind);
  if (!file.ok) return file;
  const added = await ensureIgnoreRule(file.value);
  return ok({ cacheDir, ignore: { file: file.value, added } });
}

// ---- 汇总

export type FixInput = {
  readonly backend: Backend;
  readonly scan: DoctorScan;
  readonly state: MigrateState;
  readonly repo: RepoKind | undefined;
};

/** 执行迁移。调用的一方已经确认没有要确认的地方。 */
export async function runFix({ backend, scan, state, repo }: FixInput): Promise<Outcome> {
  const source = scan.location.source;
  if (source === undefined) {
    const t = text.errors.noSource;
    return err(
      errorBody("NOT_FOUND", [{ message: renderCopy(t.message), hint: renderCopy(t.hint) }]),
    );
  }
  const registered = await register(backend, scan, repo);
  if (!registered.ok) return registered;
  const pid = registered.value.id;
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].legacy.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  const lines: string[] = [];
  let step = status.value.data.status;
  if (step === null) {
    const archived = await archive(backend, pid, source.dir, scan.location.files);
    if (!archived.ok) return archived;
    lines.push(
      renderCopy(text.archived, { count: archived.value.files, file: archived.value.file }),
    );
    step = "已归档";
  }
  if (step === "已归档") {
    const body = await importBody(backend, scan, state, source.dir);
    if (!body.ok) return body;
    const imported = await backend.call(
      (api) =>
        api.api.v1.projects[":pid"].legacy.import.$post({ param: { pid }, json: body.value }),
      longCall,
    );
    if (!imported.ok) return imported;
    const { counts } = imported.value.data;
    lines.push(renderCopy(text.imported, counts), renderCopy(text.importedMore, counts));
    step = "已导入";
  }
  if (step === "已导入") {
    const completed = await backend.call((api) =>
      api.api.v1.projects[":pid"].legacy.complete.$post({ param: { pid } }),
    );
    if (!completed.ok) return completed;
    const { ended, started } = completed.value.data;
    lines.push(renderCopy(text.versions, { ended, started }));
  }
  const cache = await writeCache(backend, scan, registered.value);
  if (!cache.ok) return cache;
  lines.push(renderCopy(text.cache, { dir: `${projectCacheDirName}/` }));
  const { ignore } = cache.value;
  if (ignore !== undefined) {
    lines.push(
      renderCopy(ignore.added ? text.ignore : text.ignoreKept, {
        file: shownFrom(scan.root)(ignore.file),
      }),
    );
  }
  const cleaned = await cleanup(scan, state);
  lines.push(renderCopy(text.cleaned, { count: cleaned.removed }));
  if (cleaned.kept.length > 0)
    lines.push(renderCopy(text.kept, { files: cleaned.kept.join("、") }));
  if (cleaned.gitRemoved > 0)
    lines.push(renderCopy(text.gitRemoved, { count: cleaned.gitRemoved }));
  return ok({
    kind: "doctor.fixed",
    data: {
      project: pid,
      root: scan.root,
      cacheDir: projectCacheDir(scan.root),
      removed: cleaned.removed,
      kept: cleaned.kept,
      gitRemoved: cleaned.gitRemoved,
    },
    lines: [renderCopy(text.title, { project: pid }), ...lines],
    next: [renderCopy(text.next)],
    warnings: [...cleaned.warnings],
  });
}
