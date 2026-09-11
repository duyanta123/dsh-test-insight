#!/usr/bin/env node

export { main, parseArgs, printHelp, validateArgs } from './cli.mjs';

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("/test-insight.mjs")) {
  process.exitCode = await (await import('./cli.mjs')).main();
}
