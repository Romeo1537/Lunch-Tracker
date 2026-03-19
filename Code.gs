/*
 * ============================================================
 *  Lunch Tracker — Google Apps Script backend (v2)
 * ============================================================
 *
 *  SETUP INSTRUCTIONS:
 *
 *  1. Open Google Sheets → create a new blank spreadsheet.
 *     (Name it "Lunch Tracker" or anything you like.)
 *
 *  2. In the spreadsheet menu: Extensions → Apps Script.
 *
 *  3. Delete any default code and paste THIS entire file.
 *
 *  4. Change the PIN below to something your team will use.
 *
 *  5. Click "Deploy" → "New deployment".
 *       • Type  → Web app
 *       • Execute as → Me
 *       • Who has access → Anyone
 *     Click "Deploy". Authorise when prompted.
 *
 *  6. Copy the Web app URL (looks like:
 *     https://script.google.com/macros/s/XXXX.../exec )
 *
 *  7. Open app_v9.js in your Lunch Tracker repo and paste the
 *     URL into the API_URL constant at the top of the file.
 *
 *  8. Commit + push to GitHub. Done!
 *
 *  The spreadsheet will auto-create "Names" and "Entries"
 *  sheets on first use. Your admins can open the spreadsheet
 *  any time to view / filter / download data.
 *
 *  IMPORTANT: Every time you edit this script you must create
 *  a NEW deployment (Deploy → New deployment) and update the
 *  URL in app_v9.js, OR use "Deploy → Manage deployments" and
 *  edit the existing one to use the latest version.
 *
 *  v2 CHANGES:
 *  - Names sheet now has: id | name | company
 *  - Entries sheet now has: id | dateISO | dayName | personId | personName | company | selection | timestampISO
 *  - editName now also updates company
 * ============================================================
 */

// ---- Change this to your team's shared PIN ----
const PIN = "lunch1234";

// ---- Helpers ----

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === "Entries") {
      sheet.appendRow(["id", "dateISO", "dayName", "personId", "personName", "company", "selection", "timestampISO"]);
      sheet.setFrozenRows(1);
    } else if (name === "Names") {
      sheet.appendRow(["id", "name", "company"]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Entry points ----

function doGet(e) {
  try {
    var action = e.parameter.action;
    var pin    = e.parameter.pin;
    Logger.log("doGet | action=" + action + " | pinOK=" + (pin === PIN));
    if (pin !== PIN) return respond({ error: "Invalid PIN" });
    var data = {};
    if (e.parameter.data) {
      try {
        data = JSON.parse(e.parameter.data);
        Logger.log("data=" + JSON.stringify(data));
      } catch (parseErr) {
        Logger.log("JSON parse error: " + parseErr.message);
      }
    }
    return handleAction(Object.assign({ action: action, pin: pin }, data));
  } catch (err) {
    Logger.log("doGet error: " + err.message);
    return respond({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.pin !== PIN) return respond({ error: "Invalid PIN" });
    return handleAction(body);
  } catch (err) {
    return respond({ error: err.message });
  }
}

// ---- Router ----

function handleAction(body) {
  switch (body.action) {
    case "verify":     return respond({ ok: true });
    case "getAll":     return getAllData();
    case "addEntry":   return addEntry(body.entry);
    case "deleteEntry":return deleteEntry(body.entryId);
    case "editEntry":  return editEntry(body.entryId, body.selection);
    case "addName":    return addNameAction(body.name);
    case "deleteName": return deleteName(body.nameId);
    case "editName":   return editName(body.nameId, body.newName, body.newCompany);
    case "wipe":       return wipeAll();
    case "sync":       return syncBatch(body.operations, body.pin);
    default:           return respond({ error: "Unknown action" });
  }
}

// ---- Actions ----

function getAllData() {
  var namesSheet   = getSheet("Names");
  var entriesSheet = getSheet("Entries");

  var namesData   = namesSheet.getDataRange().getValues();
  var entriesData = entriesSheet.getDataRange().getValues();

  var names = namesData.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) { return { id: String(r[0]), name: String(r[1]), company: String(r[2] || "") }; });

  var entries = entriesData.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        id:           String(r[0]),
        dateISO:      String(r[1]),
        dayName:      String(r[2]),
        personId:     String(r[3]),
        personName:   String(r[4]),
        company:      String(r[5] || ""),
        selection:    String(r[6]),
        timestampISO: String(r[7])
      };
    });

  return respond({ ok: true, names: names, entries: entries });
}

function addEntry(entry) {
  Logger.log("addEntry | entry=" + JSON.stringify(entry));
  if (!entry || !entry.id) {
    Logger.log("addEntry: missing entry data");
    return respond({ error: "No entry data received" });
  }
  var sheet = getSheet("Entries");
  sheet.appendRow([
    entry.id, entry.dateISO, entry.dayName,
    entry.personId, entry.personName, entry.company || "",
    entry.selection, entry.timestampISO
  ]);
  return respond({ ok: true });
}

function deleteEntry(entryId) {
  var sheet = getSheet("Entries");
  var data  = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(entryId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return respond({ ok: true });
}

function editEntry(entryId, selection) {
  var sheet = getSheet("Entries");
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(entryId)) {
      sheet.getRange(i + 1, 7).setValue(selection);
      break;
    }
  }
  return respond({ ok: true });
}

function addNameAction(name) {
  Logger.log("addName | name=" + JSON.stringify(name));
  if (!name || !name.id) {
    Logger.log("addName: missing name data");
    return respond({ error: "No name data received" });
  }
  var sheet = getSheet("Names");
  sheet.appendRow([name.id, name.name, name.company || ""]);
  return respond({ ok: true });
}

function deleteName(nameId) {
  var sheet = getSheet("Names");
  var data  = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(nameId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return respond({ ok: true });
}

function editName(nameId, newName, newCompany) {
  // Update Names sheet
  var sheet = getSheet("Names");
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(nameId)) {
      sheet.getRange(i + 1, 2).setValue(newName);
      sheet.getRange(i + 1, 3).setValue(newCompany || "");
      break;
    }
  }
  // Also update personName and company in Entries
  var entriesSheet = getSheet("Entries");
  var entriesData  = entriesSheet.getDataRange().getValues();
  for (var i = 1; i < entriesData.length; i++) {
    if (String(entriesData[i][3]) === String(nameId)) {
      entriesSheet.getRange(i + 1, 5).setValue(newName);
      entriesSheet.getRange(i + 1, 6).setValue(newCompany || "");
    }
  }
  return respond({ ok: true });
}

function wipeAll() {
  var namesSheet   = getSheet("Names");
  var entriesSheet = getSheet("Entries");
  if (namesSheet.getLastRow() > 1) {
    namesSheet.deleteRows(2, namesSheet.getLastRow() - 1);
  }
  if (entriesSheet.getLastRow() > 1) {
    entriesSheet.deleteRows(2, entriesSheet.getLastRow() - 1);
  }
  return respond({ ok: true });
}

function syncBatch(operations, pin) {
  for (var i = 0; i < operations.length; i++) {
    var op = operations[i];
    op.pin = pin;
    handleAction(op);
  }
  return respond({ ok: true });
}
