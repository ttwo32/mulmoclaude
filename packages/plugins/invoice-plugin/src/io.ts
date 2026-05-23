import type { FileOps } from "gui-chat-protocol";
import { type Invoice, type InvoiceCandidate, type InvoiceSettings, InvoiceSchema, InvoiceCandidateSchema, InvoiceSettingsSchema } from "./types";

// Standard file operations for committed invoices and candidate drafts.

export async function loadAllInvoices(files: FileOps): Promise<Invoice[]> {
  if (!(await files.exists("committed"))) return [];
  try {
    const fileNames = await files.readDir("committed");
    const invoices: Invoice[] = [];
    for (const name of fileNames) {
      if (!name.endsWith(".json")) continue;
      try {
        const content = await files.read(`committed/${name}`);
        const parsed = JSON.parse(content);
        const inv = InvoiceSchema.parse(parsed);
        invoices.push(inv);
      } catch {
        // Skip corrupted invoices
      }
    }
    return invoices.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

export async function loadAllCandidates(files: FileOps): Promise<InvoiceCandidate[]> {
  if (!(await files.exists("candidates"))) return [];
  try {
    const fileNames = await files.readDir("candidates");
    const candidates: InvoiceCandidate[] = [];
    for (const name of fileNames) {
      if (!name.endsWith(".json")) continue;
      try {
        const content = await files.read(`candidates/${name}`);
        const parsed = JSON.parse(content);
        const cand = InvoiceCandidateSchema.parse(parsed);
        candidates.push(cand);
      } catch {
        // Skip corrupted candidates
      }
    }
    return candidates.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveCandidate(files: FileOps, candidate: InvoiceCandidate): Promise<void> {
  await files.write(`candidates/${candidate.candidateId}.json`, JSON.stringify(candidate, null, 2));
}

export async function deleteCandidate(files: FileOps, candidateId: string): Promise<void> {
  if (await files.exists(`candidates/${candidateId}.json`)) {
    await files.unlink(`candidates/${candidateId}.json`);
  }
}

export async function commitInvoice(files: FileOps, invoice: Invoice): Promise<void> {
  await files.write(`committed/${invoice.id}.json`, JSON.stringify(invoice, null, 2));
}

// ─────────────────────────────────────────────────────────────────────
// Loose Coupling (疎結合) Fallbacks & Dynamic Plugin APIs
// ─────────────────────────────────────────────────────────────────────

function parseClientFrontmatter(content: string, filenameId: string): any {
  const lines = content.split(/\r?\n/);
  const data: any = {
    id: filenameId,
    name: filenameId,
    status: "active",
    contacts: [],
    rate: { amount: 0, currency: "USD", unit: "hour" },
    paymentTerms: "net-30",
    tags: [],
    firstEngagement: "",
    notes: "",
  };

  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (!inFrontmatter) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed
      .slice(colonIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (key === "id") data.id = val;
    else if (key === "name") data.name = val;
    else if (key === "status") data.status = val;
    else if (key === "paymentTerms") data.paymentTerms = val;
    else if (key === "firstEngagement") data.firstEngagement = val;
    else if (key === "notes") data.notes = val;
  }
  return data;
}

export async function fetchActiveClients(log: any): Promise<any[]> {
  return [];
}

export async function fetchCommittedWorklogs(log: any): Promise<any[]> {
  return [];
}

export async function loadSettings(files: FileOps): Promise<InvoiceSettings> {
  try {
    if (await files.exists("settings.json")) {
      const content = await files.read("settings.json");
      const parsed = JSON.parse(content);
      return InvoiceSettingsSchema.parse(parsed);
    }
  } catch {
    // Return empty settings on error
  }
  return {
    companyName: "",
    taxRegistrationId: "",
    postalCode: "",
    address: "",
    email: "",
    bankName: "",
    bankBranch: "",
    bankAccountType: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    bookId: "",
    bookName: "",
  };
}

export async function saveSettings(files: FileOps, settings: InvoiceSettings): Promise<void> {
  await files.write("settings.json", JSON.stringify(settings, null, 2));
}
