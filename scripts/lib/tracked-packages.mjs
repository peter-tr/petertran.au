export const PACKAGE_RULES = [
  ["api/src/portfolio/", "portfolio"],
  ["api/src/pantry/", "pantry"],
  ["api/src/games/imposter/", "imposter"],
  ["api/src/shared/", "api-shared"],
  ["web/", "web"],
  ["infra/", "infra"],
  ["api/", "api"],
];

export function packageForPath(filePath) {
  for (const [prefix, pkg] of PACKAGE_RULES) {
    if (filePath.startsWith(prefix)) return pkg;
  }
  return null;
}
