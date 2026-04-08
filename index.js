#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { discoverFiles, writeMarker, hasMarker } = require("./src/files");
const { getLanguage } = require("./src/languages");
const { buildPrompt } = require("./src/prompts");
const { generate, checkConnection, getBackendName, DEFAULT_MODEL } = require("./src/ollama");
const { displayMenu, promptChoice, displayTestSubmenu, promptTestChoice, getReportOnlyTasks, getCodeModifyTasks } = require("./src/menu");
const { createReporter } = require("./src/reporter");
const reviewPrompts = require("./src/review-prompts");
const { runSetup, getAuthorInfo } = require("./src/setup");

const ROOT_DIR = process.cwd();

// --- Argument parsing ---
function parseArgs(argv) {
  const args = {
    full: false,
    dryRun: false,
    maxSize: 100,
    model: DEFAULT_MODEL,
    verbose: false,
    help: false,
    task: null, // run a specific task without menu (e.g. --task comments)
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--full":    args.full = true; break;
      case "--dry-run": args.dryRun = true; break;
      case "--max-size": args.maxSize = parseInt(argv[++i], 10) || 100; break;
      case "--model":   args.model = argv[++i] || DEFAULT_MODEL; break;
      case "--verbose": args.verbose = true; break;
      case "--task":    args.task = argv[++i]; break;
      case "--help":
      case "-h":        args.help = true; break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
CodeControlSystem — AI-powered code review & maintenance tool

Usage: code-control [options]

Options:
  --full          Force full project scan (ignore .codecomments marker)
  --dry-run       Show which files would be processed without modifying them
  --max-size N    Max file size in KB (default: 100)
  --model NAME    AI model to use (default: ${DEFAULT_MODEL})
  --task ID       Run a specific task without menu:
                    exceptions, naming, hardcoded, deadcode, security,
                    readme, secrets, disconnects, complexity,
                    dependencies, dry, logging, accessibility,
                    performance, testcoverage, testexec, comments,
                    wdib, all
  --verbose       Show detailed progress
  --help, -h      Show this help message
`);
}

// --- Response handling ---
function validateResponse(original, response) {
  if (!response || response.trim().length === 0) return false;
  if (response.trim().length < original.trim().length * 0.5) return false;
  return true;
}

function cleanResponse(response) {
  let cleaned = response;
  cleaned = cleaned.replace(/^```[\w]*\n/, "");
  cleaned = cleaned.replace(/\n```\s*$/, "");
  return cleaned;
}

function splitFindings(response) {
  const marker = "---FINDINGS---";
  const idx = response.indexOf(marker);
  if (idx === -1) return { code: response, findings: null };
  return {
    code: response.substring(0, idx).trimEnd(),
    findings: response.substring(idx + marker.length).trim(),
  };
}

// --- Backup ---
function createBackup(filePath) {
  const backupDir = path.join(os.tmpdir(), "addcodecomments-backup");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const relativePath = path.relative(ROOT_DIR, filePath).replace(/[/\\]/g, "_");
  const backupPath = path.join(backupDir, `${relativePath}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function removeBackup(backupPath) {
  try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
}

// --- Get prompt for a given task ---
function getTaskPrompt(taskId, fileContent, language, filePath) {
  switch (taskId) {
    case "exceptions": return reviewPrompts.exceptionsPrompt(fileContent, language, filePath);
    case "naming":     return reviewPrompts.namingPrompt(fileContent, language, filePath);
    case "hardcoded":  return reviewPrompts.hardcodedPrompt(fileContent, language, filePath);
    case "deadcode":   return reviewPrompts.deadcodePrompt(fileContent, language, filePath);
    case "security":   return reviewPrompts.securityPrompt(fileContent, language, filePath);
    case "secrets":        return reviewPrompts.secretsPrompt(fileContent, language, filePath);
    case "disconnects":   return reviewPrompts.namingDisconnectPrompt(fileContent, language, filePath);
    case "complexity":    return reviewPrompts.complexityPrompt(fileContent, language, filePath);
    case "dependencies":  return reviewPrompts.dependencyPrompt(fileContent, language, filePath);
    case "dry":           return reviewPrompts.dryViolationsPrompt(fileContent, language, filePath);
    case "logging":       return reviewPrompts.loggingPrompt(fileContent, language, filePath);
    case "accessibility": return reviewPrompts.accessibilityPrompt(fileContent, language, filePath);
    case "performance":    return reviewPrompts.performancePrompt(fileContent, language, filePath);
    case "testcoverage":  return reviewPrompts.testCoveragePrompt(fileContent, language, filePath);
    case "comments":   {
      const authorInfo = getAuthorInfo();
      const p = buildPrompt(fileContent, language, filePath, authorInfo);
      return { systemPrompt: p.systemPrompt, userPrompt: p.userPrompt, responseType: "code" };
    }
    default: return null;
  }
}

// --- Process a single file for a task ---
async function processFileForTask(filePath, taskId, args, reporter) {
  const language = getLanguage(filePath);
  if (!language) return { status: "skipped", reason: "unsupported" };

  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) return { status: "skipped", reason: "empty" };

  const relPath = path.relative(ROOT_DIR, filePath);

  if (args.dryRun) {
    console.log(`  [dry-run] Would process: ${relPath} (${language.name})`);
    return { status: "dry-run" };
  }

  const promptData = getTaskPrompt(taskId, content, language, relPath);
  if (!promptData) return { status: "skipped", reason: "no-prompt" };

  const backupPath = createBackup(filePath);

  try {
    if (args.verbose) {
      console.log(`  Sending to ${args.model}...`);
    }

    const response = await generate(promptData.systemPrompt, promptData.userPrompt, { model: args.model });
    const cleaned = cleanResponse(response);

    if (promptData.responseType === "report") {
      // Report-only task: write findings, don't modify file
      if (reporter && cleaned.trim()) {
        reporter.appendFinding(relPath, cleaned);
      }
      removeBackup(backupPath);
      return { status: "reported" };
    }

    // Code-modifying task
    const { code, findings } = splitFindings(cleaned);

    if (!validateResponse(content, code)) {
      console.log(`  [warning] Invalid response for ${relPath}, skipping`);
      removeBackup(backupPath);
      return { status: "skipped", reason: "invalid-response" };
    }

    fs.writeFileSync(filePath, code, "utf8");

    // Write findings if present
    if (reporter && findings) {
      reporter.appendFinding(relPath, findings);
    }

    removeBackup(backupPath);
    return { status: "updated" };
  } catch (err) {
    try { fs.copyFileSync(backupPath, filePath); } catch { /* restore failed */ }
    removeBackup(backupPath);
    return { status: "error", reason: err.message };
  }
}

// --- Run README validation (special case — single file) ---
async function runReadmeTask(args, reporter) {
  console.log("\n--- README Validation ---\n");

  const readmePath = path.join(ROOT_DIR, "README.md");
  const existingReadme = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : null;

  if (args.dryRun) {
    console.log(`  [dry-run] Would ${existingReadme ? "review" : "create"} README.md`);
    return;
  }

  const promptData = reviewPrompts.readmePrompt(ROOT_DIR, existingReadme);

  process.stdout.write(`README.md... `);

  try {
    const response = await generate(promptData.systemPrompt, promptData.userPrompt, { model: args.model });
    const cleaned = cleanResponse(response);
    const { code, findings } = splitFindings(cleaned);

    if (existingReadme) {
      createBackup(readmePath);
    }

    fs.writeFileSync(readmePath, code, "utf8");

    if (reporter && findings) {
      reporter.appendFinding("README.md", findings);
    }

    console.log("done");
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}

// --- Run a single task across all files ---
async function runTask(taskId, files, args, reporter) {
  const taskLabels = {
    exceptions: "Exception Handling",
    naming: "Naming Conventions",
    hardcoded: "Hard-Coded Data Audit",
    deadcode: "Dead Code Removal",
    security: "Security Review",
    secrets: "Sensitive Data Check",
    disconnects: "Naming Disconnects",
    complexity: "Code Complexity",
    dependencies: "Dependency Audit",
    dry: "DRY Violations",
    logging: "Logging & Observability",
    accessibility: "Accessibility Audit",
    performance: "Performance Red Flags",
    testcoverage: "Test Coverage Report",
    comments: "Add Code Comments",
  };

  const label = taskLabels[taskId] || taskId;
  console.log(`\n--- ${label} ---\n`);

  if (reporter) {
    reporter.appendSection(label, "");
  }

  let updated = 0, skipped = 0, errors = 0, reported = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relPath = path.relative(ROOT_DIR, filePath);
    const language = getLanguage(filePath);
    const langName = language ? language.name : "unknown";

    process.stdout.write(`  [${i + 1}/${files.length}] ${relPath} (${langName})... `);

    const result = await processFileForTask(filePath, taskId, args, reporter);

    switch (result.status) {
      case "updated":  console.log("done"); updated++; break;
      case "reported": console.log("reported"); reported++; break;
      case "skipped":  console.log(`skipped (${result.reason})`); skipped++; break;
      case "error":    console.log(`ERROR: ${result.reason}`); errors++; break;
      case "dry-run":  skipped++; break;
    }
  }

  console.log(`  Results: ${updated} updated | ${reported} reported | ${skipped} skipped | ${errors} errors`);
  return { updated, skipped, errors, reported };
}

// --- Run "All" with parallel report tasks, then sequential code tasks ---
async function runAll(files, args, reporter) {
  console.log("\n=== Running All Tasks ===");

  // Phase 1: Report-only tasks in parallel
  const reportTasks = getReportOnlyTasks(); // hardcoded, security, secrets
  console.log(`\nPhase 1: Running ${reportTasks.length} report tasks in parallel...`);

  const reportPromises = reportTasks.map((task) => runTask(task.id, files, args, reporter));
  await Promise.all(reportPromises);

  // Phase 2: Code-modifying tasks sequentially
  const codeTasks = getCodeModifyTasks(); // exceptions, naming, deadcode, readme
  console.log(`\nPhase 2: Running ${codeTasks.length} code modification tasks sequentially...`);

  for (const task of codeTasks) {
    if (task.id === "readme") {
      await runReadmeTask(args, reporter);
    } else {
      await runTask(task.id, files, args, reporter);
    }
  }

  // Phase 3: Comments last (after all other modifications)
  console.log("\nPhase 3: Adding code comments (final pass)...");
  await runTask("comments", files, args, reporter);
}

// --- Run Test Execution (special case — sub-menu + actual test runs) ---
async function runTestExecution(files, args, reporter) {
  const { execSync } = require("child_process");

  displayTestSubmenu();
  const testChoice = await promptTestChoice();
  if (!testChoice || testChoice.id === "none") {
    console.log("Test execution cancelled.");
    return;
  }

  const testTypes = testChoice.id === "all"
    ? ["unit", "integration", "e2e", "performance", "contract"]
    : [testChoice.id];

  const testTypeNames = {
    unit: "Unit Tests",
    integration: "Integration Tests",
    e2e: "End-to-End Tests",
    performance: "Performance Tests",
    contract: "Contract Tests",
  };

  if (reporter) {
    reporter.appendSection("Test Execution", "");
  }

  // Step 1: Use AI to analyze project and find test commands
  console.log("\n--- Analyzing test configuration ---\n");

  // Find config/manifest files for test analysis
  const configFiles = files.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return base === "package.json" || base === "pyproject.toml" || base === "cargo.toml"
      || base === "go.mod" || base === "makefile" || base === "gemfile"
      || base.includes("vitest") || base.includes("jest") || base.includes("pytest")
      || base.includes("playwright") || base.includes("cypress");
  });

  for (const testType of testTypes) {
    const typeName = testTypeNames[testType];
    console.log(`\n--- ${typeName} ---\n`);

    // Ask AI to identify test commands for this type
    for (const configFile of configFiles) {
      const content = fs.readFileSync(configFile, "utf8");
      const language = getLanguage(configFile);
      if (!language) continue;

      const relPath = path.relative(ROOT_DIR, configFile);
      const promptData = reviewPrompts.testExecutionPrompt(content, language, relPath, testType);

      process.stdout.write(`  Analyzing ${relPath} for ${typeName}... `);

      try {
        const response = await generate(promptData.systemPrompt, promptData.userPrompt, { model: args.model });
        const cleaned = cleanResponse(response);

        if (reporter && cleaned.trim()) {
          reporter.appendFinding(`${typeName} — ${relPath}`, cleaned);
        }

        console.log("done");

        // Try to extract and run the test command
        const cmdMatch = cleaned.match(/```(?:bash|sh|shell)?\n((?:npm|npx|yarn|pnpm|pytest|python|go|cargo|make|bundle)\s[^\n]+)/m);
        if (cmdMatch) {
          const testCmd = cmdMatch[1].trim();
          console.log(`  Running: ${testCmd}`);

          try {
            const output = execSync(testCmd, {
              cwd: ROOT_DIR,
              encoding: "utf8",
              timeout: 300000, // 5 min timeout for tests
              stdio: ["pipe", "pipe", "pipe"],
            });

            console.log("  Tests completed successfully.");
            if (reporter) {
              reporter.appendFinding(`${typeName} — Execution Results`, `\`\`\`\n${output}\n\`\`\``);
            }
          } catch (testErr) {
            const output = (testErr.stdout || "") + "\n" + (testErr.stderr || "");
            console.log(`  Tests completed with failures.`);
            if (reporter) {
              reporter.appendFinding(`${typeName} — Execution Results (with failures)`, `\`\`\`\n${output}\n\`\`\``);
            }
          }
        } else {
          console.log(`  No executable test command found for ${typeName}.`);
        }
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
      }
    }

    if (configFiles.length === 0) {
      console.log("  No configuration files found to analyze.");
      if (reporter) {
        reporter.appendFinding(typeName, "No configuration or manifest files found in the project.");
      }
    }
  }
}

// --- Main ---
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Run first-time setup if author/company not configured
  await runSetup();

  // Get task selection
  let selectedTask;
  if (args.task) {
    selectedTask = { id: args.task };
  } else {
    displayMenu();
    selectedTask = await promptChoice();
    if (!selectedTask) process.exit(1);
  }

  // Handle exit
  if (selectedTask.id === "exit") {
    console.log("\nGoodbye.\n");
    process.exit(0);
  }

  // Handle WDIB task (no local file processing needed, no AI backend required)
  if (selectedTask.id === "wdib") {
    const { runWdib } = require("./src/wdib");
    await runWdib();
    process.exit(0);
  }

  // Check AI backend connection
  if (!args.dryRun) {
    const connected = await checkConnection();
    if (!connected) {
      console.error("Error: Cannot connect to AI backend.");
      console.error("Configure Anthropic API key in ~/.codecontrolsystem/config.json or start Ollama with: ollama serve");
      process.exit(1);
    }
  }

  console.log(`\n=== CodeControlSystem ===\n`);
  if (!args.dryRun) {
    console.log(`Backend: ${getBackendName()}`);
  }

  // Discover files
  const isFirstRun = !hasMarker(ROOT_DIR);
  const { mode, files } = discoverFiles(ROOT_DIR, {
    full: args.full || isFirstRun,
    maxSize: args.maxSize,
  });

  if (mode === "none" || files.length === 0) {
    console.log("No files to process.");
    if (mode === "none") {
      console.log("(No files have changed since last run. Use --full to force a full scan.)");
    }
    // README task can still run even with no changed files
    if (selectedTask.id !== "readme" && selectedTask.id !== "all") {
      process.exit(0);
    }
  }

  console.log(`Mode: ${mode === "full" ? "Full project scan" : "Changed files only"}`);
  console.log(`Files to process: ${files.length}`);

  // Create reporter for tasks that need it
  const needsReport = selectedTask.id !== "comments";
  const reporter = needsReport && !args.dryRun
    ? createReporter(ROOT_DIR, selectedTask.label || selectedTask.id)
    : null;

  if (reporter) {
    console.log(`Report: ${reporter.filename}`);
  }

  // Execute
  if (selectedTask.id === "all") {
    await runAll(files, args, reporter);
  } else if (selectedTask.id === "readme") {
    await runReadmeTask(args, reporter);
  } else if (selectedTask.id === "testexec") {
    await runTestExecution(files, args, reporter);
  } else {
    await runTask(selectedTask.id, files, args, reporter);
  }

  // Write marker on successful full run
  if (mode === "full" && !args.dryRun) {
    writeMarker(ROOT_DIR);
  }

  console.log(`\n=== Complete ===`);
  if (reporter) {
    console.log(`Findings written to: code_review/${reporter.filename}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
