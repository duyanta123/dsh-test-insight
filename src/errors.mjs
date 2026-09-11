export const EXIT_CODES = Object.freeze({
  OK: 0,
  WARNING: 1,
  INVALID_INPUT: 2,
  CONTRACT_ERROR: 3,
});

export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_MODE: "INVALID_MODE",
  INVALID_REPOSITORY: "INVALID_REPOSITORY",
  INVALID_TARGET: "INVALID_TARGET",
  INVALID_GIT_INPUT: "INVALID_GIT_INPUT",
  INVALID_LIMIT: "INVALID_LIMIT",
  INVALID_OUTPUT: "INVALID_OUTPUT",
	INVALID_COVERAGE: "INVALID_COVERAGE",
  EXECUTION_NOT_AUTHORIZED: "EXECUTION_NOT_AUTHORIZED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  FS_NOT_OBSERVED: "FS_NOT_OBSERVED",
  UNSUPPORTED_FEATURE: "UNSUPPORTED_FEATURE",
  SCHEMA_INCOMPATIBLE: "SCHEMA_INCOMPATIBLE",
  SCAN_FAILED: "SCAN_FAILED",
  OUTPUT_FAILED: "OUTPUT_FAILED",
});

export class InsightError extends Error {
  constructor(message, { code = ERROR_CODES.INVALID_ARGUMENT, exitCode = EXIT_CODES.INVALID_INPUT, details = null, cause = undefined } = {}) {
	super(message, { cause });
	this.name = "InsightError";
	this.code = code;
	this.exitCode = exitCode;
	this.details = details;
  }
}

export function invalidInput(message, code = ERROR_CODES.INVALID_ARGUMENT, details = null) {
  return new InsightError(message, { code, exitCode: EXIT_CODES.INVALID_INPUT, details });
}

export function contractError(message, code = ERROR_CODES.SCHEMA_INCOMPATIBLE, details = null) {
  return new InsightError(message, { code, exitCode: EXIT_CODES.CONTRACT_ERROR, details });
}
