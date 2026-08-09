import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// ESLint was present but had no configuration before 0.3.3. The first usable
// run exposed 120 long-standing errors. Keep each exception scoped to the
// exact legacy files and rules; new files remain on the recommended defaults.
const explicitAnyBaseline = [
  "src/console.ts",
  "src/core/agent.ts",
  "src/llm/anthropic.ts",
  "src/llm/gemini.ts",
  "src/llm/noop.ts",
  "src/llm/openai.ts",
  "src/tools/replay.ts",
  "src/tools/tool-executor.ts",
  "src/tools/tool-utils.ts",
  "src/tools/xray.ts",
  "src/types.ts",
];

const requireImportBaseline = [
  "src/address.ts",
  "src/connect/endpoint.ts",
  "src/llm/anthropic.ts",
  "src/llm/gemini.ts",
];

const unusedVariableBaseline = [
  "src/core/agent.ts",
  "src/llm/index.ts",
  "src/llm/noop.ts",
  "src/llm/openai.ts",
  "src/trust/index.ts",
];

const unsafeFunctionBaseline = [
  "src/core/agent.ts",
  "src/tools/replay.ts",
  "src/tools/tool-utils.ts",
  "src/types.ts",
];

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: explicitAnyBaseline,
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: requireImportBaseline,
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: unusedVariableBaseline,
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    files: unsafeFunctionBaseline,
    rules: { "@typescript-eslint/no-unsafe-function-type": "off" },
  },
  {
    files: ["src/tools/tool-utils.ts"],
    rules: { "no-useless-catch": "off" },
  },
  {
    files: ["src/tools/xray.ts"],
    rules: { "prefer-const": "off" },
  },
);
