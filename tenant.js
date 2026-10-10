// ============================================================
// tenant.js — what a tenant sees and can do (Supabase version)
// ============================================================
import { supabase, run, getUser, esc, badge, money, paymentStatus, dueDate, uploadFile } from "./common.js";

const $ = id => document.getElementById(id);
$("logout").onclick = async () => { await supabase.auth.signOut(); location.href = "index.html"; };

// ---------- 1. Check login, then load the profile ----------
const user = await getUser();
if (!user) location.href = "index.html";
const me = await run(supabase.from("users").select("*").eq("id", user.id).single());
if (me.role === "admin") location.href = "admin.html";
showPage();

// ---------- 2. Show the page ----------
function showPage() {
  $("info").innerHTML = `
    <p><b>${esc(me.name)}</b><br>${esc(me.contact)} · ${esc(me.email)}</p>
    <p>Room: <b>${esc(me.room_number || "Not assigned yet")}</b><br>
       Move-in date: <b>${esc(me.move_in_date || "—")}</b></p>
    <p>ID status: ${badge(me.id_verified)}</p>`;

  const uploaded = !!me.id_document_url;
  const approved = me.id_verified === "approved";

  // Message at the top depends on the ID status
  const notice = $("idNotice");
  if (approved) notice.classList.add("hidden");
  else if (me.id_verified === "rejected") { notice.className = "notice red"; notice.textContent = "Your ID was rejected. Please upload a clearer photo or a different ID."; }
  else if (uploaded) { notice.className = "notice yellow"; notice.textContent = "Your ID is waiting for the landlord's approval. Some features are locked until then."; }
  else { notice.className = "notice yellow"; notice.textContent = "Please upload a government ID to unlock your account."; }

  $("idCard").classList.toggle("hidden", approved);        // hide the upload form once approved
  $("approvedArea").classList.toggle("hidden", !approved); // show bills & reports only when approved
  if (approved) { loadBilling(); loadReports(); }
}

// ---------- 3. Billing ----------
async function loadBilling() {
  const myPayments = await run(supabase.from("payments").select("*").eq("tenant_id", me.id));
  let rent = 0;
  if (me.room_number) {
    const room = await run(supabase.from("rooms").select("rent_price").eq("room_number", me.room_number).maybeSingle());
    rent = room?.rent_price || 0;
  }
  const status = paymentStatus(me, myPayments);
  $("bill").innerHTML = status === "No Room"
    ? "<p class='muted'>No room assigned yet.</p>"
    : `<p>Rent: <b>${money(rent)}</b><br>Due date: <b>${dueDate(me).toLocaleDateString()}</b><br>Status: ${badge(status)}</p>`;

  myPayments.sort((a, b) => b.paid_date.localeCompare(a.paid_date));
  $("history").innerHTML = myPayments.length
    ? `<div class="scroll"><table><tr><th>Date</th><th>Month</th><th>Amount</th><th>Status</th></tr>
       ${myPayments.map(p => `<tr><td>${esc(p.paid_date)}</td><td>${esc(p.month_covered)}</td><td>${money(p.amount)}</td><td>${badge(p.status)}</td></tr>`).join("")}</table></div>`
    : "<p class='muted'>No payments recorded yet.</p>";
}

// ---------- 4. Problem reports ----------
async function loadReports() {
  const list = await run(supabase.from("reports").select("*").eq("tenant_id", me.id).order("created_at", { ascending: false }));
  $("myReports").innerHTML = list.length ? list.map(r => `
    <div style="border-bottom:1px solid var(--line);padding:.6rem 0">
      <b>${esc(r.issue_type)}</b> ${badge(r.status)}
      <p>${esc(r.description)}</p>
      ${r.admin_notes ? `<p class="muted">Landlord's note: ${esc(r.admin_notes)}</p>` : ""}
    </div>`).join("") : "<p class='muted'>You haven't sent any reports.</p>";
}

$("reportForm").onsubmit = async e => {
  e.preventDefault();
  if (!me.room_number) return alert("You need a room assigned before you can send a report.");
  const file = $("photo").files[0];
  const photo_url = file ? await uploadFile(file, "reports", me.id) : "";
  await run(supabase.from("reports").insert({
    tenant_id: me.id, tenant_name: me.name, room_number: me.room_number,
    issue_type: $("issueType").value, description: $("desc").value.trim(), photo_url
  }));
  e.target.reset();
  alert("Report sent!");
  loadReports();
};

// ---------- 5. Upload government ID ----------
$("idForm").onsubmit = async e => {
  e.preventDefault();
  const path = await uploadFile($("idFile").files[0], "ids", me.id);
  await run(supabase.from("users").update({ id_type: $("idType").value, id_document_url: path, id_verified: "pending" }).eq("id", me.id));
  location.reload();
};