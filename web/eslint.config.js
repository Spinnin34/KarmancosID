import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default [
  { ignores: [".astro/**", "dist/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  ...tseslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    },
  },
  {
    files: ["**/*.{ts,vue}", "scripts/**/*.mjs"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
