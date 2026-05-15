// Vitest setup. Intentionally minimal — DO NOT globally pin process.platform
// here. Doing so makes execSync/spawnSync default to cmd.exe on Linux CI
// runners, which then ENOENTs. Per-test platform overrides live in
// host_functions.test.ts.
