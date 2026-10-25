import fs from "node:fs/promises";
import path from "node:path";
import { ERROR_CODES, invalidInput } from "./errors.mjs";

// Plan §8 / Step 3: every output path is normalized, its parent chain is
// checked for symbolic links, and derived file names must stay inside the
// requested root before anything is written (atomic rename happens later).

export async function assertNoSymbolicLink(filePath, label = "output") {
  let current = path.resolve(filePath);
  for (let depth = 0; depth < 64; depth += 1) {
	let stats;
	try {
	  stats = await fs.lstat(current);
	} catch (error) {
	  if (error?.code === "ENOENT") {
		const parent = path.dirname(current);
		if (parent === current) return;
		current = parent;
		continue;
	  }
	  throw invalidInput(`cannot inspect ${label} path: ${current}`, ERROR_CODES.INVALID_OUTPUT, { path: current, cause: error.code || error.message });
	}
	if (stats.isSymbolicLink()) {
	  throw invalidInput(`${label} path traverses a symbolic link: ${current}`, ERROR_CODES.INVALID_OUTPUT, { path: current });
	}
	if (stats.isDirectory()) return;
	current = path.dirname(current);
  }
  throw invalidInput(`${label} path nesting is too deep: ${filePath}`, ERROR_CODES.INVALID_OUTPUT, { path: filePath });
}

export function assertInsideRoot(root, candidate, label = "output") {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
	throw invalidInput(`${label} path must stay inside the output root: ${candidate}`, ERROR_CODES.INVALID_OUTPUT, {
	  root: resolvedRoot,
	  path: resolved,
	});
  }
  return resolved;
}
