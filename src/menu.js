/**
 * Terminal menu — displays numbered options and reads user selection.
 */

const readline = require("readline");

const MENU_OPTIONS = [
  { key: 0,  label: "Exit",                    id: "exit",          modifiesCode: false, description: "Exit CodeControlSystem" },
  { key: 1,  label: "Exception Handling",      id: "exceptions",    modifiesCode: true,  description: "Add try/catch/error handling to code" },
  { key: 2,  label: "Naming Conventions",      id: "naming",        modifiesCode: true,  description: "Fix names to language/industry standards" },
  { key: 3,  label: "Hard-Coded Data Audit",   id: "hardcoded",     modifiesCode: false, description: "Document all hard-coded values" },
  { key: 4,  label: "Dead Code Removal",       id: "deadcode",      modifiesCode: true,  description: "Remove unused/dormant code" },
  { key: 5,  label: "Security Review",         id: "security",      modifiesCode: false, description: "OWASP, NIST, ISO, GDPR audit" },
  { key: 6,  label: "README Validation",       id: "readme",        modifiesCode: true,  description: "Ensure comprehensive README.md" },
  { key: 7,  label: "Sensitive Data Check",    id: "secrets",       modifiesCode: false, description: "Scan for secrets in commits" },
  { key: 8,  label: "Naming Disconnects",      id: "disconnects",   modifiesCode: false, description: "Find UI/code/DB naming mismatches" },
  { key: 9,  label: "Code Complexity",         id: "complexity",    modifiesCode: false, description: "Flag complex functions and deep nesting" },
  { key: 10, label: "Dependency Audit",        id: "dependencies",  modifiesCode: false, description: "Check for outdated/vulnerable packages" },
  { key: 11, label: "DRY Violations",          id: "dry",           modifiesCode: false, description: "Find duplicated code patterns" },
  { key: 12, label: "Logging & Observability", id: "logging",       modifiesCode: true,  description: "Add missing logging at key points" },
  { key: 13, label: "Accessibility Audit",     id: "accessibility", modifiesCode: false, description: "WCAG 2.1 AA compliance check" },
  { key: 14, label: "Performance Red Flags",   id: "performance",   modifiesCode: false, description: "N+1 queries, re-renders, memory leaks" },
  { key: 15, label: "Test Coverage Report",    id: "testcoverage",  modifiesCode: false, description: "Analyze unit/integration/E2E/perf/contract tests" },
  { key: 16, label: "Test Execution",          id: "testexec",      modifiesCode: false, description: "Run tests and write results to report" },
  { key: 17, label: "Add Code Comments",       id: "comments",      modifiesCode: true,  description: "AI-powered documentation comments" },
  { key: 18, label: "WhatDidIBuild Output",    id: "wdib",          modifiesCode: false, description: "Generate video modules and documentation via WhatDidIBuild.ai" },
  { key: 19, label: "All",                     id: "all",           modifiesCode: true,  description: "Run all of the above" },
];

const MAX_CHOICE = MENU_OPTIONS[MENU_OPTIONS.length - 1].key;

const TEST_SUBMENU = [
  { key: 0, label: "None / Exit",       id: "none" },
  { key: 1, label: "Unit Tests",        id: "unit" },
  { key: 2, label: "Integration Tests", id: "integration" },
  { key: 3, label: "End-to-End Tests",  id: "e2e" },
  { key: 4, label: "Performance Tests", id: "performance" },
  { key: 5, label: "Contract Tests",    id: "contract" },
  { key: 6, label: "All",               id: "all" },
];

function displayMenu() {
  console.log("\n=== CodeControlSystem — Code Review & Maintenance ===\n");
  for (const opt of MENU_OPTIONS) {
    const num = String(opt.key).padStart(2, " ");
    console.log(`  ${num}. ${opt.label.padEnd(26)} — ${opt.description}`);
  }
  console.log("");
}

function promptChoice() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`Enter choice (0-${MAX_CHOICE}): `, (answer) => {
      rl.close();
      const choice = parseInt(answer.trim(), 10);
      if (isNaN(choice) || choice < 0 || choice > MAX_CHOICE) {
        console.log("Invalid choice.");
        resolve(null);
        return;
      }
      const selected = MENU_OPTIONS.find((o) => o.key === choice);
      resolve(selected || null);
    });
  });
}

function displayTestSubmenu() {
  console.log("\n--- Test Execution — Select Test Type ---\n");
  for (const opt of TEST_SUBMENU) {
    const num = String(opt.key).padStart(2, " ");
    console.log(`  ${num}. ${opt.label}`);
  }
  console.log("");
}

function promptTestChoice() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Enter choice (0-6): ", (answer) => {
      rl.close();
      const choice = parseInt(answer.trim(), 10);
      if (isNaN(choice) || choice < 0 || choice > 6) {
        console.log("Invalid choice.");
        resolve(null);
        return;
      }
      resolve(TEST_SUBMENU[choice]);
    });
  });
}

function getOptionById(id) {
  return MENU_OPTIONS.find((o) => o.id === id);
}

function getReportOnlyTasks() {
  return MENU_OPTIONS.filter((o) => !o.modifiesCode && o.id !== "all" && o.id !== "exit" && o.id !== "testexec" && o.id !== "wdib");
}

function getCodeModifyTasks() {
  return MENU_OPTIONS.filter((o) => o.modifiesCode && o.id !== "all" && o.id !== "comments");
}

module.exports = {
  MENU_OPTIONS,
  TEST_SUBMENU,
  displayMenu,
  promptChoice,
  displayTestSubmenu,
  promptTestChoice,
  getOptionById,
  getReportOnlyTasks,
  getCodeModifyTasks,
};
