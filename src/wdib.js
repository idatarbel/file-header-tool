/**
 * WhatDidIBuild.ai integration — generates video modules and documentation
 * from a git repository via the WhatDidIBuild.ai API.
 *
 * Uses only Node.js built-in modules (https, readline, fs, path).
 */

const https = require("https");
const http = require("http");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadConfig, saveConfig } = require("./setup");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function apiRequest(method, apiPath, body, apiKey, apiSecret) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, "https://whatdidibuild.ai");
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runWdib(config) {
  config = config || loadConfig();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // -----------------------------------------------------------------------
    // 1. Ensure API credentials
    // -----------------------------------------------------------------------
    if (!config.wdibApiKey || !config.wdibApiSecret) {
      console.log("\n--- WhatDidIBuild.ai API Credentials ---");
      console.log("You can find these in your WhatDidIBuild.ai account settings.\n");

      if (!config.wdibApiKey) {
        config.wdibApiKey = await ask(rl, "API Key: ");
        if (!config.wdibApiKey) {
          console.log("API Key is required.");
          return;
        }
      }
      if (!config.wdibApiSecret) {
        config.wdibApiSecret = await ask(rl, "API Secret: ");
        if (!config.wdibApiSecret) {
          console.log("API Secret is required.");
          return;
        }
      }
      saveConfig(config);
      console.log("  Credentials saved to config.\n");
    }

    const { wdibApiKey, wdibApiSecret } = config;

    // -----------------------------------------------------------------------
    // 2. Choose generation type
    // -----------------------------------------------------------------------
    console.log("\nWhat would you like to generate?");
    console.log("  1. Video Modules");
    console.log("  2. Documentation");
    console.log("  3. Both");
    const genChoice = await ask(rl, "Choice: ");

    if (!["1", "2", "3"].includes(genChoice)) {
      console.log("Invalid choice.");
      return;
    }

    const wantVideos = genChoice === "1" || genChoice === "3";
    const wantDocs = genChoice === "2" || genChoice === "3";

    let selectedModules = {};
    let selectedDocuments = {};

    // -----------------------------------------------------------------------
    // 3 & 4. Fetch catalogs and let user pick items
    // -----------------------------------------------------------------------
    if (wantVideos) {
      console.log("\nFetching available video modules...");
      const res = await apiRequest("GET", "/api/v1/external/modules", null, wdibApiKey, wdibApiSecret);
      if (res.status !== 200) {
        console.log(`Error fetching modules: HTTP ${res.status}`);
        if (res.body && res.body.detail) console.log(`  ${res.body.detail}`);
        return;
      }

      const modules = Array.isArray(res.body) ? res.body : res.body.modules || res.body.data || [];
      if (modules.length === 0) {
        console.log("No video modules available.");
      } else {
        console.log("\nAvailable Video Modules:");
        modules.forEach((m, i) => {
          const desc = m.description ? ` \u2014 ${m.description}` : "";
          console.log(`  ${i + 1}. ${m.name || m.label}${desc}`);
        });
        console.log("  A. All");

        const pick = await ask(rl, "Enter numbers separated by commas, or A for all: ");
        if (pick.toLowerCase() === "a") {
          modules.forEach((m) => {
            selectedModules[m.uuid || m.id] = true;
          });
        } else {
          const nums = pick.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          nums.forEach((n) => {
            if (n >= 1 && n <= modules.length) {
              const m = modules[n - 1];
              selectedModules[m.uuid || m.id] = true;
            }
          });
        }

        if (Object.keys(selectedModules).length === 0) {
          console.log("No modules selected.");
          return;
        }
      }
    }

    if (wantDocs) {
      console.log("\nFetching available document types...");
      const res = await apiRequest("GET", "/api/v1/external/document-types", null, wdibApiKey, wdibApiSecret);
      if (res.status !== 200) {
        console.log(`Error fetching document types: HTTP ${res.status}`);
        if (res.body && res.body.detail) console.log(`  ${res.body.detail}`);
        return;
      }

      const docTypes = Array.isArray(res.body) ? res.body : res.body.document_types || res.body.data || [];
      if (docTypes.length === 0) {
        console.log("No document types available.");
      } else {
        console.log("\nAvailable Document Types:");
        docTypes.forEach((d, i) => {
          const desc = d.description ? ` \u2014 ${d.description}` : "";
          console.log(`  ${i + 1}. ${d.name || d.label}${desc}`);
        });
        console.log("  A. All");

        const pick = await ask(rl, "Enter numbers separated by commas, or A for all: ");
        if (pick.toLowerCase() === "a") {
          docTypes.forEach((d) => {
            selectedDocuments[d.uuid || d.id] = true;
          });
        } else {
          const nums = pick.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          nums.forEach((n) => {
            if (n >= 1 && n <= docTypes.length) {
              const d = docTypes[n - 1];
              selectedDocuments[d.uuid || d.id] = true;
            }
          });
        }

        if (Object.keys(selectedDocuments).length === 0) {
          console.log("No document types selected.");
          return;
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. Detect git repo info
    // -----------------------------------------------------------------------
    let repoUrl, branch;
    try {
      repoUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
      branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    } catch {
      console.log("Error: Could not detect git repository. Make sure you are in a git repo with an 'origin' remote.");
      return;
    }

    console.log(`\nRepository: ${repoUrl}`);
    console.log(`Branch: ${branch}`);

    // -----------------------------------------------------------------------
    // 6. Prompt for workspace and output path
    // -----------------------------------------------------------------------
    const workspaceId = await ask(rl, "\nWorkspace ID: ");
    if (!workspaceId) {
      console.log("Workspace ID is required.");
      return;
    }

    const outputInput = await ask(rl, "Output path [.]: ");
    const outputPath = outputInput || ".";

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    // -----------------------------------------------------------------------
    // 7. Submit the review
    // -----------------------------------------------------------------------
    console.log("\nSubmitting review to WhatDidIBuild.ai...");

    const reviewBody = {
      workspace_id: workspaceId,
      repo_url: repoUrl,
      branch,
      output_style: "professional",
      selected_modules: selectedModules,
      selected_documents: selectedDocuments,
    };

    const submitRes = await apiRequest("POST", "/api/v1/external/reviews", reviewBody, wdibApiKey, wdibApiSecret);

    if (submitRes.status !== 200 && submitRes.status !== 201) {
      console.log(`Error submitting review: HTTP ${submitRes.status}`);
      if (submitRes.body && submitRes.body.detail) console.log(`  ${submitRes.body.detail}`);
      return;
    }

    const jobId = submitRes.body.job_id || submitRes.body.id || submitRes.body.review_id;
    if (!jobId) {
      console.log("Error: No job ID returned from API.");
      console.log("Response:", JSON.stringify(submitRes.body, null, 2));
      return;
    }

    console.log(`Review submitted! Job ID: ${jobId}`);

    // -----------------------------------------------------------------------
    // 8. Poll for completion
    // -----------------------------------------------------------------------
    const POLL_INTERVAL = 15000; // 15 seconds
    const startTime = Date.now();

    while (true) {
      await sleep(POLL_INTERVAL);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      const pollRes = await apiRequest("GET", `/api/v1/external/reviews/${jobId}`, null, wdibApiKey, wdibApiSecret);

      if (pollRes.status !== 200) {
        console.log(`Polling error: HTTP ${pollRes.status}`);
        return;
      }

      const status = (pollRes.body.status || "").toUpperCase();
      console.log(`Polling... Status: ${status} (${elapsed}s elapsed)`);

      if (status === "COMPLETE" || status === "COMPLETED") {
        console.log("\nReview complete!");
        break;
      }

      if (status === "FAILED" || status === "ERROR") {
        const errMsg = pollRes.body.error || pollRes.body.message || "Unknown error";
        console.log(`\nReview failed: ${errMsg}`);
        return;
      }
    }

    // -----------------------------------------------------------------------
    // 9. Download documents
    // -----------------------------------------------------------------------
    console.log("\nFetching documents...");

    const docsRes = await apiRequest("GET", `/api/v1/external/reviews/${jobId}/documents`, null, wdibApiKey, wdibApiSecret);

    if (docsRes.status !== 200) {
      console.log(`Error fetching documents: HTTP ${docsRes.status}`);
      return;
    }

    const documents = Array.isArray(docsRes.body) ? docsRes.body : docsRes.body.documents || docsRes.body.data || [];

    if (documents.length === 0) {
      console.log("No documents available for download.");
      return;
    }

    let downloaded = 0;
    for (const doc of documents) {
      const docStatus = (doc.status || "").toLowerCase();
      if (docStatus !== "complete" && docStatus !== "completed") {
        console.log(`  Skipping ${doc.name || doc.document_name} (status: ${doc.status})`);
        continue;
      }

      const url = doc.download_url || doc.url;
      if (!url) {
        console.log(`  Skipping ${doc.name || doc.document_name} (no download URL)`);
        continue;
      }

      const docName = doc.document_name || doc.name || "document";
      const fileFormat = doc.file_format || doc.format || "txt";
      const filename = `${docName}.${fileFormat}`;
      const destPath = path.join(outputPath, filename);

      try {
        await downloadFile(url, destPath);
        console.log(`  Downloaded: ${filename}`);
        downloaded++;
      } catch (err) {
        console.log(`  Error downloading ${filename}: ${err.message}`);
      }
    }

    console.log(`\n${downloaded} file(s) downloaded to ${path.resolve(outputPath)}`);
  } catch (err) {
    console.log(`\nError: ${err.message}`);
  } finally {
    rl.close();
  }
}

module.exports = { runWdib };
