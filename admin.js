// ============================================================
// admin.js — everything the landlord can do (Supabase version)
// ============================================================
import { supabase, run, getUser, esc, badge, money, thisMonth, dueDate, paymentStatus, openFile } from "./common.js";

const $ = id => document.getElementById(id);

// Data kept in memory after loading from the database
let rooms = [], tenants = [], payments = [], reports = [], utilities = [];

// ---------- 1. Make sure only the admin can be here ----------
const user = await getUser();
if (!user) location.href = "index.html";
const me = await run(supabase.from("users").select("role").eq("id", user.id).single());
if (me.role !== "admin") location.href = "tenant.html";
$("logout").onclick = async () => { await supabase.auth.signOut(); location.href = "index.html"; };


// ---------- 2. Load data ----------
const getAll = name => run(supabase.from(name).select("*"));
async function loadAll() {
  rooms = (await getAll("rooms")).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  tenants = (await getAll("users")).filter(u => u.role === "tenant");
  payments = await getAll("payments");
  reports = await getAll("reports");
  utilities = await getAll("utilities");
  renderAll();
}

// ---------- 3. Small helpers ----------
const byNewest = (a, b) => b.created_at.localeCompare(a.created_at);
const tenantName = id => tenants.find(t => t.id === id)?.name || "(removed)";
const statusOf = t => paymentStatus(t, payments.filter(p => p.tenant_id === t.id));
const rentOf = t => rooms.find(r => r.room_number === t.room_number)?.rent_price || 0;
const options = (list, value, label) => list.map(x => `<option value="${esc(value(x))}">${esc(label(x))}</option>`).join("");

// Build an HTML table. rows = array of arrays (cells are already-safe HTML)
function table(heads, rows) {
  if (!rows.length) return "<p class='muted'>Nothing here yet.</p>";
  return `<div class="scroll"><table><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr>
    ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
const btn = (act, id, text, color = "") => `<button class="btn small ${color}" data-act="${act}" data-id="${esc(id)}">${text}</button>`;

// ---------- 4. Tabs ----------
document.querySelectorAll(".tabs button").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button, .panel").forEach(el => el.classList.remove("active", "show"));
    b.classList.add("active");
    $(b.dataset.tab).classList.add("show");
  };
});

// ---------- 5. Draw everything ----------
function renderAll() {
  renderDashboard(); renderRooms(); renderTenants(); renderPayments(); renderUtilities(); renderReports();
}

function renderDashboard() {
  const occupied = rooms.filter(r => r.status === "occupied").length;
  const overdue = tenants.filter(t => statusOf(t) === "Overdue");
  $("statRooms").textContent = rooms.length;
  $("statOccupied").textContent = occupied;
  $("statVacant").textContent = rooms.length - occupied;
  $("statOverdue").textContent = overdue.length;
  $("overdueList").innerHTML = overdue.length
    ? overdue.map(t => `<li>${esc(t.name)} — Room ${esc(t.room_number)} (was due ${dueDate(t).toLocaleDateString()})</li>`).join("")
    : "<li>No one is overdue 🎉</li>";
  $("recentReports").innerHTML = table(["Room", "Issue", "Status"],
    [...reports].sort(byNewest).slice(0, 5).map(r => [esc(r.room_number), esc(r.issue_type), badge(r.status)]));
}

// ----- ROOMS -----
function renderRooms() {
  $("roomTable").innerHTML = table(["Room", "Floor", "Rent", "Status", "Tenant", ""],
    rooms.map(r => [esc(r.room_number), esc(r.floor), money(r.rent_price), badge(r.status), esc(r.current_tenant || "—"), btn("editRoom", r.id, "Edit")]));
}
$("roomForm").onsubmit = async e => {
  e.preventDefault();
  const data = { room_number: $("rNumber").value.trim(), floor: Number($("rFloor").value), rent_price: Number($("rRent").value), status: $("rStatus").value };
  const id = $("rId").value;
  if (id) await run(supabase.from("rooms").update(data).eq("id", id));  // editing
  else await run(supabase.from("rooms").insert(data));                   // adding
  e.target.reset(); $("rId").value = "";
  loadAll();
};

// ----- TENANTS -----
function renderTenants() {
  $("tenantTable").innerHTML = table(["Name", "Contact", "Room", "Move-in", "Deposit / Advance", "ID", "ID file", ""],
    tenants.map(t => [
      esc(t.name), esc(t.contact) + "<br><span class='muted'>" + esc(t.email) + "</span>",
      esc(t.room_number || "—"), esc(t.move_in_date || "—"), `${money(t.deposit)} / ${money(t.advance)}`,
      badge(t.id_verified) + (t.id_type ? `<br><span class="muted">${esc(t.id_type)}</span>` : ""),
      t.id_document_url ? btn("viewFile", t.id_document_url, "View ID") : "Not uploaded",
      btn("editTenant", t.id, "Edit") + (t.id_document_url ? btn("approve", t.id, "Approve", "green") + btn("reject", t.id, "Reject", "red") : "") + btn("removeTenant", t.id, "Remove", "grey")
    ]));
}
$("tenantForm").onsubmit = async e => {
  e.preventDefault();
  const id = $("tId").value;
  const old = tenants.find(t => t.id === id);
  const data = { name: $("tName").value.trim(), contact: $("tContact").value.trim(), room_number: $("tRoom").value,
                 move_in_date: $("tMoveIn").value || null, deposit: Number($("tDeposit").value), advance: Number($("tAdvance").value) };
  await run(supabase.from("users").update(data).eq("id", id));
  // Keep the room list in sync: free the old room, occupy the new one
  if (old.room_number && old.room_number !== data.room_number) await setRoom(old.room_number, "vacant", "");
  if (data.room_number) await setRoom(data.room_number, "occupied", data.name);
  $("tenantFormCard").classList.add("hidden");
  loadAll();
};
async function setRoom(roomNumber, status, currentTenant) {
  const room = rooms.find(r => r.room_number === roomNumber);
  if (room) await run(supabase.from("rooms").update({ status, current_tenant: currentTenant }).eq("id", room.id));
}

// ----- PAYMENTS -----
function renderPayments() {
  const assigned = tenants.filter(t => t.room_number);
  $("pTenant").innerHTML = options(assigned, t => t.id, t => `${t.name} (Room ${t.room_number})`);
  $("pMonth").value ||= thisMonth();

  $("payStatus").innerHTML = table(["Tenant", "Room", "Rent", "Due date", "Status"],
    assigned.map(t => [esc(t.name), esc(t.room_number), money(rentOf(t)), dueDate(t).toLocaleDateString(), badge(statusOf(t))]));

  const totals = {};
  payments.forEach(p => (totals[p.month_covered] = (totals[p.month_covered] || 0) + p.amount));
  $("incomeTable").innerHTML = table(["Month", "Total collected"],
    Object.keys(totals).sort().reverse().map(m => [esc(m), money(totals[m])]));

  $("payTable").innerHTML = table(["Date", "Tenant", "Month covered", "Amount", "Status", ""],
    [...payments].sort((a, b) => b.paid_date.localeCompare(a.paid_date)).map(p =>
      [esc(p.paid_date), esc(tenantName(p.tenant_id)), esc(p.month_covered), money(p.amount), badge(p.status), btn("deletePayment", p.id, "Delete", "grey")]));
}
// When a tenant is chosen, fill in their room's rent automatically
$("pTenant").onchange = () => ($("pAmount").value = rentOf(tenants.find(t => t.id === $("pTenant").value)));
$("payForm").onsubmit = async e => {
  e.preventDefault();
  await run(supabase.from("payments").insert({
    tenant_id: $("pTenant").value, amount: Number($("pAmount").value),
    paid_date: $("pDate").value, month_covered: $("pMonth").value, status: "Paid"
  }));
  e.target.reset();
  loadAll();
};

// ----- UTILITIES -----
function renderUtilities() {
  $("uRoom").innerHTML = options(rooms, r => r.id, r => "Room " + r.room_number);
  $("utilTable").innerHTML = table(["Date", "Room", "Electricity (kWh)", "Water (m³)", "Amount due"],
    [...utilities].sort((a, b) => b.reading_date.localeCompare(a.reading_date)).map(u =>
      [esc(u.reading_date), esc(u.room_number), esc(u.electric_kwh), esc(u.water_cubic), money(u.amount_due)]));
}
$("utilForm").onsubmit = async e => {
  e.preventDefault();
  const kwh = Number($("uKwh").value), water = Number($("uWater").value);
  const amountDue = kwh * Number($("uKwhRate").value) + water * Number($("uWaterRate").value); // the calculation
  const room = rooms.find(r => r.id === $("uRoom").value);
  await run(supabase.from("utilities").insert({
    room_id: room.id, room_number: room.room_number, reading_date: $("uDate").value,
    electric_kwh: kwh, water_cubic: water, amount_due: Math.round(amountDue * 100) / 100
  }));
  loadAll();
};

// ----- REPORTS -----
function renderReports() {
  const list = [...reports].sort(byNewest);
  $("reportList").innerHTML = list.length ? list.map(r => `
    <div class="card">
      <h3>Room ${esc(r.room_number)} — ${esc(r.issue_type)} ${badge(r.status)}</h3>
      <p class="muted">From ${esc(r.tenant_name)} on ${new Date(r.created_at).toLocaleDateString()}</p>
      <p>${esc(r.description)}</p>
      ${r.photo_url ? `<p>${btn("viewFile", r.photo_url, "View photo")}</p>` : ""}
      <form>
        <label>Status
          <select id="st-${r.id}">${["Pending", "In Progress", "Resolved"].map(s => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
        <label class="wide">Notes for tenant <textarea id="nt-${r.id}">${esc(r.admin_notes)}</textarea></label>
      </form>
      <p>${btn("saveReport", r.id, "Save update")}</p>
    </div>`).join("") : "<div class='card'>No reports yet.</div>";
}

// ---------- 6. Button clicks (one listener for every button with data-act) ----------
const setIdStatus = async (id, status) => { await run(supabase.from("users").update({ id_verified: status }).eq("id", id)); loadAll(); };
const actions = {
  viewFile: path => openFile(path),
  editRoom(id) {
    const r = rooms.find(x => x.id === id);
    $("rId").value = id; $("rNumber").value = r.room_number; $("rFloor").value = r.floor; $("rRent").value = r.rent_price; $("rStatus").value = r.status;
    window.scrollTo(0, 0);
  },
  editTenant(id) {
    const t = tenants.find(x => x.id === id);
    // Room dropdown: vacant rooms + the tenant's current room
    const choices = rooms.filter(r => r.status === "vacant" || r.room_number === t.room_number);
    $("tRoom").innerHTML = `<option value="">— none —</option>` + options(choices, r => r.room_number, r => "Room " + r.room_number);
    $("tId").value = id; $("tName").value = t.name; $("tContact").value = t.contact; $("tRoom").value = t.room_number;
    $("tMoveIn").value = t.move_in_date || ""; $("tDeposit").value = t.deposit; $("tAdvance").value = t.advance;
    $("tenantFormCard").classList.remove("hidden");
    window.scrollTo(0, 0);
  },
  approve: id => setIdStatus(id, "approved"),
  reject: id => setIdStatus(id, "rejected"),
  async removeTenant(id) {
    const t = tenants.find(x => x.id === id);
    if (!confirm(`Remove ${t.name}? This cannot be undone.`)) return;
    if (t.room_number) await setRoom(t.room_number, "vacant", "");
    await run(supabase.from("users").delete().eq("id", id));
    loadAll();
  },
  async deletePayment(id) {
    if (confirm("Delete this payment?")) { await run(supabase.from("payments").delete().eq("id", id)); loadAll(); }
  },
  async saveReport(id) {
    await run(supabase.from("reports").update({ status: $("st-" + id).value, admin_notes: $("nt-" + id).value }).eq("id", id));
    loadAll();
  }
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (b) actions[b.dataset.act](b.dataset.id);
});
   // Start! (must be last, so everything above is ready)
   loadAll();