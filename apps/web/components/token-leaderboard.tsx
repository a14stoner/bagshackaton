"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatPercent, shortenAddress } from "../lib/format";
import { CopyButton } from "./copy-button";

type Holder = {
  wallet: string;
  first_buy_time: string | null;
  hold_duration_hours: number;
  percent_supply: number;
  current_balance: string;
  sell_ratio: number;
  hold_score: number;
  cooldown_until_draw: number | null;
};

type HolderPage = {
  items: Holder[];
  total: number;
  limit: number;
  offset: number;
};

function normalizeHolderResponse(payload: HolderPage | Holder[]): HolderPage {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      total: payload.length,
      limit: payload.length,
      offset: 0
    };
  }
  return payload;
}

type SortBy = "hold_score" | "percent_supply" | "current_balance" | "hold_duration_hours" | "sell_ratio" | "first_buy_time";
type SortOrder = "asc" | "desc";

export function TokenLeaderboard({ mint }: { mint: string }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("hold_score");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0);
  const limit = 20;

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(page * limit),
      sortBy,
      sortOrder
    });
    if (search.trim()) {
      params.set("search", search.trim());
    }
    return params.toString();
  }, [limit, page, search, sortBy, sortOrder]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["holders", mint, queryString],
    queryFn: async () => {
      const payload = await apiFetch<HolderPage | Holder[]>(`/tokens/${mint}/holders?${queryString}`);
      return normalizeHolderResponse(payload);
    },
    staleTime: 5_000
  });

  const holders = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalScore = holders.reduce((sum, holder) => sum + Number(holder.hold_score ?? 0), 0);
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="panel">
      <h2 className="section-title">Holder Leaderboard</h2>
      <div className="toolbar">
        <input
          className="input"
          value={search}
          placeholder="Search wallet"
          onChange={(event: any) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <select
          className="select"
          value={sortBy}
          onChange={(event: any) => {
            setSortBy(event.target.value as SortBy);
            setPage(0);
          }}
        >
          <option value="hold_score">Sort: Hold Score</option>
          <option value="percent_supply">Sort: Percent Supply</option>
          <option value="current_balance">Sort: Balance</option>
          <option value="hold_duration_hours">Sort: Hold Time</option>
          <option value="sell_ratio">Sort: Sell Ratio</option>
          <option value="first_buy_time">Sort: Holding Since</option>
        </select>
        <button
          type="button"
          className="button"
          onClick={() => setSortOrder((current) => (current === "asc" ? "desc" : "asc"))}
          title="Toggle sort direction"
        >
          {sortOrder === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>

      {isError ? <p className="muted">Could not load holders. Try again.</p> : null}
      {isLoading ? <div className="skeleton" style={{ height: 180 }} /> : null}
      {!isLoading && holders.length === 0 ? <p className="muted">No holders found for this token.</p> : null}

      {!isLoading && holders.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Holding Since</th>
                  <th>Hold Time</th>
                  <th>Percent Supply</th>
                  <th>Balance</th>
                  <th>Sell Ratio</th>
                  <th>Hold Score</th>
                  <th>Win Chance</th>
                  <th>Cooldown</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((holder) => (
                  <tr key={holder.wallet}>
                    <td title={holder.wallet}>
                      {shortenAddress(holder.wallet, 6, 6)}
                      <CopyButton value={holder.wallet} />
                    </td>
                    <td>{holder.first_buy_time ? new Date(holder.first_buy_time).toLocaleString() : "N/A"}</td>
                    <td className="mono">{holder.hold_duration_hours.toFixed(1)}h</td>
                    <td className="mono">{formatPercent(holder.percent_supply, 3)}</td>
                    <td className="mono">{Number(holder.current_balance).toLocaleString()}</td>
                    <td className="mono">{Number(holder.sell_ratio).toFixed(3)}</td>
                    <td className="mono">{Number(holder.hold_score).toFixed(3)}</td>
                    <td className="mono">
                      {totalScore > 0 ? `${((Number(holder.hold_score) / totalScore) * 100).toFixed(2)}%` : "0.00%"}
                    </td>
                    <td>{holder.cooldown_until_draw ?? "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="muted">
              Showing {holders.length} of {total}
            </span>
            <div style={{ display: "inline-flex", gap: 8 }}>
              <button type="button" className="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </button>
              <span className="muted" style={{ alignSelf: "center" }}>
                Page {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="button"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
