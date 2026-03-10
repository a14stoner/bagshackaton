import type { ReactNode } from "react";
import React from "react";
import { render, screen } from "@testing-library/react";
import { TokenTable } from "./token-table";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>
}));

describe("TokenTable", () => {
  it("renders token cards and fallback winner", () => {
    render(
      <TokenTable
        tokens={[
          {
            mint: "mint-1",
            symbol: "BAGS",
            name: "Bags Token",
            image_uri: null,
            status: "TRACKED",
            lifecycle_phase: "DBC",
            holder_count: 42,
            treasury_balance: "12.5",
            total_fees_distributed: "1.2",
            claimable_sol: "0.42",
            latest_winner_wallet: null,
            next_draw_at: null
          }
        ]}
      />
    );

    expect(screen.getByText("Tracked Tokens")).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/tokens/mint-1");
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/Unscheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/0.42 SOL/i)).toBeInTheDocument();
  });
});
