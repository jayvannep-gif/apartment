// ============================================================
// common.js — Supabase setup + small helpers used by every page
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// 👉 PASTE YOURS HERE (Supabase > Project Settings > API)
const SUPABASE_URL = "https://wpjkxzziqcvrizoprmwo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_783QP7S9w0VcUuNWShzVwA_V_fym40k";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Supabase returns { data, error } instead of throwing. This turns errors into popups.
export async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
window.addEventListener("unhandledrejection", e => alert(e.reason?.message || "Something went wrong"));

// Who is logged in right now? (null if nobody)
export async function getUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user || null;
}

// Make text safe before putting it in HTML
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Colored label: 🟢 green, 🟡 yellow, 🔴 red, grey for the rest
export function badge(text) {
  const t = String(text).toLowerCase();
  const cls = ["approved", "paid", "resolved", "occupied"].includes(t) ? "green"
            : ["pending", "due soon", "in progress"].includes(t) ? "yellow"
            : ["rejected", "overdue"].includes(t) ? "red" : "gray";
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

export const money = n => "₱" + Number(n || 0).toLocaleString();

// Current month as "2026-10"
export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Rent is due on the same day of the month as the move-in date (max 28th)
export function dueDate(tenant) {
  const day = Math.min(Number(tenant.move_in_date.split("-")[2]) || 1, 28);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day);
}

// Returns: "Paid" | "Due Soon" | "Overdue" | "Upcoming" | "No Room"
export function paymentStatus(tenant, payments) {
  if (!tenant.room_number || !tenant.move_in_date) return "No Room";
  if (payments.some(p => p.month_covered === thisMonth())) return "Paid";
  const due = dueDate(tenant);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (today > due) return "Overdue";
  return (due - today) / 86400000 <= 5 ? "Due Soon" : "Upcoming";
}

// Upload a JPG/PNG/PDF (max 5MB). Returns the file's PATH (saved in the database).
export async function uploadFile(file, folder, uid) {
  if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) throw new Error("Only JPG, PNG or PDF files are allowed.");
  if (file.size > 5 * 1024 * 1024) throw new Error("File must be 5MB or smaller.");
  const path = `${folder}/${uid}/${Date.now()}_${file.name.replace(/[^\w.-]/g, "_")}`;
  await run(supabase.storage.from("uploads").upload(path, file));
  return path;
}

// Files are private, so we make a temporary link (valid 5 minutes) and open it
export async function openFile(path) {
  const win = window.open("", "_blank");   // open the tab first so the browser doesn't block it
  const { data, error } = await supabase.storage.from("uploads").createSignedUrl(path, 300);
  if (error) { win.close(); throw error; }
  win.location = data.signedUrl;
}