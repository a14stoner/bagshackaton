import React from "react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Header } from "./header";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/"
}));

describe("Header", () => {
  it("renders primary navigation", () => {
    render(<Header />);

    expect(screen.getByText("Bags Holder Rewards")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leaderboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Draw History" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "System" })).toBeInTheDocument();
  });
});
