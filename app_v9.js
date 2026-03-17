/* Lunch Tracker v10 — Cloud-synced via Google Sheets
   - Names & entries sync to Google Sheets (via Apps Script)
   - Falls back to localStorage when offline
   - Offline queue replays when connection returns
   - Simple shared PIN authentication
   - iPad-friendly UI
*/

(function () {
  "use strict";

  // ========== CONFIGURATION ==========
  // Paste your Google Apps Script web-app URL here.
  // Leave empty ("") to run in local-only mode (no cloud sync).
  const API_URL = "https://script.google.com/macros/s/AKfycbxzOg_kepcr7qaiEdSRrH1a2Vt-YAjlr5R5PNMe56AgfZuJiut3PEb1sGrIg54m97a5DA/exec";

  // ========== Storage keys ==========
  const KEYS = {
    names: "lt_names_v1",
    entries: "lt_entries_v1",
    pin: "lt_pin",
    queue: "lt_offline_queue"
  };

  // ========== Helpers ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid() {
    return "id_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
  }

  function pad2(n) {
    return n.toString().padStart(2, "0");
  }

  function todayISODate() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatUKDate(d) {
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function weekdayName(d) {
    return d.toLocaleDateString("en-GB", { weekday: "long" });
  }

  function formatTimeHHMM(d) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function safeTrim(s) {
    return (s ?? "").toString().trim();
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function showStatus(msg, kind = "") {
    const box = $("#statusBox");
    box.classList.remove("good", "warn", "bad");
    if (kind) box.classList.add(kind);
    box.textContent = msg;
  }

  function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function csvEscape(value) {
    const s = (value ?? "").toString();
    if (/[",\n\r]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // Safe cell helper (prevents XSS — uses textContent, not innerHTML)
  function td(text, className) {
    const el = document.createElement("td");
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function actionsTd(entryId) {
    const cell = document.createElement("td");
    cell.className = "right";

    const wrap = document.createElement("div");
    wrap.className = "row-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "small-btn";
    editBtn.textContent = "Edit";
    editBtn.type = "button";
    editBtn.dataset.action = "edit";
    editBtn.dataset.id = entryId;

    const delBtn = document.createElement("button");
    delBtn.className = "small-btn danger";
    delBtn.textContent = "Delete";
    delBtn.type = "button";
    delBtn.dataset.action = "delete";
    delBtn.dataset.id = entryId;

    wrap.appendChild(editBtn);
    wrap.appendChild(delBtn);
    cell.appendChild(wrap);
    return cell;
  }

  // ========== Cloud API ==========
  function cloudEnabled() {
    return API_URL.length > 0;
  }

  // All API calls use GET to avoid the Apps Script POST redirect issue
  async function api(action, data = {}) {
    if (!cloudEnabled()) return null;
    const pin = localStorage.getItem(KEYS.pin) || "";
    const params = new URLSearchParams({ action, pin, data: JSON.stringify(data) });
    try {
      const res = await fetch(`${API_URL}?${params}`);
      return await res.json();
    } catch {
      return { error: "offline" };
    }
  }

  // Alias kept for clarity at call sites
  async function apiGet(action) {
    return api(action);
  }

  // Fire-and-forget cloud write; queues if offline
  function cloudSave(action, data) {
    if (!cloudEnabled()) return;
    api(action, data).then((result) => {
      if (!result || result.error) {
        const errMsg = result ? result.error : "no response";
        if (errMsg === "offline") {
          const q = loadJSON(KEYS.queue, []);
          q.push({ action, ...data });
          saveJSON(KEYS.queue, q);
          updateSyncIndicator();
        } else {
          // Show visible error so sync failures aren't silent
          showStatus(`Cloud error (${action}): ${errMsg}`, "bad");
          console.error("cloudSave error:", action, errMsg, data);
        }
      }
    });
  }

  async function processQueue() {
    if (!cloudEnabled()) return;
    const q = loadJSON(KEYS.queue, []);
    if (q.length === 0) return;

    const result = await api("sync", { operations: q });
    if (result && result.ok) {
      saveJSON(KEYS.queue, []);
      updateSyncIndicator();
      showStatus(`Synced ${q.length} offline change(s).`, "good");
    }
  }

  async function refreshFromCloud() {
    const result = await apiGet("getAll");
    if (result && result.ok) {
      names = result.names || [];
      entries = result.entries || [];
      persistNamesLocal();
      persistEntriesLocal();
      renderNameSelect();
      renderTables();
      updateCounts();
    }
    return result;
  }

  function updateSyncIndicator() {
    const el = $("#syncPill");
    if (!el) return;
    const q = loadJSON(KEYS.queue, []);
    if (q.length > 0) {
      el.textContent = `${q.length} pending`;
      el.classList.add("pending");
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
      el.classList.remove("pending");
    }
  }

  // ========== State ==========
  let names = loadJSON(KEYS.names, []);
  let entries = loadJSON(KEYS.entries, []);

  // ========== Elements ==========
  const todayDisplay = $("#todayDisplay");
  const nameSelect = $("#nameSelect");
  const saveBtn = $("#saveBtn");
  const clearSelectionBtn = $("#clearSelectionBtn");
  const exportBtn = $("#exportBtn");
  const manageNamesBtn = $("#manageNamesBtn");

  const tabToday = $("#tabToday");
  const tabAll = $("#tabAll");
  const todayView = $("#todayView");
  const allView = $("#allView");

  const todayTbody = $("#todayTbody");
  const allTbody = $("#allTbody");
  const todayEmpty = $("#todayEmpty");
  const allEmpty = $("#allEmpty");

  const rangeSelect = $("#rangeSelect");
  const searchInput = $("#searchInput");

  const namesCountPill = $("#namesCountPill");
  const entriesCountPill = $("#entriesCountPill");
  const wipeDataBtn = $("#wipeDataBtn");

  // Names modal
  const namesModal = $("#namesModal");
  const namesModalBackdrop = $("#namesModalBackdrop");
  const closeNamesModalBtn = $("#closeNamesModalBtn");
  const closeNamesModalBtn2 = $("#closeNamesModalBtn2");
  const newNameInput = $("#newNameInput");
  const addNameBtn = $("#addNameBtn");
  const namesList = $("#namesList");

  // Confirm modal
  const confirmModal = $("#confirmModal");
  const confirmBackdrop = $("#confirmBackdrop");
  const confirmMessage = $("#confirmMessage");
  const confirmCloseBtn = $("#confirmCloseBtn");
  const confirmCancelBtn = $("#confirmCancelBtn");
  const confirmOkBtn = $("#confirmOkBtn");
  let confirmResolver = null;

  // PIN elements
  const pinOverlay = $("#pinOverlay");
  const pinInput = $("#pinInput");
  const pinSubmitBtn = $("#pinSubmitBtn");
  const pinError = $("#pinError");

  // ========== Modal helpers ==========
  function openModal(modalEl, backdropEl) {
    modalEl.classList.remove("hidden");
    backdropEl.classList.remove("hidden");
    backdropEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modalEl, backdropEl) {
    modalEl.classList.add("hidden");
    backdropEl.classList.add("hidden");
    backdropEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function confirmDialog(message) {
    confirmMessage.textContent = message;
    openModal(confirmModal, confirmBackdrop);
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function closeConfirm(result) {
    closeModal(confirmModal, confirmBackdrop);
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  }

  // ========== Names ==========
  function sortNames() {
    names.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  }

  function persistNamesLocal() {
    saveJSON(KEYS.names, names);
  }

  function persistEntriesLocal() {
    saveJSON(KEYS.entries, entries);
  }

  function renderNameSelect() {
    const current = nameSelect.value;
    nameSelect.innerHTML = '<option value="">Select a name…</option>';

    sortNames();
    for (const n of names) {
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = n.name;
      nameSelect.appendChild(opt);
    }

    if (current && names.some((n) => n.id === current)) {
      nameSelect.value = current;
    }

    nameSelect.dispatchEvent(new Event("change"));
  }

  function renderNamesList() {
    // Names already sorted by renderNameSelect; no need to re-sort
    namesList.innerHTML = "";
    if (names.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No names yet. Add the first one above.";
      namesList.appendChild(empty);
      return;
    }

    for (const n of names) {
      const row = document.createElement("div");
      row.className = "name-item";

      const nameSpan = document.createElement("div");
      nameSpan.className = "name";
      nameSpan.textContent = n.name;

      const editInput = document.createElement("input");
      editInput.className = "input edit";
      editInput.type = "text";
      editInput.value = n.name;
      editInput.setAttribute("aria-label", `Edit name ${n.name}`);

      const save = document.createElement("button");
      save.className = "small-btn";
      save.textContent = "Save";
      save.type = "button";

      const del = document.createElement("button");
      del.className = "small-btn danger";
      del.textContent = "Delete";
      del.type = "button";

      save.addEventListener("click", () => {
        const newVal = safeTrim(editInput.value);
        if (!newVal) return showStatus("Name cannot be blank.", "bad");

        const exists = names.some((x) => x.id !== n.id && x.name.toLowerCase() === newVal.toLowerCase());
        if (exists) return showStatus("That name already exists.", "warn");

        const oldName = n.name;
        n.name = newVal;

        for (const e of entries) {
          if (e.personId === n.id) e.personName = newVal;
        }

        persistNamesLocal();
        persistEntriesLocal();
        cloudSave("editName", { nameId: n.id, newName: newVal });

        renderNameSelect();
        renderNamesList();
        renderTables();
        updateCounts();
        showStatus(`Updated "${oldName}" to "${newVal}".`, "good");
      });

      del.addEventListener("click", async () => {
        const ok = await confirmDialog(`Delete "${n.name}"? This does not delete their past entries.`);
        if (!ok) return;

        names = names.filter((x) => x.id !== n.id);
        persistNamesLocal();
        cloudSave("deleteName", { nameId: n.id });

        renderNameSelect();
        renderNamesList();
        updateCounts();
        showStatus(`Deleted "${n.name}".`, "good");
      });

      row.appendChild(nameSpan);
      row.appendChild(editInput);
      row.appendChild(save);
      row.appendChild(del);
      namesList.appendChild(row);
    }
  }

  function addName() {
    const val = safeTrim(newNameInput.value);
    if (!val) return showStatus("Please enter a name.", "warn");

    const exists = names.some((n) => n.name.toLowerCase() === val.toLowerCase());
    if (exists) return showStatus("That name already exists.", "warn");

    const nameObj = { id: uid(), name: val };
    names.push(nameObj);
    persistNamesLocal();
    cloudSave("addName", { name: nameObj });

    newNameInput.value = "";
    renderNameSelect();
    renderNamesList();
    updateCounts();
    showStatus(`Added "${val}".`, "good");
  }

  // ========== Entries ==========
  function getSelectedMealType() {
    const el = document.querySelector('input[name="mealType"]:checked');
    return el ? el.value : "";
  }

  function clearMealSelection() {
    $$('input[name="mealType"]').forEach((r) => (r.checked = false));
  }

  function entryExistsForPersonOnDate(personId, dateISO) {
    return entries.some((e) => e.personId === personId && e.dateISO === dateISO);
  }

  async function saveEntry() {
    const personId = nameSelect.value;
    const person = names.find((n) => n.id === personId);
    const selection = getSelectedMealType();

    if (!personId || !person) return showStatus("Please select a name.", "warn");
    if (!selection) return showStatus("Please select a meal choice.", "warn");

    const now = new Date();
    const dateISO = todayISODate();
    const day = weekdayName(now);

    if (entryExistsForPersonOnDate(personId, dateISO)) {
      const ok = await confirmDialog(`${person.name} is already logged for today. Add another entry anyway?`);
      if (!ok) return showStatus("No changes made.", "");
    }

    const entry = {
      id: uid(),
      dateISO,
      dayName: day,
      personId,
      personName: person.name,
      selection,
      timestampISO: now.toISOString()
    };

    entries.push(entry);
    persistEntriesLocal();
    cloudSave("addEntry", { entry });

    renderTables();
    updateCounts();
    showStatus(`Saved: ${person.name} — ${selection}`, "good");
  }

  function deleteEntry(entryId) {
    entries = entries.filter((e) => e.id !== entryId);
    persistEntriesLocal();
    cloudSave("deleteEntry", { entryId });

    renderTables();
    updateCounts();
    showStatus("Entry deleted.", "good");
  }

  async function editEntry(entryId) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const mealOptions = [
      "Starter", "Main course", "Dessert",
      "Starter + main course", "Main course + dessert",
      "Starter + dessert", "2 starters"
    ];
    const currentIdx = mealOptions.indexOf(entry.selection);
    const promptText =
      `Edit selection for ${entry.personName} on ${entry.dateISO}\n` +
      `1) Starter\n2) Main course\n3) Dessert\n` +
      `4) Starter + main course\n5) Main course + dessert\n` +
      `6) Starter + dessert\n7) 2 starters\n\n` +
      `Enter 1–7 (current: ${currentIdx >= 0 ? currentIdx + 1 : entry.selection})`;

    const ans = window.prompt(promptText, currentIdx >= 0 ? String(currentIdx + 1) : "");
    if (ans === null) return;
    const n = parseInt(ans, 10);
    if (![1, 2, 3, 4, 5, 6, 7].includes(n)) return showStatus("Edit cancelled: invalid option.", "warn");

    const newSelection = mealOptions[n - 1];
    entry.selection = newSelection;
    persistEntriesLocal();
    cloudSave("editEntry", { entryId, selection: newSelection });

    renderTables();
    showStatus("Entry updated.", "good");
  }

  function withinRange(dateISO, rangeValue, todayMs) {
    if (rangeValue === "all") return true;

    const targetMs = new Date(dateISO + "T00:00:00").getTime();
    const diffDays = Math.floor((todayMs - targetMs) / 86400000);

    if (rangeValue === "today") return diffDays === 0;
    const days = parseInt(rangeValue, 10);
    if (!Number.isFinite(days)) return true;
    return diffDays >= 0 && diffDays < days;
  }

  function renderTables() {
    const today = todayISODate();
    const todays = entries
      .filter((e) => e.dateISO === today)
      .sort((a, b) => (a.timestampISO < b.timestampISO ? -1 : 1));

    // Today table — safe DOM construction (no innerHTML for user data)
    todayTbody.innerHTML = "";
    const todayFrag = document.createDocumentFragment();
    for (const e of todays) {
      const tr = document.createElement("tr");
      tr.appendChild(td(e.personName));
      tr.appendChild(td(e.selection));
      tr.appendChild(td(formatTimeHHMM(new Date(e.timestampISO))));
      tr.appendChild(actionsTd(e.id));
      todayFrag.appendChild(tr);
    }
    todayTbody.appendChild(todayFrag);
    todayEmpty.style.display = todays.length ? "none" : "block";

    // All-entries table
    const rangeVal = rangeSelect.value;
    const q = safeTrim(searchInput.value).toLowerCase();

    // Compute today's midnight once (fix: avoid per-row Date creation)
    const todayMs = new Date().setHours(0, 0, 0, 0);

    const filtered = entries
      .filter((e) => withinRange(e.dateISO, rangeVal, todayMs))
      .filter((e) => !q || e.personName.toLowerCase().includes(q))
      .sort((a, b) =>
        a.dateISO === b.dateISO
          ? (a.timestampISO < b.timestampISO ? -1 : 1)
          : (a.dateISO < b.dateISO ? 1 : -1)
      );

    allTbody.innerHTML = "";
    const allFrag = document.createDocumentFragment();
    for (const e of filtered) {
      const tr = document.createElement("tr");
      tr.appendChild(td(e.dateISO));
      tr.appendChild(td(e.dayName));
      tr.appendChild(td(e.personName));
      tr.appendChild(td(e.selection));
      tr.appendChild(td(formatTimeHHMM(new Date(e.timestampISO))));
      tr.appendChild(actionsTd(e.id));
      allFrag.appendChild(tr);
    }
    allTbody.appendChild(allFrag);
    allEmpty.style.display = filtered.length ? "none" : "block";
  }

  // Delegate table actions
  function handleTableClick(ev) {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");

    if (action === "delete") {
      confirmDialog("Delete this entry?").then((ok) => {
        if (ok) deleteEntry(id);
        else showStatus("No changes made.", "");
      });
    } else if (action === "edit") {
      editEntry(id);
    }
  }

  // ========== Export ==========
  function exportCSV() {
    if (entries.length === 0) return showStatus("No entries to export yet.", "warn");

    const header = ["dateISO", "dayName", "personName", "selection", "time", "timestampISO"];
    const lines = [header.map(csvEscape).join(",")];

    for (const e of entries.slice().sort((a, b) => (a.timestampISO < b.timestampISO ? -1 : 1))) {
      const time = formatTimeHHMM(new Date(e.timestampISO));
      const row = [e.dateISO, e.dayName, e.personName, e.selection, time, e.timestampISO];
      lines.push(row.map(csvEscape).join(","));
    }

    const csv = lines.join("\r\n");
    downloadTextFile(`lunch-tracker_${todayISODate()}.csv`, csv, "text/csv;charset=utf-8");
    showStatus("Exported CSV.", "good");
  }

  // ========== Tabs ==========
  function setTab(which) {
    if (which === "today") {
      tabToday.classList.add("active");
      tabAll.classList.remove("active");
      todayView.classList.remove("hidden");
      allView.classList.add("hidden");
    } else {
      tabAll.classList.add("active");
      tabToday.classList.remove("active");
      allView.classList.remove("hidden");
      todayView.classList.add("hidden");
    }
  }

  // ========== Counts ==========
  function updateCounts() {
    namesCountPill.textContent = `${names.length} name${names.length === 1 ? "" : "s"}`;
    entriesCountPill.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
    updateSyncIndicator();
  }

  // ========== Wipe ==========
  async function wipeAll() {
    const ok = await confirmDialog("Wipe ALL data (names + entries)? This affects everyone.");
    if (!ok) return;

    names = [];
    entries = [];
    persistNamesLocal();
    persistEntriesLocal();
    cloudSave("wipe", {});

    renderNameSelect();
    renderNamesList();
    renderTables();
    updateCounts();
    clearMealSelection();
    nameSelect.value = "";
    showStatus("All data wiped.", "good");
  }

  // ========== PIN Auth ==========
  async function verifyPin(pin) {
    if (!cloudEnabled()) return true;

    const encoded = encodeURIComponent(pin);
    try {
      const res = await fetch(`${API_URL}?action=verify&pin=${encoded}`);
      const data = await res.json();
      return data.ok === true;
    } catch {
      // If offline, accept a previously-stored PIN
      const stored = localStorage.getItem(KEYS.pin);
      return stored && stored === pin;
    }
  }

  async function handlePinSubmit() {
    const pin = safeTrim(pinInput.value);
    if (!pin) {
      pinError.textContent = "Please enter a PIN.";
      return;
    }

    pinSubmitBtn.disabled = true;
    pinSubmitBtn.textContent = "Checking…";
    pinError.textContent = "";

    const valid = await verifyPin(pin);

    if (valid) {
      localStorage.setItem(KEYS.pin, pin);
      pinOverlay.classList.add("hidden");
      await startApp();
    } else {
      pinError.textContent = "Invalid PIN. Try again.";
    }

    pinSubmitBtn.disabled = false;
    pinSubmitBtn.textContent = "Enter";
  }

  // ========== Init ==========
  function initDateHeader() {
    todayDisplay.textContent = formatUKDate(new Date());
  }

  function initEvents() {
    saveBtn.addEventListener("click", saveEntry);
    clearSelectionBtn.addEventListener("click", () => {
      clearMealSelection();
      showStatus("Selection cleared.", "");
    });

    exportBtn.addEventListener("click", exportCSV);

    nameSelect.addEventListener("change", () => {
      const personId = nameSelect.value;
      const person = names.find((n) => n.id === personId);

      nameSelect.classList.toggle("has-value", !!person);

      const hint = $("#nameHint");
      if (person) {
        hint.innerHTML = "";
        const strong = document.createElement("strong");
        strong.textContent = person.name;
        hint.textContent = "Selected: ";
        hint.appendChild(strong);
      } else {
        hint.textContent = 'Tip: use "Manage Names" to add people.';
      }
    });

    // Tabs
    tabToday.addEventListener("click", () => setTab("today"));
    tabAll.addEventListener("click", () => setTab("all"));

    // All filters (debounced search)
    rangeSelect.addEventListener("change", renderTables);
    searchInput.addEventListener("input", debounce(renderTables, 250));

    // Table actions
    todayTbody.addEventListener("click", handleTableClick);
    allTbody.addEventListener("click", handleTableClick);

    // Names modal
    manageNamesBtn.addEventListener("click", () => {
      openModal(namesModal, namesModalBackdrop);
      newNameInput.focus();
      renderNamesList();
    });

    function closeNames() {
      closeModal(namesModal, namesModalBackdrop);
    }

    closeNamesModalBtn.addEventListener("click", closeNames);
    closeNamesModalBtn2.addEventListener("click", closeNames);
    namesModalBackdrop.addEventListener("click", closeNames);

    addNameBtn.addEventListener("click", addName);
    newNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addName();
    });

    // Confirm modal
    confirmOkBtn.addEventListener("click", () => closeConfirm(true));
    confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
    confirmCloseBtn.addEventListener("click", () => closeConfirm(false));
    confirmBackdrop.addEventListener("click", () => closeConfirm(false));

    // Wipe
    wipeDataBtn.addEventListener("click", wipeAll);

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!namesModal.classList.contains("hidden")) closeModal(namesModal, namesModalBackdrop);
      if (!confirmModal.classList.contains("hidden")) closeConfirm(false);
    });

    // PIN
    if (pinSubmitBtn) {
      pinSubmitBtn.addEventListener("click", handlePinSubmit);
      pinInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handlePinSubmit();
      });
    }

    // Online/offline
    window.addEventListener("online", () => {
      processQueue();
      refreshFromCloud();
    });
  }

  async function startApp() {
    // Try to load from cloud first
    if (cloudEnabled()) {
      showStatus("Syncing with Google Sheets…", "");
      const result = await refreshFromCloud();
      if (result && result.ok) {
        showStatus("Synced.", "good");
      } else if (result && result.error === "Invalid PIN") {
        // PIN expired or changed — re-prompt
        localStorage.removeItem(KEYS.pin);
        pinOverlay.classList.remove("hidden");
        pinError.textContent = "PIN no longer valid. Please re-enter.";
        return;
      } else {
        showStatus("Offline — using cached data.", "warn");
      }
      // Process any queued offline changes
      await processQueue();
    } else {
      showStatus("Local-only mode (no API URL configured).", "");
    }

    renderNameSelect();
    renderTables();
    updateCounts();
  }

  async function bootstrap() {
    initDateHeader();
    initEvents();

    if (cloudEnabled()) {
      const storedPin = localStorage.getItem(KEYS.pin);
      if (storedPin) {
        pinOverlay.classList.add("hidden");
        await startApp();
      } else {
        // Show PIN screen
        pinOverlay.classList.remove("hidden");
      }
    } else {
      // Local-only mode — hide PIN, go straight to app
      if (pinOverlay) pinOverlay.classList.add("hidden");
      renderNameSelect();
      renderTables();
      updateCounts();
      showStatus("Ready (local-only mode).", "");
    }
  }

  bootstrap();
})();
