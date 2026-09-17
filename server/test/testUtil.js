import { DEFAULT_SERVICES } from "../src/config/defaultServices.js";

export function withFactorySeed(fn) {
  const prev = process.env.ALLOW_FACTORY_SEED;
  process.env.ALLOW_FACTORY_SEED = "1";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ALLOW_FACTORY_SEED;
    else process.env.ALLOW_FACTORY_SEED = prev;
  }
}

export function withoutFactorySeed(fn) {
  const prev = process.env.ALLOW_FACTORY_SEED;
  delete process.env.ALLOW_FACTORY_SEED;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ALLOW_FACTORY_SEED;
    else process.env.ALLOW_FACTORY_SEED = prev;
  }
}

export function factoryNameSet() {
  return new Set(DEFAULT_SERVICES.map((row) => row.nameEn));
}

export function assertNoFactoryNames(assert, services) {
  const factory = factoryNameSet();
  for (const row of services || []) {
    assert.equal(
      factory.has(row.nameEn),
      false,
      `factory name leaked onto live catalog: ${row.nameEn}`,
    );
  }
}
