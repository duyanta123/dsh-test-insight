import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const name = "dsh-test-insight";
export const inject = ["skills"];

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(rootDir, "skills");
const require = createRequire(import.meta.url);

export const metadata = {
  name,
  inject,
	phase: 5,
  status: "release_candidate",
};

function resolveSkillProvider(ctx, configuredProvider) {
  if (typeof configuredProvider === "function") return configuredProvider;
  try {
	const module = require("@deepseek-ai/dsh-skill-filesystem");
	if (typeof module?.FileSystemSkillProvider === "function") return module.FileSystemSkillProvider;
  } catch {
	// The peer is optional for package consumers outside a DSH host.
  }
  throw new Error("dsh-test-insight requires the host FileSystemSkillProvider or optional peer @deepseek-ai/dsh-skill-filesystem");
}

export function apply(ctx, config = {}) {
	const { FileSystemSkillProvider: configuredProvider, ...providerConfig } = config || {};
  let provider;
  ctx.skills.registerProvider((control) => {
	const Provider = resolveSkillProvider(ctx, configuredProvider);
	provider = new Provider(ctx, control, {
	  providerName: name,
	  includeDefaultRoots: false,
	  customSkillDirs: [skillsDir],
	  ...providerConfig,
	});
	return provider;
  });
  ctx.effect(
	function* () {
	  yield async () => {
		await provider?.dispose();
	  };
	},
	"dsh-test-insight skill provider",
  );
}

export function createPlugin() {
  return { ...metadata, skillsDir };
}
