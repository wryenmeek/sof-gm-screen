import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  {
    files: ["Code.gs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        DriveApp: "readonly",
        HtmlService: "readonly",
        UrlFetchApp: "readonly",
        Utilities: "readonly",
        ScriptApp: "readonly",
        PropertiesService: "readonly",
        MimeType: "readonly",
        Logger: "readonly"
      }
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "fetch",
        "localStorage"
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern:
            "^(doGet|getSessionList|getSessionManifest|getFilePayload|getScratchpadNotes|saveScratchpadNotes|_)"
        }
      ]
    }
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        window: "readonly",
        document: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  },
  {
    ignores: ["node_modules/**", ".agents/**", "dist/**"]
  }
];
