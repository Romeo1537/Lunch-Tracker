/* Lunch Tracker v11 — Company field + initials-based name picker
   - Names now have a "company" field (free text)
   - Entries store company at time of logging
   - Name selection via initials search + company filter
   - Manage Names modal: scrollable list with search
   - Cloud sync to Google Sheets (via Apps Script)
   - Falls back to localStorage when offline
   - Offline queue replays when connection returns
   - Simple shared PIN authentication
   - iPad-friendly UI
*/

(function () {
  "use strict";

  // ========== CONFIGURATION ==========
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

  // Extract initials from a full name: "Romeo Lam" → "RL"
  function getInitials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join("");
  }

  // ========== Cloud API ==========
  function cloudEnabled() {
    return API_URL.length > 0;
  }

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

  async function apiGet(action) {
    return api(action);
  }

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
      renderCompanyFilter();
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
  let selectedPersonId = "";
  let highlightedIndex = -1;

  // ========== Elements ==========
  const todayDisplay = $("#todayDisplay");
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

  // Name picker elements
  const initialsInput = $("#initialsInput");
  const companyFilter = $("#companyFilter");
  const namePickerResults = $("#namePickerResults");
  const nameSelectHidden = $("#nameSelectHidden");
  const nameHint = $("#nameHint");

  // Names modal
  const namesModal = $("#namesModal");
  const namesModalBackdrop = $("#namesModalBackdrop");
  const closeNamesModalBtn = $("#closeNamesModalBtn");
  const closeNamesModalBtn2 = $("#closeNamesModalBtn2");
  const newNameInput = $("#newNameInput");
  const newCompanyInput = $("#newCompanyInput");
  const namesSearchInput = $("#namesSearchInput");
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

  // ========== Name Picker (initials-based) ==========

  function renderCompanyFilter() {
    const companies = [...new Set(names.map((n) => n.company || "").filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })
    );
    const current = companyFilter.value;
    companyFilter.innerHTML = '<option value="">All companies</option>';
    for (const c of companies) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      companyFilter.appendChild(opt);
    }
    if (current && companies.includes(current)) {
      companyFilter.value = current;
    }
  }

  function getFilteredNames() {
    const query = safeTrim(initialsInput.value).toUpperCase();
    const company = companyFilter.value;

    let filtered = names.slice();

    if (company) {
      filtered = filtered.filter((n) => (n.company || "") === company);
    }

    if (query) {
      filtered = filtered.filter((n) => {
        const initials = getInitials(n.name);
        return initials.startsWith(query);
      });
    }

    filtered.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
    return filtered;
  }

  function renderNamePickerResults() {
    const query = safeTrim(initialsInput.value);
    const filtered = getFilteredNames();

    namePickerResults.innerHTML = "";
    highlightedIndex = -1;

    if (!query && !companyFilter.value) {
      namePickerResults.classList.add("hidden");
      return;
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "name-picker-item";
      empty.style.cursor = "default";
      empty.style.color = "var(--muted)";
      empty.textContent = "No matches found.";
      namePickerResults.appendChild(empty);
      namePickerResults.classList.remove("hidden");
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      const n = filtered[i];
      const item = document.createElement("div");
      item.className = "name-picker-item";
      item.dataset.personId = n.id;
      item.dataset.index = i;

      const nameSpan = document.createElement("span");
      nameSpan.className = "npi-name";
      nameSpan.textContent = n.name;

      const initialsSpan = document.createElement("span");
      initialsSpan.className = "npi-initials";
      initialsSpan.textContent = getInitials(n.name);

      const companySpan = document.createElement("span");
      companySpan.className = "npi-company";
      companySpan.textContent = n.company || "";

      item.appendChild(nameSpan);
      item.appendChild(initialsSpan);
      item.appendChild(companySpan);

      item.addEventListener("click", () => selectPerson(n.id));

      namePickerResults.appendChild(item);
    }

    namePickerResults.classList.remove("hidden");
  }

  function selectPerson(personId) {
    const person = names.find((n) => n.id === personId);
    if (!person) return;

    selectedPersonId = personId;
    nameSelectHidden.value = personId;

    // Hide results and clear input
    namePickerResults.classList.add("hidden");
    initialsInput.value = "";

    // Show selected badge in hint area
    nameHint.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "name-picker-selected";

    const badge = document.createElement("span");
    badge.className = "nps-badge";
    badge.textContent = person.name;
    if (person.company) {
      const compSpan = document.createElement("span");
      compSpan.className = "nps-company";
      compSpan.textContent = " — " + person.company;
      badge.appendChild(compSpan);
    }

    const clearBtn = document.createElement("button");
    clearBtn.className = "nps-clear";
    clearBtn.textContent = "Clear";
    clearBtn.type = "button";
    clearBtn.addEventListener("click", clearPersonSelection);

    wrap.appendChild(badge);
    wrap.appendChild(clearBtn);
    nameHint.appendChild(wrap);
  }

  function clearPersonSelection() {
    selectedPersonId = "";
    nameSelectHidden.value = "";
    initialsInput.value = "";
    nameHint.textContent = 'Type initials (e.g. "RL") to find a name.';
    namePickerResults.classList.add("hidden");
    highlightedIndex = -1;
  }

  function highlightItem(index) {
    const items = namePickerResults.querySelectorAll(".name-picker-item[data-person-id]");
    items.forEach((el) => el.classList.remove("highlighted"));
    if (index >= 0 && index < items.length) {
      highlightedIndex = index;
      items[index].classList.add("highlighted");
      items[index].scrollIntoView({ block: "nearest" });
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

  function renderNamesList(filter) {
    sortNames();
    namesList.innerHTML = "";

    const q = (filter || "").toLowerCase();
    const visible = q ? names.filter((n) => n.name.toLowerCase().includes(q) || (n.company || "").toLowerCase().includes(q)) : names;

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = q ? "No names match your search." : "No names yet. Add the first one above.";
      namesList.appendChild(empty);
      return;
    }

    for (const n of visible) {
      const row = document.createElement("div");
      row.className = "name-item";

      const nameLabel = document.createElement("div");
      nameLabel.className = "name-label";
      nameLabel.textContent = n.name;

      const companyLabel = document.createElement("div");
      companyLabel.className = "company-label";
      companyLabel.textContent = n.company || "—";

      const save = document.createElement("button");
      save.className = "small-btn";
      save.textContent = "Edit";
      save.type = "button";

      const del = document.createElement("button");
      del.className = "small-btn danger";
      del.textContent = "Delete";
      del.type = "button";

      save.addEventListener("click", () => {
        // In-place edit: replace labels with inputs
        const nameInput = document.createElement("input");
        nameInput.className = "input";
        nameInput.type = "text";
        nameInput.value = n.name;
        nameInput.style.fontSize = "14px";

        const compInput = document.createElement("input");
        compInput.className = "input";
        compInput.type = "text";
        compInput.value = n.company || "";
        compInput.placeholder = "Company…";
        compInput.style.fontSize = "14px";

        const saveConfirm = document.createElement("button");
        saveConfirm.className = "small-btn";
        saveConfirm.textContent = "Save";
        saveConfirm.type = "button";
        saveConfirm.style.background = "rgba(16,185,129,.18)";
        saveConfirm.style.borderColor = "rgba(16,185,129,.5)";

        const cancel = document.createElement("button");
        cancel.className = "small-btn";
        cancel.textContent = "Cancel";
        cancel.type = "button";

        row.innerHTML = "";
        row.appendChild(nameInput);
        row.appendChild(compInput);
        row.appendChild(saveConfirm);
        row.appendChild(cancel);

        nameInput.focus();

        cancel.addEventListener("click", () => renderNamesList(safeTrim(namesSearchInput.value)));

        saveConfirm.addEventListener("click", () => {
          const newName = safeTrim(nameInput.value);
          const newCompany = safeTrim(compInput.value);
          if (!newName) return showStatus("Name cannot be blank.", "bad");

          const exists = names.some((x) => x.id !== n.id && x.name.toLowerCase() === newName.toLowerCase());
          if (exists) return showStatus("That name already exists.", "warn");

          n.name = newName;
          n.company = newCompany;

          for (const e of entries) {
            if (e.personId === n.id) {
              e.personName = newName;
              e.company = newCompany;
            }
          }

          persistNamesLocal();
          persistEntriesLocal();
          cloudSave("editName", { nameId: n.id, newName, newCompany });

          renderCompanyFilter();
          renderNamesList(safeTrim(namesSearchInput.value));
          renderTables();
          updateCounts();
          showStatus(`Updated "${newName}".`, "good");
        });
      });

      del.addEventListener("click", async () => {
        const ok = await confirmDialog(`Delete "${n.name}"? This does not delete their past entries.`);
        if (!ok) return;

        names = names.filter((x) => x.id !== n.id);
        persistNamesLocal();
        cloudSave("deleteName", { nameId: n.id });

        renderCompanyFilter();
        renderNamesList(safeTrim(namesSearchInput.value));
        updateCounts();
        showStatus(`Deleted "${n.name}".`, "good");
      });

      row.appendChild(nameLabel);
      row.appendChild(companyLabel);
      row.appendChild(save);
      row.appendChild(del);
      namesList.appendChild(row);
    }
  }

  function addName() {
    const val = safeTrim(newNameInput.value);
    const company = safeTrim(newCompanyInput.value);
    if (!val) return showStatus("Please enter a name.", "warn");

    const exists = names.some((n) => n.name.toLowerCase() === val.toLowerCase());
    if (exists) return showStatus("That name already exists.", "warn");

    const nameObj = { id: uid(), name: val, company };
    names.push(nameObj);
    persistNamesLocal();
    cloudSave("addName", { name: nameObj });

    newNameInput.value = "";
    newCompanyInput.value = "";
    renderCompanyFilter();
    renderNamesList(safeTrim(namesSearchInput.value));
    updateCounts();
    showStatus(`Added "${val}"${company ? " (" + company + ")" : ""}.`, "good");
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
    const personId = selectedPersonId;
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
      company: person.company || "",
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
      "Starter + Main Course", "Main Course + Dessert", "2 Starters",
      "Starter", "Main Course", "Dessert", "Starter + Dessert"
    ];
    const currentIdx = mealOptions.indexOf(entry.selection);
    const promptText =
      `Edit selection for ${entry.personName} on ${entry.dateISO}\n` +
      `1) Starter + Main Course\n2) Main Course + Dessert\n3) 2 Starters\n` +
      `4) Starter\n5) Main Course\n6) Dessert\n7) Starter + Dessert\n\n` +
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

    todayTbody.innerHTML = "";
    const todayFrag = document.createDocumentFragment();
    for (const e of todays) {
      const tr = document.createElement("tr");
      tr.appendChild(td(e.personName));
      tr.appendChild(td(e.company || ""));
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
      tr.appendChild(td(e.company || ""));
      tr.appendChild(td(e.selection));
      tr.appendChild(td(formatTimeHHMM(new Date(e.timestampISO))));
      tr.appendChild(actionsTd(e.id));
      allFrag.appendChild(tr);
    }
    allTbody.appendChild(allFrag);
    allEmpty.style.display = filtered.length ? "none" : "block";
  }

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

    const header = ["dateISO", "dayName", "personName", "company", "selection", "time", "timestampISO"];
    const lines = [header.map(csvEscape).join(",")];

    for (const e of entries.slice().sort((a, b) => (a.timestampISO < b.timestampISO ? -1 : 1))) {
      const time = formatTimeHHMM(new Date(e.timestampISO));
      const row = [e.dateISO, e.dayName, e.personName, e.company || "", e.selection, time, e.timestampISO];
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
    const ok = await confirmDialog("Clear local cache on this device only? This does not affect Google Sheets or other devices.");
    if (!ok) return;

    names = [];
    entries = [];
    persistNamesLocal();
    persistEntriesLocal();
    saveJSON(KEYS.queue, []);

    renderCompanyFilter();
    renderNamesList();
    renderTables();
    updateCounts();
    updateSyncIndicator();
    clearMealSelection();
    clearPersonSelection();
    showStatus("Local cache cleared. Reload to re-sync from Google Sheets.", "good");
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
      clearPersonSelection();
      showStatus("Selection cleared.", "");
    });

    exportBtn.addEventListener("click", exportCSV);

    // Name picker: initials input
    initialsInput.addEventListener("input", () => {
      // Auto-uppercase
      const pos = initialsInput.selectionStart;
      initialsInput.value = initialsInput.value.toUpperCase();
      initialsInput.setSelectionRange(pos, pos);
      renderNamePickerResults();
    });

    initialsInput.addEventListener("focus", () => {
      if (safeTrim(initialsInput.value) || companyFilter.value) {
        renderNamePickerResults();
      }
    });

    // Keyboard navigation in results
    initialsInput.addEventListener("keydown", (e) => {
      const items = namePickerResults.querySelectorAll(".name-picker-item[data-person-id]");
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightItem(Math.min(highlightedIndex + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightItem(Math.max(highlightedIndex - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < items.length) {
          selectPerson(items[highlightedIndex].dataset.personId);
        } else if (items.length === 1) {
          selectPerson(items[0].dataset.personId);
        }
      } else if (e.key === "Escape") {
        namePickerResults.classList.add("hidden");
        highlightedIndex = -1;
      }
    });

    // Company filter change
    companyFilter.addEventListener("change", renderNamePickerResults);

    // Close picker when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#namePicker")) {
        namePickerResults.classList.add("hidden");
        highlightedIndex = -1;
      }
    });

    // Tabs
    tabToday.addEventListener("click", () => setTab("today"));
    tabAll.addEventListener("click", () => setTab("all"));

    // All filters
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
      // Refresh company filter in case names changed
      renderCompanyFilter();
    }

    closeNamesModalBtn.addEventListener("click", closeNames);
    closeNamesModalBtn2.addEventListener("click", closeNames);
    namesModalBackdrop.addEventListener("click", closeNames);

    addNameBtn.addEventListener("click", addName);
    newNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addName();
    });
    newCompanyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addName();
    });

    // Names modal search
    namesSearchInput.addEventListener("input", debounce(() => {
      renderNamesList(safeTrim(namesSearchInput.value));
    }, 200));

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
    if (cloudEnabled()) {
      showStatus("Syncing with Google Sheets…", "");
      const result = await refreshFromCloud();
      if (result && result.ok) {
        showStatus("Synced.", "good");
      } else if (result && result.error === "Invalid PIN") {
        localStorage.removeItem(KEYS.pin);
        pinOverlay.classList.remove("hidden");
        pinError.textContent = "PIN no longer valid. Please re-enter.";
        return;
      } else {
        showStatus("Offline — using cached data.", "warn");
      }
      await processQueue();
    } else {
      showStatus("Local-only mode (no API URL configured).", "");
    }

    renderCompanyFilter();
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
        pinOverlay.classList.remove("hidden");
      }
    } else {
      if (pinOverlay) pinOverlay.classList.add("hidden");
      renderCompanyFilter();
      renderTables();
      updateCounts();
      showStatus("Ready (local-only mode).", "");
    }
  }

  bootstrap();
})();
