process.env.NODE_PATH = [
  "C:\\Users\\tgy_3\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules",
  "C:\\Users\\tgy_3\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\.pnpm\\node_modules",
  process.env.NODE_PATH || "",
].filter(Boolean).join(";");
require("module").Module._initPaths();

const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_DIR = __dirname;
const DOWNLOADS = "C:/Users/tgy_3/Downloads";
const PORTAL_URL = "https://peb.connectscc.com/software/html5.html";
const username = process.env.AUTOCOUNT_PORTAL_USER || process.env.MD_PORTAL_USER;
const password = process.env.AUTOCOUNT_PORTAL_PASSWORD || process.env.MD_PORTAL_PASSWORD;

function localIsoDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function compactDate(iso) {
  return String(iso).replaceAll("-", "");
}

function displayDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

function coord(envName, fallback) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parts = raw.split(",").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : fallback;
}

const stockDate = process.env.STOCK_BALANCE_DATE || localIsoDate(-1);
const rawName = process.env.STOCK_BALANCE_RAW_NAME || `${compactDate(stockDate)} AutoCount Stock Balance raw XLSX.xlsx`;
const rawPath = path.join(DOWNLOADS, rawName);
const dayDir = path.join(REPO_DIR, "reports", "stock-daily", stockDate);
const screenshotDir = path.join(dayDir, "export_screenshots");
const coords = {
  stockMenu: coord("STOCK_MENU_XY", [180, 36]),
  stockBalanceReport: coord("STOCK_BALANCE_REPORT_XY", [360, 478]),
  stockDateField: coord("STOCK_DATE_FIELD_XY", [135, 135]),
  stockDateArrow: coord("STOCK_DATE_ARROW_XY", [205, 135]),
  stockDatePickerDay: coord("STOCK_DATE_PICKER_DAY_XY", [296, 304]),
  inquiry: coord("STOCK_INQUIRY_XY", [55, 205]),
  grid: coord("STOCK_GRID_XY", [485, 280]),
  exportXlsx: coord("STOCK_EXPORT_XLSX_XY", [560, 577]),
  filenameBox: coord("STOCK_FILENAME_XY", [780, 505]),
  saveButton: coord("STOCK_SAVE_XY", [1095, 576]),
  openPromptNo: coord("STOCK_OPEN_PROMPT_NO_XY", [727, 403]),
};

if (!username || !password) {
  throw new Error("Missing AUTOCOUNT_PORTAL_USER/AUTOCOUNT_PORTAL_PASSWORD or MD_PORTAL_USER/MD_PORTAL_PASSWORD env vars");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(stockDate)) {
  throw new Error("STOCK_BALANCE_DATE must use YYYY-MM-DD");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshot(page, name) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const file = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot ${file}`);
}

async function click(page, xy, delay = 250) {
  await page.mouse.click(xy[0], xy[1]);
  await sleep(delay);
}

async function doubleClick(page, xy, delay = 500) {
  await page.mouse.dblclick(xy[0], xy[1]);
  await sleep(delay);
}

async function replaceCanvasText(page, xy, text) {
  await click(page, xy, 100);
  await page.keyboard.press("End");
  for (let i = 0; i < 24; i += 1) {
    await page.keyboard.press("Backspace");
    await sleep(12);
  }
  await page.keyboard.type(text, { delay: 40 });
}

async function setStockDate(page) {
  if (process.env.STOCK_SET_DATE !== "1") return true;
  await click(page, coords.stockDateArrow, 800);
  await screenshot(page, "05a_date_picker_open");
  if (process.env.STOCK_STOP_AFTER_DATE_PICKER === "1") {
    console.log("stopping after date picker open check");
    return false;
  }
  await click(page, coords.stockDatePickerDay, 800);
  await sleep(500);
  return true;
}

async function waitForRawFile(timeoutMs, minBytes = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stat = await fs.stat(rawPath).catch(() => null);
    if (stat && stat.size >= minBytes) return stat;
    await sleep(2000);
  }
  return null;
}

async function waitForReportApproval() {
  if (process.env.STOCK_WAIT_REPORT_APPROVAL !== "1") return;
  const goFile = path.join(dayDir, "stock_report_go.txt");
  const abortFile = path.join(dayDir, "stock_report_abort.txt");
  await fs.rm(goFile, { force: true }).catch(() => {});
  await fs.rm(abortFile, { force: true }).catch(() => {});
  console.log(`waiting for report approval: ${goFile}`);
  for (;;) {
    if (await fs.stat(abortFile).then(() => true).catch(() => false)) {
      throw new Error(`aborted by ${abortFile}`);
    }
    if (await fs.stat(goFile).then(() => true).catch(() => false)) {
      console.log("report approval received");
      return;
    }
    await sleep(2000);
  }
}

function normalizeRawExport() {
  const python = process.env.PYTHON || "python";
  const script = path.join(REPO_DIR, "normalize_stock_balance.py");
  const result = spawnSync(python, [script, rawPath, "--date", stockDate], {
    cwd: REPO_DIR,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`normalize_stock_balance.py failed with exit code ${result.status}`);
  }
}

async function run() {
  await fs.mkdir(dayDir, { recursive: true });
  await fs.rm(rawPath, { force: true }).catch(() => {});

  const profile = path.join(os.tmpdir(), `autocount-stock-export-${compactDate(stockDate)}`);
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});

  const downloadPromises = [];
  let context;
  async function saveDownloadUrl(downloadUrl, suggested) {
    const cookies = await context.cookies(downloadUrl);
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const response = await fetch(downloadUrl, {
      headers: {
        Cookie: cookieHeader,
        Referer: PORTAL_URL,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`manual download failed ${response.status}: ${body.slice(0, 500)}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(rawPath, buffer);
    console.log(`saved download ${suggested} -> ${rawPath} (${buffer.length} bytes)`);
  }

  function watchDownloads(downloadPage) {
    downloadPage.on("download", (download) => {
      const suggested = download.suggestedFilename();
      console.log(`download event: ${suggested}`);
      const promise = download.cancel().catch(() => {}).then(() => saveDownloadUrl(download.url(), suggested));
      downloadPromises.push(promise);
      promise.catch((err) => console.error(`download save failed: ${err.message}`));
    });
  }

  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    acceptDownloads: true,
    downloadsPath: DOWNLOADS,
    ignoreHTTPSErrors: true,
    viewport: { width: 1365, height: 768 },
    args: [
      "--window-size=1365,768",
      "--window-position=20,20",
      "--no-first-run",
      "--disable-session-crashed-bubble",
      "--disable-features=Translate",
    ],
  });

  context.pages().forEach(watchDownloads);
  context.on("page", watchDownloads);
  let page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    console.log("opening portal");
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((err) => {
      if (!String(err.message || err).includes("ERR_ABORTED")) throw err;
    });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.fill("#Editbox1", username);
    await page.fill("#Editbox2", password);
    const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
    await page.evaluate((args) => {
      document.querySelector("#Editbox1").value = args.username;
      document.querySelector("#Editbox2").value = args.password;
      document.querySelector("#accesstypeuserchoice_html5").checked = true;
      if (window.enableLogonButton) window.enableLogonButton();
      if (window.cplogon) window.cplogon();
      else document.querySelector("#buttonLogOn").click();
    }, { username, password });
    const popup = await popupPromise;
    page = popup || context.pages()[context.pages().length - 1];
    page.setDefaultTimeout(60000);
    await page.bringToFront().catch(() => {});
    await sleep(12000);
    await screenshot(page, "01_rdp_desktop");

    console.log("opening CCOM");
    await doubleClick(page, [58, 390], 1000);
    await sleep(9000);
    await screenshot(page, "02_autocount_login");

    console.log("logging into AutoCount");
    await click(page, [502, 249], 300);
    await click(page, [682, 404], 300); // Dismiss any lingering invalid-login dialog.
    await replaceCanvasText(page, [750, 604], username);
    await replaceCanvasText(page, [750, 636], password);
    await click(page, [505, 372], 500);
    await click(page, [856, 584], 1000);
    await sleep(12000);
    await screenshot(page, "03_autocount_home");

    console.log("opening Stock > Stock Balance Report");
    await click(page, coords.stockMenu, 800);
    await click(page, coords.stockBalanceReport, 20000);
    await screenshot(page, "04_stock_balance_report");

    await click(page, [984, 544], 300); // Close any leftover stock-item selector from a stopped probe.
    const dateSet = await setStockDate(page);
    await screenshot(page, "05_before_inquiry");
    if (!dateSet) return;
    if (process.env.STOCK_STOP_AFTER_REPORT === "1") {
      console.log("stopping after report open check");
      return;
    }
    await waitForReportApproval();

    console.log("running stock inquiry");
    await click(page, coords.inquiry, 1000);
    await sleep(Number(process.env.STOCK_INQUIRY_WAIT_MS || 90000));
    await screenshot(page, "06_inquiry_after_wait");

    console.log("opening grid export menu");
    await page.mouse.click(coords.grid[0], coords.grid[1], { button: "right" });
    await sleep(800);
    await screenshot(page, "07_context_menu");
    if (process.env.STOCK_STOP_AFTER_CONTEXT_MENU === "1") {
      console.log("stopping after context menu check");
      return;
    }

    console.log("exporting stock balance to xlsx");
    await click(page, coords.exportXlsx, 2000);
    await sleep(20000);
    await screenshot(page, "08_save_as");

    console.log("saving raw export");
    await click(page, coords.filenameBox, 200);
    await page.keyboard.press("Control+A");
    await page.keyboard.type(rawName, { delay: 5 });
    await click(page, coords.saveButton, 1000);
    await waitForRawFile(180000);
    await screenshot(page, "09_export_saved_or_prompt");
    if (!(await fs.stat(rawPath).then((s) => s.size >= 10000).catch(() => false))) {
      await click(page, coords.openPromptNo, 1000);
      await waitForRawFile(120000);
    }
    await screenshot(page, "10_after_open_prompt");
    await Promise.allSettled(downloadPromises);

    const final = await fs.stat(rawPath).catch((err) => {
      throw new Error(`raw export not found at ${rawPath}: ${err.message}`);
    });
    if (final.size < 10000) throw new Error(`raw export too small: ${final.size}`);

    normalizeRawExport();
    console.log(JSON.stringify({ rawPath, size: final.size, stockDate }, null, 2));
  } finally {
    await context.close().catch(() => {});
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
