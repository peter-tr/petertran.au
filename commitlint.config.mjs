export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        // workspaces
        "api",
        "web",
        "infra",
        // projects (mirrored under api/src, web/src, infra/lib)
        "portfolio",
        "pantry",
        "imposter",
        "design-studio",
        "shared",
        // cross-cutting
        "deps",
        "ci",
      ],
    ],
  },
};
