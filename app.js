/* Lunch Tracker (local-only)
   - Names stored in localStorage
   - Entries stored in localStorage
   - iPad-friendly UI
*/

(function () {
  "use strict";

  // ---------- Storage keys ----------
  const KEYS = {
    names: "lt_names_v1",
    entries: "lt_entries_v1"
  };

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid() {
    // stable-enough local unique id
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
    // Expects Date
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

  // ---------- State ----------
  let names = loadJSON(KEYS.names, []);     // [{id, name}]
  let entries = loadJSON(KEYS.entries, []); // [{id, dateISO, dayName, personId, personName, selection, timestampISO}]

  // ---------- Elements ----------
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

  // ---------- Modal helpers ----------
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

  // ---------- Names ----------
  function sortNames() {
    names.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  }

  function persistNames() {
    saveJSON(KEYS.names, names);
  }

  function persistEntries() {
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

    // Try keep selection
    if (current && names.some(n => n.id === current)) {
      nameSelect.value = current;
    }
  

    // Keep styling + hint consistent after re-render
    nameSelect.dispatchEvent(new Event("change"));
}

  function renderNamesList() {
    sortNames();
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

      save.addEventListener("click", async () => {
        const newVal = safeTrim(editInput.value);
        if (!newVal) return showStatus("Name cannot be blank.", "bad");

        // prevent duplicates (case-insensitive)
        const exists = names.some(x => x.id !== n.id && x.name.toLowerCase() === newVal.toLowerCase());
        if (exists) return showStatus("That name already exists.", "warn");

        const oldName = n.name;
        n.name = newVal;

        // Update entries to keep name snapshot aligned (optional)
        for (const e of entries) {
          if (e.personId === n.id) e.personName = newVal;
        }

        persistNames();
        persistEntries();
        renderNameSelect();
        renderNamesList();
        renderTables();
        updateCounts();
        showStatus(`Updated "${oldName}" to "${newVal}".`, "good");
      });

      del.addEventListener("click", async () => {
        const ok = await confirmDialog(`Delete "${n.name}"? This does not delete their past entries.`);
        if (!ok) return;

        names = names.filter(x => x.id !== n.id);
        persistNames();
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

    const exists = names.some(n => n.name.toLowerCase() === val.toLowerCase());
    if (exists) return showStatus("That name already exists.", "warn");

    names.push({ id: uid(), name: val });
    persistNames();

    newNameInput.value = "";
    renderNameSelect();
    renderNamesList();
    updateCounts();
    showStatus(`Added "${val}".`, "good");
  }

  // ---------- Entries ----------
  function getSelectedMealType() {
    const el = document.querySelector('input[name="mealType"]:checked');
    return el ? el.value : "";
  }

  function clearMealSelection() {
    $$('input[name="mealType"]').forEach(r => r.checked = false);
  }

  function entryExistsForPersonOnDate(personId, dateISO) {
    return entries.some(e => e.personId === personId && e.dateISO === dateISO);
  }

  async function saveEntry() {
    const personId = nameSelect.value;
    const person = names.find(n => n.id === personId);
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

    entries.push({
      id: uid(),
      dateISO,
      dayName: day,
      personId,
      personName: person.name,
      selection,
      timestampISO: now.toISOString()
    });

    persistEntries();
    renderTables();
    updateCounts();
    showStatus(`Saved: ${person.name} — ${selection}`, "good");
  }

  function deleteEntry(entryId) {
    entries = entries.filter(e => e.id !== entryId);
    persistEntries();
    renderTables();
    updateCounts();
    showStatus("Entry deleted.", "good");
  }

  async function editEntry(entryId) {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    // Simple prompt-based edit to keep UI minimal
    const mealOptions = ["Starter", "Main course", "Dessert", "Starter + main course", "Main course + dessert", "Starter + dessert", "2 starters"];
    const currentIdx = mealOptions.indexOf(entry.selection);
    const promptText =
      `Edit selection for ${entry.personName} on ${entry.dateISO}
` +
      `1) Starter
2) Main course
3) Dessert
4) Starter + main course
5) Main course + dessert
6) Starter + dessert
7) 2 starters

` +
      `Enter 1–7 (current: ${currentIdx >= 0 ? currentIdx + 1 : entry.selection})`;

    const ans = window.prompt(promptText, currentIdx >= 0 ? String(currentIdx + 1) : "");
    if (ans === null) return; // cancelled
    const n = parseInt(ans, 10);
    if (![1,2,3,4,5,6,7].includes(n)) return showStatus("Edit cancelled: invalid option.", "warn");

    entry.selection = mealOptions[n-1];
    persistEntries();
    renderTables();
    showStatus("Entry updated.", "good");
  }

  function withinRange(dateISO, rangeValue) {
    if (rangeValue === "all") return true;

    const today = new Date();
    const target = new Date(dateISO + "T00:00:00");
    const diffDays = Math.floor((today.setHours(0,0,0,0) - target.getTime()) / (1000 * 60 * 60 * 24));

    if (rangeValue === "today") return diffDays === 0;
    const days = parseInt(rangeValue, 10);
    if (!Number.isFinite(days)) return true;
    return diffDays >= 0 && diffDays < days;
  }

  function renderTables() {
    const today = todayISODate();
    const todays = entries
      .filter(e => e.dateISO === today)
      .sort((a, b) => (a.timestampISO < b.timestampISO ? -1 : 1));

    todayTbody.innerHTML = "";
    for (const e of todays) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${e.personName}</td>
        <td>${e.selection}</td>
        <td>${formatTimeHHMM(new Date(e.timestampISO))}</td>
        <td class="right">
          <div class="row-actions">
            <button class="small-btn" data-action="edit" data-id="${e.id}" type="button">Edit</button>
            <button class="small-btn danger" data-action="delete" data-id="${e.id}" type="button">Delete</button>
          </div>
        </td>
      `;
      todayTbody.appendChild(tr);
    }

    todayEmpty.style.display = todays.length ? "none" : "block";

    // All view
    const rangeVal = rangeSelect.value;
    const q = safeTrim(searchInput.value).toLowerCase();

    const filtered = entries
      .filter(e => withinRange(e.dateISO, rangeVal))
      .filter(e => !q || e.personName.toLowerCase().includes(q))
      .sort((a, b) => (a.dateISO === b.dateISO ? (a.timestampISO < b.timestampISO ? -1 : 1) : (a.dateISO < b.dateISO ? 1 : -1)));

    allTbody.innerHTML = "";
    for (const e of filtered) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${e.dateISO}</td>
        <td>${e.dayName}</td>
        <td>${e.personName}</td>
        <td>${e.selection}</td>
        <td>${formatTimeHHMM(new Date(e.timestampISO))}</td>
        <td class="right">
          <div class="row-actions">
            <button class="small-btn" data-action="edit" data-id="${e.id}" type="button">Edit</button>
            <button class="small-btn danger" data-action="delete" data-id="${e.id}" type="button">Delete</button>
          </div>
        </td>
      `;
      allTbody.appendChild(tr);
    }

    allEmpty.style.display = filtered.length ? "none" : "block";
  }

  // Delegate table actions
  function handleTableClick(ev) {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");

    if (action === "delete") {
      confirmDialog("Delete this entry?").then(ok => {
        if (ok) deleteEntry(id);
        else showStatus("No changes made.", "");
      });
    } else if (action === "edit") {
      editEntry(id);
    }
  }

  // ---------- Export ----------
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
    const stamp = todayISODate();
    downloadTextFile(`lunch-tracker_${stamp}.csv`, csv, "text/csv;charset=utf-8");
    showStatus("Exported CSV.", "good");
  }

  // ---------- Tabs ----------
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

  // ---------- Counts ----------
  function updateCounts() {
    namesCountPill.textContent = `${names.length} name${names.length === 1 ? "" : "s"}`;
    entriesCountPill.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  }

  // ---------- Wipe ----------
  async function wipeAll() {
    const ok = await confirmDialog("Wipe ALL local data (names + entries) from this device?");
    if (!ok) return;

    names = [];
    entries = [];
    persistNames();
    persistEntries();
    renderNameSelect();
    renderNamesList();
    renderTables();
    updateCounts();
    clearMealSelection();
    nameSelect.value = "";
    showStatus("Local data wiped.", "good");
  }

  // ---------- Init ----------
  function initDateHeader() {
    const now = new Date();
    todayDisplay.textContent = formatUKDate(now);
  }

  function initEvents() {
    saveBtn.addEventListener("click", saveEntry);
    clearSelectionBtn.addEventListener("click", () => {
      clearMealSelection();
      showStatus("Selection cleared.", "");
    });

    exportBtn.addEventListener("click", exportCSV);

    

    // Name select: clearer selected state + coloured select once chosen
    nameSelect.addEventListener("change", () => {
      const personId = nameSelect.value;
      const person = names.find(n => n.id === personId);

      // Toggle colour when a real name is selected
      nameSelect.classList.toggle("has-value", !!person);

      // Make it clearer what is selected
      const hint = $("#nameHint");
      if (person) {
        hint.innerHTML = `Selected: <strong>${person.name}</strong>`;
      } else {
        hint.textContent = 'Tip: use “Manage Names” to add people.';
      }
    });
// Tabs
    tabToday.addEventListener("click", () => setTab("today"));
    tabAll.addEventListener("click", () => setTab("all"));

    // All filters
    rangeSelect.addEventListener("change", renderTables);
    searchInput.addEventListener("input", renderTables);

    // Table actions
    todayTbody.addEventListener("click", handleTableClick);
    allTbody.addEventListener("click", handleTableClick);

    // Names modal open/close
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

    // Add name
    addNameBtn.addEventListener("click", addName);
    newNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addName();
    });

    // Confirm modal close handlers
    confirmOkBtn.addEventListener("click", () => closeConfirm(true));
    confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
    confirmCloseBtn.addEventListener("click", () => closeConfirm(false));
    confirmBackdrop.addEventListener("click", () => closeConfirm(false));

    // Wipe
    wipeDataBtn.addEventListener("click", wipeAll);

    // Keyboard escape closes modals
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!namesModal.classList.contains("hidden")) closeModal(namesModal, namesModalBackdrop);
      if (!confirmModal.classList.contains("hidden")) closeConfirm(false);
    });
  }

  
  function initPWA() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Check for updates on each load
      reg.update().catch(() => {});

      // If a new SW is found, it will install and then activate (skipWaiting in sw.js)
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          // When installed and there's an existing controller, an update is ready
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // Force a single reload when the new SW takes control
            // (controllerchange will trigger below)
          }
        });
      });
    }).catch(() => {});

    // When the new service worker takes control, reload once to get the latest assets
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }
);
    }
  }

  function bootstrap() {
    initDateHeader();
    initEvents();
    renderNameSelect();
    renderTables();
    updateCounts();
    showStatus("Ready.", "");
    initPWA();
  }

  bootstrap();
})();
