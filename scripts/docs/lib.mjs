/** Shared helpers for the documentation corpus tooling (KL-DOCS-001). */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const INBOX = "docs/source/inbox";
export const MANIFESTS = "docs/source/manifests";

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function listInboxFiles() {
  return readdirSync(INBOX)
    .filter((f) => f !== ".gitkeep" && f !== ".DS_Store")
    .sort()
    .map((name) => {
      const path = join(INBOX, name);
      const st = statSync(path);
      return { name, path, bytes: st.size };
    });
}

const EXT_TYPES = {
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".sha256": "text/plain (sha256 checksum list)",
  ".txt": "text/plain",
};

export function fileType(name) {
  const ext = name.slice(name.lastIndexOf("."));
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

/** Heuristic header-metadata extraction from the first 60 lines. */
export function extractDeclared(path, name) {
  let text = "";
  try {
    text = readFileSync(path, "utf8").slice(0, 8000);
  } catch {
    return {};
  }
  const lines = text.split("\n").slice(0, 60);
  const title =
    lines
      .find((l) => l.startsWith("# "))
      ?.slice(2)
      .trim() ?? "";
  const grab = (re) => {
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1].trim().replace(/\|/g, "/").replace(/[`*]/g, "").trim();
    }
    return "";
  };
  const version =
    grab(/^\|?\s*(?:\*\*)?Version(?:\*\*)?\s*\|?\s*:?\s*\|?\s*(v?\d+\.\d+\.\d+[^|]*)/i) ||
    (/-v(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? "");
  const date = grab(
    /^\|?\s*(?:\*\*)?Date(?:\*\*)?\s*\|?\s*:?\s*\|?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[^|]*)/i,
  );
  const owner = grab(/^\|?\s*(?:\*\*)?Owner(?:\*\*)?\s*\|?\s*:?\s*\|?\s*([^|]+)/i);
  const status = grab(/^\|?\s*(?:\*\*)?Status(?:\*\*)?\s*\|?\s*:?\s*\|?\s*([^|]+)/i);
  const declaredFilename = grab(/^\|?\s*(?:\*\*)?Filename(?:\*\*)?\s*\|?\s*:?\s*\|?\s*([^|]+)/i);
  return { title, version, date, owner, status, declaredFilename };
}

export function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
