"use client";

/**
 * Client-side interactive list for /admin/access-requests. Fetches via
 * GET /api/admin/access-requests and dispatches approve/reject via
 * POST to the per-row routes. Approval response includes the invite
 * URL which we surface inline for the admin to copy and share.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

type Status = "pending" | "approved" | "rejected";
type Tab = Status | "all";

interface AccessRequest {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  status: Status;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  invite_id: string | null;
}

interface ApproveResponse {
  ok: true;
  invite_url: string;
  invite_id: string;
  expires_at: string;
}

const TABS: { value: Tab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default function AccessRequestsClient() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Map of access_request id → invite URL surfaced after approve so
  // the admin can copy without an extra fetch.
  const [inviteUrls, setInviteUrls] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refetch = useCallback(async (status: Tab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/access-requests?status=${status}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Could not load requests.");
        setRequests([]);
        return;
      }
      const data = (await res.json()) as { requests: AccessRequest[] };
      setRequests(data.requests);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch(tab);
  }, [tab, refetch]);

  async function handleApprove(req: AccessRequest) {
    setActionId(req.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/access-requests/${req.id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === "string" ? data.error : "Approve failed.");
        return;
      }
      const data = (await res.json()) as ApproveResponse;
      setInviteUrls((prev) => ({ ...prev, [req.id]: data.invite_url }));
      // Update row locally to "approved" so the user can stay on the
      // pending tab and see the URL appear without a refetch.
      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id
            ? { ...r, status: "approved", invite_id: data.invite_id }
            : r,
        ),
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(req: AccessRequest) {
    setActionId(req.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/access-requests/${req.id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === "string" ? data.error : "Reject failed.");
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: "rejected" } : r)),
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleCopy(requestId: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(requestId);
      setTimeout(() => setCopiedId((id) => (id === requestId ? null : id)), 1500);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  const visibleRequests = useMemo(() => requests, [requests]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-ink/10">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm transition ${
              tab === t.value
                ? "border-b-2 border-ink font-medium text-ink"
                : "text-muted hover:text-ink"
            }`}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : visibleRequests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No requests in this view.
        </p>
      ) : (
        <ul className="divide-y divide-ink/5">
          {visibleRequests.map((req) => (
            <li key={req.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {req.first_name} {req.last_name}
                    {req.display_name && (
                      <span className="ml-2 text-sm text-muted">
                        ({req.display_name})
                      </span>
                    )}
                  </p>
                  <p className="break-all text-sm text-muted">{req.email}</p>
                  <p className="mt-1 text-xs text-muted">
                    Requested {formatDate(req.created_at)}
                    {req.decided_at && req.status !== "pending" && (
                      <>
                        {" · "}
                        {req.status === "approved" ? "Approved" : "Rejected"}{" "}
                        {formatDate(req.decided_at)}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {req.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApprove(req)}
                        disabled={actionId === req.id}
                        className="rounded-md bg-ink px-3 py-1.5 text-sm text-cream transition hover:bg-ink/90 disabled:opacity-60"
                      >
                        {actionId === req.id ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(req)}
                        disabled={actionId === req.id}
                        className="rounded-md border border-ink/20 px-3 py-1.5 text-sm text-ink transition hover:bg-ink/5 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {req.status !== "pending" && (
                    <span
                      className={`rounded-md px-2 py-1 text-xs uppercase tracking-wide ${
                        req.status === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-ink/5 text-muted"
                      }`}
                    >
                      {req.status}
                    </span>
                  )}
                </div>
              </div>

              {inviteUrls[req.id] && (
                <div className="mt-3 rounded-md border border-ink/10 bg-cream/40 p-3">
                  <p className="mb-1 text-xs text-muted">
                    Invite URL — share with the user manually:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs text-ink">
                      {inviteUrls[req.id]}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(req.id, inviteUrls[req.id])}
                      className="rounded-md border border-ink/20 px-3 py-1 text-xs text-ink transition hover:bg-ink/5"
                    >
                      {copiedId === req.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
