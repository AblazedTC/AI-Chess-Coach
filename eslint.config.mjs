import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["frontend/**", "backend/**", "node_modules/**", "test-results/**", "chat-exports/**"],
  },
  {
    ...js.configs.recommended,
    files: ["qa/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["qa/**/*.ts"],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        project: "./tsconfig.qa.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
];
