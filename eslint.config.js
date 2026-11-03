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
        Logger: "readonly",
        SpreadsheetApp: "readonly",
        CalendarApp: "readonly",
        Calendar: "readonly",
        Tasks: "readonly",
        CacheService: "readonly",
        LockService: "readonly",
        Session: "readonly",
        ContentService: "readonly"
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
          vars: "local",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: [".vitest/Index.client.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        console: "readonly",
        marked: "readonly",
        MiniSearch: "readonly",
        google: "readonly"
      }
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-unused-vars": [
        "warn",
        {
          vars: "local",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
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
