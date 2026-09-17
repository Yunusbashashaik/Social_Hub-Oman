/** Factory catalog may be inserted only when this is exactly "1" (local/dev). */
export function isFactorySeedAllowed() {
  return process.env.ALLOW_FACTORY_SEED === "1";
}

export function factorySeedDisabled() {
  return !isFactorySeedAllowed();
}
